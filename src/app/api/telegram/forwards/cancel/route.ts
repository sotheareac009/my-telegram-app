import { cancelJob, userKeyFromSession } from "@/lib/forward-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { sessionString, jobId } = await request.json();
  if (typeof sessionString !== "string" || sessionString.length === 0) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }
  if (typeof jobId !== "string" || jobId.length === 0) {
    return Response.json({ error: "Missing jobId" }, { status: 400 });
  }
  const userKey = userKeyFromSession(sessionString);
  const ok = cancelJob(jobId, userKey);
  if (!ok) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }
  return Response.json({ cancelled: true });
}
