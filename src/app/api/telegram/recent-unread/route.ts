import { createClient } from "@/lib/telegram";
import { Api } from "telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PrivateChat = {
  id: string;
  accessHash: string;
  date: number;
  unreadCount: number;
  photo?: string;
};

const DIALOG_FETCH_LIMIT = 1000;
const PHOTO_TIMEOUT_MS = 5000;

export async function POST(request: Request) {
  const {
    sessionString,
    page = 1,
    limit = 30,
    search = "",
  } = await request.json();

  if (
    typeof sessionString !== "string" ||
    !sessionString
  ) {
    return Response.json(
      { error: "Missing sessionString" },
      { status: 400 }
    );
  }

  const client = createClient(sessionString);

  try {
    await client.connect();

    const dialogs = await client.getDialogs({
      limit: DIALOG_FETCH_LIMIT,
    });

    const chats: PrivateChat[] = [];

    const entityById = new Map<
      string,
      Api.User
    >();

    for (const d of dialogs) {
      if (!d.isUser) continue;

      const entity = d.entity;

      if (!(entity instanceof Api.User))
        continue;

      if (entity.self) continue;

      const id = entity.id.toString();

      entityById.set(id, entity);

      chats.push({
        id,
        accessHash: entity.accessHash
          ? entity.accessHash.toString()
          : "0",

        date: d.date ?? 0,

        unreadCount:
          d.unreadCount ?? 0,
      });
    }

    // Saved Messages
    try {
      const me = await client.getMe();

      if (me instanceof Api.User) {
        const selfId = me.id.toString();

        entityById.set(selfId, me);

        const selfDialog = dialogs.find(
          (d) =>
            d.entity instanceof Api.User &&
            (
              d.entity as Api.User
            ).self
        );

        chats.unshift({
          id: selfId,

          accessHash: me.accessHash
            ? me.accessHash.toString()
            : "0",

          date:
            selfDialog?.date ?? 0,

          unreadCount:
            selfDialog?.unreadCount ??
            0,
        });
      }
    } catch {
      // ignore
    }

    const q = String(search)
      .trim()
      .toLowerCase();

    const filtered = q
      ? chats.filter((c) =>
          c.id
            .toLowerCase()
            .includes(q)
        )
      : chats;

    const pageSize = Math.min(
      100,
      Math.max(
        1,
        Number(limit) || 30
      )
    );

    const totalPages = Math.max(
      1,
      Math.ceil(
        filtered.length / pageSize
      )
    );

    const p = Math.min(
      totalPages,
      Math.max(
        1,
        Number(page) || 1
      )
    );

    const start = (p - 1) * pageSize;

    const pageChats = filtered.slice(
      start,
      start + pageSize
    );

    await Promise.all(
      pageChats.map(
        async (chat) => {
          const entity =
            entityById.get(chat.id);

          if (
            !entity ||
            !(
              entity.photo instanceof
              Api.UserProfilePhoto
            )
          ) {
            return;
          }

          try {
            const buf =
              (await Promise.race([
                client.downloadProfilePhoto(
                  entity,
                  {
                    isBig: false,
                  }
                ),

                new Promise<null>(
                  (resolve) =>
                    setTimeout(
                      () =>
                        resolve(null),
                      PHOTO_TIMEOUT_MS
                    )
                ),
              ])) as
                | Buffer
                | null;

            if (
              buf &&
              buf.length > 0
            ) {
              chat.photo = `data:image/jpeg;base64,${
                Buffer.from(
                  buf
                ).toString(
                  "base64"
                )
              }`;
            }
          } catch {
            // ignore avatar errors
          }
        }
      )
    );

    return Response.json({
      contacts: pageChats,
      totalPages,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to load chats";

    return Response.json(
      { error: message },
      { status: 500 }
    );
  } finally {
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
  }
}