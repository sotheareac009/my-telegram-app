import { userKeyFromSession } from "@/lib/forward-registry";
import { deleteWatch, toPublicWatch, upsertWatch } from "@/lib/watch-store";
import { startWatch } from "@/lib/watch-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json();
  const {
    sessionString,
    sourceChatId,
    sourceChatTitle,
    archiveChatId,
    archiveChatTitle,
  } = body;

  if (typeof sessionString !== "string" || sessionString.length === 0) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }
  if (typeof sourceChatId !== "string" || !sourceChatId) {
    return Response.json({ error: "Missing sourceChatId" }, { status: 400 });
  }
  if (typeof archiveChatId !== "string" || !archiveChatId) {
    return Response.json({ error: "Missing archiveChatId" }, { status: 400 });
  }
  if (sourceChatId === archiveChatId) {
    return Response.json(
      { error: "Source and archive chat must be different" },
      { status: 400 },
    );
  }

  const userKey = userKeyFromSession(sessionString);

  try {
    const watch = await upsertWatch({
      userKey,
      sessionString,
      sourceChatId,
      sourceChatTitle: typeof sourceChatTitle === "string" ? sourceChatTitle : "",
      archiveChatId,
      archiveChatTitle:
        typeof archiveChatTitle === "string" ? archiveChatTitle : "",
    });

    try {
      await startWatch(watch);
    } catch (err) {
      // The watcher couldn't connect (e.g. bad session) — roll back the row
      // so we don't persist a watch that can't run.
      await deleteWatch(watch.id, userKey).catch(() => {});
      throw err;
    }

    return Response.json({ watch: toPublicWatch(watch) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create watch";
    return Response.json({ error: message }, { status: 500 });
  }
}
