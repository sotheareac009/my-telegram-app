import { createClient } from "@/lib/telegram";
import { cancelAllJobs, userKeyFromSession } from "@/lib/forward-registry";
import { Api } from "telegram";

export async function POST(request: Request) {
  try {
    const { sessionString } = await request.json();
    if (!sessionString) {
      return Response.json({ success: true });
    }

    // Cancel any in-flight forwards for this account before the session is
    // invalidated — otherwise their detached workers would keep running and
    // then fail on a dead session. Switching accounts does NOT call sign-out,
    // so those jobs are left untouched and keep running.
    const cancelled = cancelAllJobs(userKeyFromSession(sessionString));
    if (cancelled > 0) {
      console.info(`[sign-out] cancelled ${cancelled} in-flight forward(s)`);
    }

    const client = createClient(sessionString);
    await client.connect();
    await client.invoke(new Api.auth.LogOut());
    await client.disconnect();

    return Response.json({ success: true });
  } catch {
    return Response.json({ success: true });
  }
}
