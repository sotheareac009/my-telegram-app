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
};

/** NDJSON events streamed by /api/telegram/forward (mirrors ProgressEvent in route.ts). */
type ForwardEvent =
  | { type: "start"; total: number }
  | { type: "forwarding" }
  | { type: "message_start"; messageId: number; index: number; size: number | null }
  | { type: "download_progress"; messageId: number; index: number; loaded: number; total: number }
  | { type: "download_done"; messageId: number; index: number }
  | { type: "upload_progress"; messageId: number; index: number; progress: number }
  | { type: "upload_done"; messageId: number; index: number }
  | { type: "message_skipped"; messageId: number; index: number; reason: string }
  | { type: "done"; method: "forward" | "resend" }
  | { type: "error"; message: string };

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
  startForward: (params: StartForwardParams) => string;
  cancelForward: (jobId: string) => void;
  /** Suppress a job's floating card (use when shown inline in a modal). */
  suppressFloating: (jobId: string, suppress: boolean) => void;
}

const ForwardJobsContext = createContext<ForwardJobsContextValue | null>(null);

function makeMessageIdsKey(ids: number[]): string {
  return [...ids].sort((a, b) => a - b).join(",");
}

export function useForwardJobs() {
  const ctx = useContext(ForwardJobsContext);
  if (!ctx) {
    throw new Error("useForwardJobs must be used within ForwardJobsProvider");
  }
  return ctx;
}

export function ForwardJobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<ForwardJobState[]>([]);
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  // Stable read of `jobs` for use inside callbacks without re-creating them.
  const jobsRef = useRef<ForwardJobState[]>([]);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const [suppressedIds, setSuppressedIds] = useState<Set<string>>(() => new Set());
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const cancelForward = useCallback((jobId: string) => {
    controllersRef.current.get(jobId)?.abort();
  }, []);

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

  const startForward = useCallback((params: StartForwardParams): string => {
    const {
      session,
      fromGroupId,
      fromGroupTitle,
      toGroupId,
      destinationTitle,
      destinationIsChannel,
      messageIds,
      contentSummary,
      contentThumbBase64,
    } = params;

    const messageIdsKey = makeMessageIdsKey(messageIds);
    // Dedupe by source+destination+selection so re-submitting the same forward
    // just surfaces the existing job rather than spawning a parallel duplicate.
    const existing = jobsRef.current.find(
      (job) =>
        job.sourceId === fromGroupId &&
        job.destinationId === toGroupId &&
        job.messageIdsKey === messageIdsKey,
    );
    if (existing) return existing.id;

    const jobId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `fwd_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const totalMessages = messageIds.length;

    const withDestination = (p: ForwardProgress): ForwardProgress => ({
      ...p,
      destinationTitle,
      destinationIsChannel,
      sourceTitle: fromGroupTitle,
      contentSummary,
      contentThumbBase64,
    });

    const updateProgress = (
      next: ForwardProgress | ((prev: ForwardProgress) => ForwardProgress),
    ) => {
      setJobs((prev) =>
        prev.map((job) =>
          job.id === jobId
            ? {
                ...job,
                progress:
                  typeof next === "function"
                    ? withDestination(
                        (next as (p: ForwardProgress) => ForwardProgress)(job.progress),
                      )
                    : withDestination(next),
              }
            : job,
        ),
      );
    };

    const ac = new AbortController();
    controllersRef.current.set(jobId, ac);

    const initialProgress: ForwardProgress = withDestination({
      total: totalMessages,
      index: 0,
      step: "forwarding",
      percent: 0,
    });
    setJobs((prev) => [
      ...prev,
      {
        id: jobId,
        progress: initialProgress,
        sourceId: fromGroupId,
        destinationId: toGroupId,
        messageIdsKey,
      },
    ]);

    void (async () => {
      let errorMessage: string | null = null;
      let success = false;
      let uploadedCount = 0;

      try {
        const response = await fetch("/api/telegram/forward", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionString: session,
            fromGroupId,
            toGroupId,
            messageIds,
          }),
          signal: ac.signal,
        });

        if (!response.ok || !response.body) {
          let serverError: string | undefined;
          try {
            const json = await response.json();
            serverError = json?.error;
          } catch {
            // ignore JSON parse failures
          }
          throw new Error(serverError || `Forward failed (HTTP ${response.status})`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let event: ForwardEvent;
            try {
              event = JSON.parse(line) as ForwardEvent;
            } catch {
              continue;
            }
            switch (event.type) {
              case "start":
                updateProgress({
                  total: event.total,
                  index: 0,
                  step: "forwarding",
                  percent: 0,
                });
                break;
              case "forwarding":
                updateProgress((prev) => ({
                  total: prev.total,
                  index: 0,
                  step: "forwarding",
                  percent: 0,
                }));
                break;
              case "message_start":
                updateProgress({
                  total: totalMessages,
                  index: event.index,
                  step: "downloading",
                  percent: 0,
                  loadedBytes: 0,
                  totalBytes: event.size ?? undefined,
                });
                break;
              case "download_progress": {
                const pct = event.total > 0 ? (event.loaded / event.total) * 100 : 0;
                updateProgress({
                  total: totalMessages,
                  index: event.index,
                  step: "downloading",
                  percent: pct,
                  loadedBytes: event.loaded,
                  totalBytes: event.total,
                });
                break;
              }
              case "download_done":
                updateProgress((prev) => ({
                  total: prev.total,
                  index: event.index,
                  step: "uploading",
                  percent: 0,
                }));
                break;
              case "upload_progress":
                updateProgress({
                  total: totalMessages,
                  index: event.index,
                  step: "uploading",
                  percent: event.progress * 100,
                });
                break;
              case "upload_done":
                uploadedCount += 1;
                updateProgress({
                  total: totalMessages,
                  index: event.index,
                  step: "uploading",
                  percent: 100,
                });
                break;
              case "message_skipped":
                updateProgress({
                  total: totalMessages,
                  index: event.index,
                  step: "skipped",
                  percent: 100,
                });
                break;
              case "done":
                success = true;
                break;
              case "error":
                errorMessage = event.message;
                break;
            }
          }
        }

        if (errorMessage) throw new Error(errorMessage);
        if (!success) throw new Error("Forward ended without confirmation");

        setToast({
          kind: "success",
          message: `Forwarded ${totalMessages} item${totalMessages === 1 ? "" : "s"} to ${
            destinationTitle ?? "the selected chat"
          }.`,
        });
      } catch (error: unknown) {
        const isAbort =
          ac.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError") ||
          (error instanceof Error && error.name === "AbortError");
        if (isAbort) {
          setToast({
            kind: "success",
            message:
              uploadedCount > 0
                ? `Forward cancelled. ${uploadedCount} item${uploadedCount === 1 ? "" : "s"} already sent to ${destinationTitle ?? "the destination"}.`
                : "Forward cancelled.",
          });
        } else {
          setToast({
            kind: "error",
            message:
              error instanceof Error ? error.message : "Failed to forward messages",
          });
        }
      } finally {
        controllersRef.current.delete(jobId);
        setJobs((prev) => prev.filter((j) => j.id !== jobId));
        setSuppressedIds((prev) => {
          if (!prev.has(jobId)) return prev;
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
      }
    })();

    return jobId;
  }, []);

  const value = useMemo<ForwardJobsContextValue>(
    () => ({ jobs, startForward, cancelForward, suppressFloating }),
    [jobs, startForward, cancelForward, suppressFloating],
  );

  const floatingJobs = jobs.filter((j) => !suppressedIds.has(j.id));

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
