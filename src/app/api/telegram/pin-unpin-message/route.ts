import { createClient } from "@/lib/telegram";
import { Api } from "telegram";
import { resolveUserPeer } from "@/lib/telegram-peer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const {
    sessionString,
    userId,
    accessHash,
    chatId,
    pinned = true,
  } = await request.json();

  if (!sessionString) {
    return Response.json(
      { error: "Missing sessionString" },
      { status: 400 }
    );
  }

  if (!userId && !chatId) {
    return Response.json(
      { error: "Missing target chat" },
      { status: 400 }
    );
  }

  const client = createClient(sessionString);

  try {
    await client.connect();

    let peer;

    if (chatId) {
      try {
        await client.getDialogs({ limit: 200 });
      } catch {}

      peer = await client.getInputEntity(String(chatId));
    } else {
      const resolved = await resolveUserPeer(
        client,
        userId,
        accessHash
      );

      peer = await client.getInputEntity(resolved);
    }

    await client.invoke(
      new Api.messages.ToggleDialogPin({
        pinned,
        //@ts-ignore
        peer,
      })
    );

    return Response.json({
      success: true,
      pinned,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to pin chat";
    // Telegram raises PINNED_DIALOGS_TOO_MUCH once you hit the per-account
    // limit (5 for free accounts, more for Premium). Surface a stable code so
    // the client can show a "limit reached" toast instead of a raw message.
    const isLimit = /PINNED_DIALOGS_TOO_MUCH/i.test(message);
    return Response.json(
      {
        error: message,
        code: isLimit ? "PINNED_DIALOGS_TOO_MUCH" : undefined,
      },
      { status: isLimit ? 409 : 500 }
    );
  } finally {
    await client.disconnect().catch(() => {});
  }
}