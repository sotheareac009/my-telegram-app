import { userKeyFromSession } from "@/lib/forward-registry";
import { listWatchesByUser, toPublicWatch } from "@/lib/watch-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { sessionString } = await request.json();
  if (typeof sessionString !== "string" || sessionString.length === 0) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }
  try {
    const watches = await listWatchesByUser(userKeyFromSession(sessionString));
    return Response.json({ watches: watches.map(toPublicWatch) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list watches";
    return Response.json({ error: message }, { status: 500 });
  }
}
