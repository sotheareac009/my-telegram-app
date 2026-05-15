const MAX_CONCURRENT = Math.max(
  1,
  Number(process.env.DOWNLOAD_CONCURRENCY) || 5
);

// HMR / module reloads in `next dev` will re-evaluate this file and reset any
// plain module-scope state — that would leak the `active` counter and drop the
// `waiters` list, so a queued forward would sit forever after a save. Pin the
// state on globalThis so it survives module re-evaluation.
type Waiter = {
  grant: () => void;
  // Set by acquireDownloadSlot when an AbortSignal is provided. Lets the queue
  // drop an aborted waiter without ever granting it a slot.
  cancelled: boolean;
};

type QueueState = {
  active: number;
  waiters: Waiter[];
};

declare global {
  // eslint-disable-next-line no-var
  var __downloadQueueState: QueueState | undefined;
}

const state: QueueState = (globalThis.__downloadQueueState ??= {
  active: 0,
  waiters: [],
});

export type ReleaseSlot = () => void;

function grantNext(): void {
  // Pop waiters until we find one that hasn't been cancelled. Aborted waiters
  // are skipped so a freed slot always reaches a live request.
  while (state.waiters.length > 0) {
    const next = state.waiters.shift()!;
    if (!next.cancelled) {
      next.grant();
      return;
    }
  }
}

export function acquireDownloadSlot(signal?: AbortSignal): Promise<ReleaseSlot> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }

    let granted = false;
    let cleanupAbortListener: (() => void) | null = null;

    const grant = () => {
      if (granted) return;
      granted = true;
      state.active++;
      let released = false;
      const release: ReleaseSlot = () => {
        if (released) return;
        released = true;
        state.active--;
        grantNext();
      };
      cleanupAbortListener?.();
      resolve(release);
    };

    const waiter: Waiter = { grant, cancelled: false };

    if (signal) {
      const onAbort = () => {
        if (granted) return;
        waiter.cancelled = true;
        signal.removeEventListener("abort", onAbort);
        reject(signal.reason ?? new Error("aborted"));
      };
      signal.addEventListener("abort", onAbort);
      cleanupAbortListener = () => signal.removeEventListener("abort", onAbort);
    }

    if (state.active < MAX_CONCURRENT) {
      grant();
    } else {
      state.waiters.push(waiter);
    }
  });
}

export function getDownloadQueueStats() {
  return {
    active: state.active,
    waiting: state.waiters.filter((w) => !w.cancelled).length,
    max: MAX_CONCURRENT,
  };
}
