import { createClient } from "@/lib/telegram";
import { Api } from "telegram";

type ChatFolder = {
  id: string;
  title: string;
};

type DialogWithFolder = Awaited<
  ReturnType<ReturnType<typeof createClient>["getDialogs"]>
>[number];

function textWithEntitiesToString(value: unknown): string {
  if (value && typeof value === "object" && "text" in value) {
    const text = (value as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return "";
}

function inputPeerKey(peer: unknown): string | null {
  if (peer instanceof Api.InputPeerChannel) {
    return `channel:${peer.channelId.toString()}`;
  }
  if (peer instanceof Api.InputPeerChat) {
    return `chat:${peer.chatId.toString()}`;
  }
  if (peer instanceof Api.InputPeerUser) {
    return `user:${peer.userId.toString()}`;
  }
  return null;
}

function dialogPeerKeys(dialog: DialogWithFolder): string[] {
  const keys = new Set<string>();
  const id = dialog.id?.toString();
  if (id) {
    if (dialog.isChannel) keys.add(`channel:${id}`);
    if (dialog.isGroup) keys.add(`chat:${id}`);
    if (dialog.isUser) keys.add(`user:${id}`);
  }

  const entity = dialog.entity;
  if (entity && typeof entity === "object" && "id" in entity) {
    const entityId = (entity as { id?: { toString(): string } }).id?.toString();
    if (entityId) {
      if (dialog.isChannel) keys.add(`channel:${entityId}`);
      if (dialog.isGroup) keys.add(`chat:${entityId}`);
      if (dialog.isUser) keys.add(`user:${entityId}`);
    }
  }

  return [...keys];
}

function dialogMatchesFilter(
  dialog: DialogWithFolder,
  filter: Api.DialogFilter | Api.DialogFilterChatlist
): boolean {
  const keys = dialogPeerKeys(dialog);
  const pinned = new Set(filter.pinnedPeers.map(inputPeerKey).filter(Boolean));
  const included = new Set(
    filter.includePeers.map(inputPeerKey).filter(Boolean)
  );
  const explicitlyIncluded = keys.some(
    (key) => pinned.has(key) || included.has(key)
  );

  if (filter instanceof Api.DialogFilterChatlist) {
    return explicitlyIncluded;
  }

  const excluded = new Set(
    filter.excludePeers.map(inputPeerKey).filter(Boolean)
  );
  if (keys.some((key) => excluded.has(key))) return false;
  if (filter.excludeArchived && dialog.folderId === 1) return false;
  if (filter.excludeRead && dialog.unreadCount === 0) return false;

  const matchesType =
    (filter.groups && dialog.isGroup) ||
    (filter.broadcasts && dialog.isChannel && !dialog.isGroup) ||
    explicitlyIncluded;

  return !!matchesType;
}

export async function POST(request: Request) {
  try {
    const { sessionString } = await request.json();
    if (!sessionString) {
      return Response.json({ error: "No session" }, { status: 401 });
    }

    const client = createClient(sessionString);
    await client.connect();

    const dialogs = await client.getDialogs({ limit: 300 });
    const folderById = new Map<string, ChatFolder>();
    const folderMatches = new Map<string, Set<string>>();

    try {
      const result = await client.invoke(new Api.messages.GetDialogFilters());
      for (const filter of result.filters) {
        if (
          filter instanceof Api.DialogFilter ||
          filter instanceof Api.DialogFilterChatlist
        ) {
          const id = `filter:${filter.id}`;
          folderById.set(id, {
            id,
            title: textWithEntitiesToString(filter.title) || `Folder ${filter.id}`,
          });
          folderMatches.set(id, new Set());
        }
      }

      for (const dialog of dialogs) {
        const dialogId = dialog.id?.toString();
        if (!dialogId) continue;
        for (const filter of result.filters) {
          if (
            filter instanceof Api.DialogFilter ||
            filter instanceof Api.DialogFilterChatlist
          ) {
            const id = `filter:${filter.id}`;
            if (dialogMatchesFilter(dialog, filter)) {
              folderMatches.get(id)?.add(dialogId);
            }
          }
        }
      }
    } catch {
      // Folders are optional. If Telegram rejects this request, continue with all dialogs.
    }

    const archivedIds = new Set(
      dialogs
        .filter((d) => d.folderId === 1)
        .map((d) => d.id?.toString())
        .filter((id): id is string => !!id)
    );
    if (archivedIds.size > 0) {
      folderById.set("archive", { id: "archive", title: "Archive" });
      folderMatches.set("archive", archivedIds);
    }

    const groups = dialogs
      .filter((d) => d.isGroup || d.isChannel)
      .map((d) => {
        const id = d.id?.toString() ?? "";
        return {
          id,
          title: d.title ?? "Untitled",
          unreadCount: d.unreadCount ?? 0,
          isChannel: d.isChannel ?? false,
          isGroup: d.isGroup ?? false,
          lastMessage: d.message?.message?.slice(0, 80) ?? "",
          date: d.message?.date ?? 0,
          folderIds: [...folderMatches.entries()]
            .filter(([, ids]) => ids.has(id))
            .map(([folderId]) => folderId),
        };
      });

    const folders = [...folderById.values()].filter((folder) =>
      groups.some((group) => group.folderIds.includes(folder.id))
    );

    await client.disconnect();

    return Response.json({ groups, folders });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch dialogs";
    return Response.json({ error: message }, { status: 500 });
  }
}
