/**
 * Runs once when a Next.js server instance starts. Used here to resume the
 * "auto-archive new media" watchers from the persisted config so they keep
 * running across restarts / redeploys without the user re-arming them.
 */
export async function register() {
  // Only the Node.js runtime can hold the long-lived Telegram connections.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { resumeAllWatches } = await import("@/lib/watch-registry");
  // Don't block server startup on connecting N Telegram clients — let the
  // watchers come up in the background a moment after boot.
  void resumeAllWatches();
}
