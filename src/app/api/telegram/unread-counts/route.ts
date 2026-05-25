import { createClient } from "@/lib/telegram";
import { Api } from "telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight per-bucket unread counters for the sidebar badges. Walks the
 * dialog list once and tallies unread by entity type — no photo downloads,
 * no pagination. Safe to poll on a short interval.
 */
const DIALOG_FETCH_LIMIT = 1000;

export async function POST(request: Request) {
  const { sessionString } = await request.json();
  if (typeof sessionString !== "string" || !sessionString) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }

  const client = createClient(sessionString);
  try {
    await client.connect();
    const dialogs = await client.getDialogs({ limit: DIALOG_FETCH_LIMIT });

    let users = 0;
    let groups = 0;
    let channels = 0;
    for (const d of dialogs) {
      const unread = d.unreadCount ?? 0;
      if (unread <= 0) continue;
      const entity = d.entity;
      // Skip Saved Messages — the user reading their own outgoing log isn't
      // an unread signal worth surfacing in the nav.
      if (entity instanceof Api.User) {
        if (entity.self) continue;
        users += unread;
      } else if (entity instanceof Api.Channel) {
        // Channels: broadcast=true. Supergroups (megagroup=true) are still
        // user-chats from a "groups" perspective.
        if (entity.broadcast) channels += unread;
        else groups += unread;
      } else if (entity instanceof Api.Chat) {
        groups += unread;
      }
    }

    return Response.json({ users, groups, channels });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load unread counts";
    return Response.json({ error: message }, { status: 500 });
  } finally {
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
  }
}
