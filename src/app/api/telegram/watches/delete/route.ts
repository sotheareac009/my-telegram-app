import { userKeyFromSession } from "@/lib/forward-registry";
import { deleteWatch } from "@/lib/watch-store";
import { stopWatch } from "@/lib/watch-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { sessionString, watchId } = await request.json();
  if (typeof sessionString !== "string" || sessionString.length === 0) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }
  if (typeof watchId !== "string" || watchId.length === 0) {
    return Response.json({ error: "Missing watchId" }, { status: 400 });
  }

  const userKey = userKeyFromSession(sessionString);

  try {
    const deleted = await deleteWatch(watchId, userKey);
    if (!deleted) {
      return Response.json({ error: "Watch not found" }, { status: 404 });
    }
    await stopWatch(userKey, watchId);
    return Response.json({ deleted: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete watch";
    return Response.json({ error: message }, { status: 500 });
  }
}
