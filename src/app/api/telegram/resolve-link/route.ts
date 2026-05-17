import { createClient } from "@/lib/telegram";
import { Api, utils as telegramUtils } from "telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResolveResult =
  | {
      kind: "channel" | "group";
      id: string;
      title: string;
      /** Whether the account is already a member. */
      isMember: boolean;
    }
  | {
      kind: "user";
      id: string;
      accessHash: string;
      title: string;
      firstName: string;
      lastName: string;
    }
  | {
      // Private invite link, account is NOT a member — only a preview is
      // available until the user joins.
      kind: "invite-preview";
      title: string;
      about: string;
      participants: number;
      isChannel: boolean;
      inviteHash: string;
    };

/** Marked id + kind + membership for a resolved Chat/Channel entity. */
function chatToResult(
  chat: Api.TypeChat | undefined,
): { kind: "channel" | "group"; id: string; title: string; isMember: boolean } | null {
  if (chat instanceof Api.Channel) {
    return {
      kind: chat.megagroup ? "group" : "channel",
      id: telegramUtils
        .getPeerId(new Api.PeerChannel({ channelId: chat.id }))
        .toString(),
      title: chat.title || "Chat",
      // `left` is set when the account is not a member.
      isMember: !chat.left,
    };
  }
  if (chat instanceof Api.Chat) {
    return {
      kind: "group",
      id: telegramUtils
        .getPeerId(new Api.PeerChat({ chatId: chat.id }))
        .toString(),
      title: chat.title || "Chat",
      isMember: !chat.left,
    };
  }
  return null;
}

/** Resolve a public @username into an addressable chat. */
async function resolveUsername(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  username: string,
): Promise<ResolveResult | null> {
  const res = await client.invoke(
    new Api.contacts.ResolveUsername({ username }),
  );
  const peer = res.peer;

  if (peer instanceof Api.PeerChannel || peer instanceof Api.PeerChat) {
    const wantedId =
      peer instanceof Api.PeerChannel
        ? peer.channelId.toString()
        : peer.chatId.toString();
    const chat = res.chats.find(
      (c: Api.TypeChat) => c.id?.toString() === wantedId,
    );
    return chatToResult(chat);
  }

  if (peer instanceof Api.PeerUser) {
    const u = res.users.find(
      (x: Api.TypeUser) => x.id?.toString() === peer.userId.toString(),
    );
    const user = u instanceof Api.User ? u : null;
    return {
      kind: "user",
      id: peer.userId.toString(),
      accessHash: user?.accessHash ? user.accessHash.toString() : "0",
      title: user
        ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || username
        : username,
      firstName: user?.firstName || "",
      lastName: user?.lastName || "",
    };
  }
  return null;
}

/**
 * Resolve a private invite hash WITHOUT joining. If the account is already a
 * member the chat is returned; otherwise only a preview (title, member count)
 * is available — the caller shows a Join button.
 */
async function resolveInvite(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  hash: string,
): Promise<ResolveResult | null> {
  const invite = await client.invoke(
    new Api.messages.CheckChatInvite({ hash }),
  );

  if (
    invite instanceof Api.ChatInviteAlready ||
    invite instanceof Api.ChatInvitePeek
  ) {
    return chatToResult(invite.chat);
  }

  if (invite instanceof Api.ChatInvite) {
    return {
      kind: "invite-preview",
      title: invite.title || "Private chat",
      about: invite.about || "",
      participants: invite.participantsCount ?? 0,
      isChannel: invite.broadcast === true,
      inviteHash: hash,
    };
  }
  return null;
}

/**
 * Resolve a Telegram link into an addressable chat. Accepts a public
 * @username or a private invite hash (t.me/+… / joinchat/…).
 */
export async function POST(request: Request) {
  try {
    const { sessionString, username, inviteHash } = await request.json();
    if (!sessionString || (!username && !inviteHash)) {
      return Response.json({ error: "Missing params" }, { status: 400 });
    }

    const client = createClient(sessionString);
    await client.connect();
    try {
      const result = inviteHash
        ? await resolveInvite(client, String(inviteHash))
        : await resolveUsername(client, String(username));

      if (!result) {
        return Response.json(
          { error: "Could not resolve link" },
          { status: 404 },
        );
      }
      return Response.json(result);
    } finally {
      try {
        await client.disconnect();
      } catch {
        // ignore
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resolve link";
    return Response.json({ error: message }, { status: 500 });
  }
}
