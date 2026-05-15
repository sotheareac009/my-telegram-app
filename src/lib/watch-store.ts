import { supabase } from "@/lib/supabase";

/**
 * Persistence layer for the "auto-archive new media" feature.
 *
 * Each row is one watch: a source chat whose new photos/videos get copied to
 * an archive chat. The session string is stored so the watcher can be resumed
 * on server boot without the user re-arming it — the user opted into this
 * (the session is the Telegram credential; the table is reachable only with
 * the Supabase service-role key).
 *
 * Required table (run once in the Supabase SQL editor):
 *
 *   create table media_watches (
 *     id                 uuid primary key default gen_random_uuid(),
 *     user_key           text not null,
 *     session_string     text not null,
 *     source_chat_id     text not null,
 *     source_chat_title  text not null default '',
 *     archive_chat_id    text not null,
 *     archive_chat_title text not null default '',
 *     created_at         timestamptz not null default now(),
 *     unique (user_key, source_chat_id)
 *   );
 *   create index media_watches_user_key_idx on media_watches (user_key);
 */

const TABLE = "media_watches";

export type MediaWatch = {
  id: string;
  userKey: string;
  sessionString: string;
  sourceChatId: string;
  sourceChatTitle: string;
  archiveChatId: string;
  archiveChatTitle: string;
  createdAt: string;
};

/** A watch row as exposed to the client — no session string. */
export type PublicMediaWatch = Omit<MediaWatch, "sessionString">;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToWatch(row: any): MediaWatch {
  return {
    id: row.id,
    userKey: row.user_key,
    sessionString: row.session_string,
    sourceChatId: row.source_chat_id,
    sourceChatTitle: row.source_chat_title ?? "",
    archiveChatId: row.archive_chat_id,
    archiveChatTitle: row.archive_chat_title ?? "",
    createdAt: row.created_at,
  };
}

export function toPublicWatch(watch: MediaWatch): PublicMediaWatch {
  const { sessionString: _s, ...pub } = watch;
  void _s;
  return pub;
}

/** Every watch across all users — used to resume watchers on server boot. */
export async function listAllWatches(): Promise<MediaWatch[]> {
  const { data, error } = await supabase.from(TABLE).select("*");
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToWatch);
}

export async function listWatchesByUser(userKey: string): Promise<MediaWatch[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("user_key", userKey)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToWatch);
}

/** Insert or update the watch for (userKey, sourceChatId). */
export async function upsertWatch(
  watch: Omit<MediaWatch, "id" | "createdAt">,
): Promise<MediaWatch> {
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(
      {
        user_key: watch.userKey,
        session_string: watch.sessionString,
        source_chat_id: watch.sourceChatId,
        source_chat_title: watch.sourceChatTitle,
        archive_chat_id: watch.archiveChatId,
        archive_chat_title: watch.archiveChatTitle,
      },
      { onConflict: "user_key,source_chat_id" },
    )
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToWatch(data);
}

/** Delete a watch, scoped to the owning user. Returns the deleted row's id. */
export async function deleteWatch(
  id: string,
  userKey: string,
): Promise<MediaWatch | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", id)
    .eq("user_key", userKey)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToWatch(data) : null;
}
