import {
  listJobs,
  subscribe,
  userKeyFromSession,
  type RegistryEvent,
} from "@/lib/forward-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Long-lived NDJSON stream of registry events for a single user. Each tab
 * keeps one of these open and renders whatever the server pushes. The
 * connection survives indefinitely; the client just closes it on unmount.
 *
 * Using NDJSON over POST (rather than SSE / GET) so the sessionString lives
 * in the request body — URLs end up in proxy/server logs and we don't want
 * the session there.
 */
export async function POST(request: Request) {
  const { sessionString } = await request.json();
  if (typeof sessionString !== "string" || sessionString.length === 0) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }
  const userKey = userKeyFromSession(sessionString);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
        } catch {
          closed = true;
        }
      };

      // Push an initial snapshot so the tab can render right away without
      // a separate /list call.
      send({ kind: "snapshot", jobs: listJobs(userKey) });

      const onEvent = (event: RegistryEvent) => send(event);
      const unsubscribe = subscribe(userKey, onEvent);

      // Heartbeat every 8s — short enough to keep ahead of typical 15–30s
      // idle timeouts in dev servers, browsers, and reverse proxies that
      // would otherwise tear the connection down between progress bursts.
      const heartbeat = setInterval(() => send({ kind: "heartbeat" }), 8_000);
      // Fire one heartbeat immediately so headers + body flush right away
      // and the client knows the connection is live.
      send({ kind: "heartbeat" });

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      // Reader cancelled — no extra cleanup needed; the abort listener
      // above will fire too.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
