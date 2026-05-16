import { createClient } from "@/lib/telegram";
import { Api } from "telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recent private chats — every user you have a conversation with, contact or
 * not. Sourced from getDialogs() (not the contact list) so it matches the
 * Telegram app's chat list, and crucially carries each user's `accessHash`,
 * which the conversation/send routes need to address non-contacts.
 */

type PrivateChat = {
  id: string;
  accessHash: string;
  firstName: string;
  lastName: string;
  username: string;
  phone: string;
  lastMessage: string;
  date: number;
};

const DIALOG_FETCH_LIMIT = 200;

export async function POST(request: Request) {
  const { sessionString, page = 1, limit = 30, search = "" } =
    await request.json();
  if (typeof sessionString !== "string" || !sessionString) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }

  const client = createClient(sessionString);
  try {
    await client.connect();
    const dialogs = await client.getDialogs({ limit: DIALOG_FETCH_LIMIT });

    const chats: PrivateChat[] = [];
    for (const d of dialogs) {
      if (!d.isUser) continue;
      const entity = d.entity;
      if (!(entity instanceof Api.User)) continue;
      if (entity.self) continue; // skip "Saved Messages"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lastMsg = (d.message as any)?.message;
      chats.push({
        id: entity.id.toString(),
        accessHash: entity.accessHash ? entity.accessHash.toString() : "0",
        firstName: entity.firstName || "",
        lastName: entity.lastName || "",
        username: entity.username || "",
        phone: entity.phone || "",
        lastMessage:
          typeof lastMsg === "string" ? lastMsg.slice(0, 80) : "",
        date: d.date ?? 0,
      });
    }

    const q = String(search).trim().toLowerCase();
    const filtered = q
      ? chats.filter(
          (c) =>
            `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
            c.username.toLowerCase().includes(q) ||
            c.phone.includes(q),
        )
      : chats;

    const pageSize = Math.min(100, Math.max(1, Number(limit) || 30));
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const p = Math.min(totalPages, Math.max(1, Number(page) || 1));
    const start = (p - 1) * pageSize;

    return Response.json({
      contacts: filtered.slice(start, start + pageSize),
      totalPages,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load chats";
    return Response.json({ error: message }, { status: 500 });
  } finally {
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
  }
}
