"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ForwardProgress } from "./ForwardModal";
import FloatingForwardProgress from "./FloatingForwardProgress";

export type ForwardJobState = {
  id: string;
  progress: ForwardProgress;
  /** Source chat the messages are being forwarded *from*. */
  sourceId: string;
  /** Destination chat id this job is forwarding to. */
  destinationId: string;
  /** Sorted message IDs being forwarded. Used to detect duplicates on retry. */
  messageIdsKey: string;
  /** First message id — anchor for fetching a sharper thumbnail. */
  firstMessageId?: number;
};

export type StartForwardParams = {
  session: string;
  fromGroupId: string;
  fromGroupTitle: string;
  toGroupId: string;
  destinationTitle?: string;
  destinationIsChannel?: boolean;
  messageIds: number[];
  contentSummary: string;
  contentThumbBase64?: string;
};

interface ForwardJobsContextValue {
  jobs: ReadonlyArray<ForwardJobState>;
  /** Returns the jobId of the newly-started job (or an existing duplicate). */
  startForward: (params: StartForwardParams) => Promise<string | null>;
  cancelForward: (jobId: string) => void;
  /** Suppress a job's floating card (use when shown inline in a modal). */
  suppressFloating: (jobId: string, suppress: boolean) => void;
  /**
   * Globally hide every floating progress card. Used by the Queue dashboard
   * view, which renders the same jobs inline and would otherwise be covered
   * by floating cards.
   */
  setHideAllFloating: (hide: boolean) => void;
  /** Session passed at provider mount; queue rows need it to fetch hi-res thumbs. */
  session: string | null;
}

const ForwardJobsContext = createContext<ForwardJobsContextValue | null>(null);

/** Server-side job metadata shape (mirrors ForwardJobMeta in forward-registry.ts). */
type ServerJobMeta = {
  jobId: string;
  userKey: string;
  fromGroupId: string;
  fromGroupTitle?: string;
  toGroupId: string;
  destinationTitle?: string;
  destinationIsChannel?: boolean;
  contentSummary?: string;
  contentThumbBase64?: string;
  messageIdsKey: string;
  firstMessageId?: number;
  total: number;
  progress: {
    step: "forwarding" | "queued" | "downloading" | "uploading" | "skipped";
    index: number;
    percent: number;
    loadedBytes?: number;
    totalBytes?: number;
  };
  startedAt: number;
};

type StreamMessage =
  | { kind: "snapshot"; jobs: ServerJobMeta[] }
  | { kind: "job_added"; job: ServerJobMeta }
  | {
      kind: "job_progress";
      jobId: string;
      userKey: string;
      progress: ServerJobMeta["progress"];
    }
  | {
      kind: "job_removed";
      jobId: string;
      userKey: string;
      reason: "done" | "error" | "cancelled";
      errorMessage?: string;
    }
  | { kind: "heartbeat" };

function serverJobToState(job: ServerJobMeta): ForwardJobState {
  return {
    id: job.jobId,
    sourceId: job.fromGroupId,
    destinationId: job.toGroupId,
    messageIdsKey: job.messageIdsKey,
    firstMessageId: job.firstMessageId,
    progress: {
      total: job.total,
      index: job.progress.index,
      step: job.progress.step,
      percent: job.progress.percent,
      loadedBytes: job.progress.loadedBytes,
      totalBytes: job.progress.totalBytes,
      destinationTitle: job.destinationTitle,
      destinationIsChannel: job.destinationIsChannel,
      sourceTitle: job.fromGroupTitle,
      contentSummary: job.contentSummary,
      contentThumbBase64: job.contentThumbBase64,
    },
  };
}

export function useForwardJobs() {
  const ctx = useContext(ForwardJobsContext);
  if (!ctx) {
    throw new Error("useForwardJobs must be used within ForwardJobsProvider");
  }
  return ctx;
}

interface ProviderProps {
  children: ReactNode;
  session: string | null;
}

export function ForwardJobsProvider({ children, session }: ProviderProps) {
  const [jobs, setJobs] = useState<ForwardJobState[]>([]);
  const [suppressedIds, setSuppressedIds] = useState<Set<string>>(() => new Set());
  const [hideAllFloating, setHideAllFloatingState] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  // Keep a stable ref to the most recent jobs for use inside the stream
  // callback without re-creating it on every state change.
  const jobsRef = useRef<ForwardJobState[]>([]);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const setHideAllFloating = useCallback((hide: boolean) => {
    setHideAllFloatingState(hide);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Subscribe to the server-side job stream. One long-lived connection per
  // tab. Reconnects with exponential backoff if it drops.
  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    let backoff = 1000;
    const ac = new AbortController();

    const run = async () => {
      while (!cancelled) {
        try {
          const res = await fetch("/api/telegram/forwards/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionString: session }),
            signal: ac.signal,
          });
          if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);

          backoff = 1000; // reset after a successful connect

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";

          while (!cancelled) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) !== -1) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (!line) continue;
              let msg: StreamMessage;
              try {
                msg = JSON.parse(line) as StreamMessage;
              } catch {
                continue;
              }
              handleStreamMessage(msg);
            }
          }
        } catch (err) {
          if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
          // Network blip — wait and reconnect.
          await new Promise((r) => setTimeout(r, backoff));
          backoff = Math.min(backoff * 2, 15_000);
        }
      }
    };

    const handleStreamMessage = (msg: StreamMessage) => {
      switch (msg.kind) {
        case "snapshot": {
          setJobs(msg.jobs.map(serverJobToState));
          break;
        }
        case "job_added": {
          const newJob = serverJobToState(msg.job);
          setJobs((prev) => {
            if (prev.some((j) => j.id === newJob.id)) return prev;
            return [...prev, newJob];
          });
          break;
        }
        case "job_progress": {
          setJobs((prev) =>
            prev.map((job) =>
              job.id === msg.jobId
                ? {
                    ...job,
                    progress: {
                      ...job.progress,
                      index: msg.progress.index,
                      step: msg.progress.step,
                      percent: msg.progress.percent,
                      loadedBytes: msg.progress.loadedBytes,
                      totalBytes: msg.progress.totalBytes,
                    },
                  }
                : job,
            ),
          );
          break;
        }
        case "job_removed": {
          const job = jobsRef.current.find((j) => j.id === msg.jobId);
          setJobs((prev) => prev.filter((j) => j.id !== msg.jobId));
          setSuppressedIds((prev) => {
            if (!prev.has(msg.jobId)) return prev;
            const next = new Set(prev);
            next.delete(msg.jobId);
            return next;
          });
          if (msg.reason === "done" && job) {
            const total = job.progress.total;
            const dest = job.progress.destinationTitle ?? "the selected chat";
            setToast({
              kind: "success",
              message: `Forwarded ${total} item${total === 1 ? "" : "s"} to ${dest}.`,
            });
          } else if (msg.reason === "error") {
            setToast({
              kind: "error",
              message: msg.errorMessage ?? "Failed to forward messages",
            });
          } else if (msg.reason === "cancelled" && job) {
            const dest = job.progress.destinationTitle ?? "the destination";
            setToast({ kind: "success", message: `Forward cancelled (${dest}).` });
          }
          break;
        }
        case "heartbeat":
          break;
      }
    };

    void run();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [session]);

  const cancelForward = useCallback(
    (jobId: string) => {
      if (!session) return;
      void fetch("/api/telegram/forwards/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionString: session, jobId }),
      });
    },
    [session],
  );

  const suppressFloating = useCallback((jobId: string, suppress: boolean) => {
    setSuppressedIds((prev) => {
      if (suppress && prev.has(jobId)) return prev;
      if (!suppress && !prev.has(jobId)) return prev;
      const next = new Set(prev);
      if (suppress) next.add(jobId);
      else next.delete(jobId);
      return next;
    });
  }, []);

  const startForward = useCallback(
    async (params: StartForwardParams): Promise<string | null> => {
      const messageIdsKey = [...params.messageIds].sort((a, b) => a - b).join(",");
      const existing = jobsRef.current.find(
        (job) =>
          job.sourceId === params.fromGroupId &&
          job.destinationId === params.toGroupId &&
          job.messageIdsKey === messageIdsKey,
      );
      if (existing) return existing.id;

      try {
        const res = await fetch("/api/telegram/forward", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionString: params.session,
            fromGroupId: params.fromGroupId,
            fromGroupTitle: params.fromGroupTitle,
            toGroupId: params.toGroupId,
            destinationTitle: params.destinationTitle,
            destinationIsChannel: params.destinationIsChannel,
            messageIds: params.messageIds,
            contentSummary: params.contentSummary,
            contentThumbBase64: params.contentThumbBase64,
          }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => null);
          throw new Error(json?.error ?? `Forward failed (HTTP ${res.status})`);
        }
        const json = (await res.json()) as { jobId: string };
        return json.jobId;
      } catch (error) {
        setToast({
          kind: "error",
          message: error instanceof Error ? error.message : "Failed to start forward",
        });
        return null;
      }
    },
    [],
  );

  const value = useMemo<ForwardJobsContextValue>(
    () => ({ jobs, startForward, cancelForward, suppressFloating, setHideAllFloating, session }),
    [jobs, startForward, cancelForward, suppressFloating, setHideAllFloating, session],
  );

  const floatingJobs = hideAllFloating
    ? []
    : jobs.filter((j) => !suppressedIds.has(j.id));

  return (
    <ForwardJobsContext.Provider value={value}>
      {children}
      {floatingJobs.length > 0 && (
        <div className="fixed bottom-4 right-4 z-40 flex max-h-[80vh] w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto pr-1">
          {[...floatingJobs].reverse().map((job) => (
            <FloatingForwardProgress
              key={job.id}
              progress={job.progress}
              onCancel={() => cancelForward(job.id)}
              onClose={() => suppressFloating(job.id, true)}
            />
          ))}
        </div>
      )}
      {toast && (
        <div className="pointer-events-none fixed left-1/2 top-4 z-[60] -translate-x-1/2 px-4">
          <div
            className={`pointer-events-auto rounded-full px-4 py-2 text-sm font-medium shadow-lg ${
              toast.kind === "success"
                ? "bg-emerald-600 text-white"
                : "bg-red-600 text-white"
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
    </ForwardJobsContext.Provider>
  );
}
