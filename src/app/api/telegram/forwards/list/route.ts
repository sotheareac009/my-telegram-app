import { listJobs, userKeyFromSession } from "@/lib/forward-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { sessionString } = await request.json();
  if (typeof sessionString !== "string" || sessionString.length === 0) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }
  const userKey = userKeyFromSession(sessionString);
  return Response.json({ jobs: listJobs(userKey) });
}
