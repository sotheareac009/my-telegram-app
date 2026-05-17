"use client";

import { createContext, useContext } from "react";

/** A user to open a 1-to-1 chat with (from a contact share or a t.me/<user> link). */
export interface ChatNavUser {
  id: string;
  accessHash?: string;
  firstName: string;
  lastName?: string;
}

/**
 * In-app navigation hooks for chat content. Provided by the Dashboard so chat
 * components can open a Telegram link / contact without prop-drilling.
 */
export interface ChatNavValue {
  /** Resolve a t.me link (or @username) and open the channel/group/chat in-app. */
  openTelegramLink: (url: string) => void;
  /** Open a 1-to-1 chat with the given user in-app. */
  openUserChat: (user: ChatNavUser) => void;
}

const ChatNavContext = createContext<ChatNavValue | null>(null);

export const ChatNavProvider = ChatNavContext.Provider;

/** Returns the nav helpers, or null when rendered outside a provider. */
export function useChatNav(): ChatNavValue | null {
  return useContext(ChatNavContext);
}

/** Hosts t.me, telegram.me and telegram.dog links. */
const TELEGRAM_HOSTS = new Set(["t.me", "telegram.me", "telegram.dog"]);

/**
 * If `url` is a public Telegram link, return the @username it points at.
 * Returns null for non-Telegram links and for invite links (t.me/+… or
 * /joinchat/…) — use {@link telegramInviteHashFromUrl} for those.
 */
export function telegramUsernameFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return null;
  }
  if (!TELEGRAM_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const segment = parsed.pathname.replace(/^\/+/, "").split("/")[0] ?? "";
  // Invite links / joinchat — not a plain username.
  if (!segment || segment.startsWith("+") || segment === "joinchat") {
    return null;
  }
  // Usernames are alphanumeric + underscore; reject anything else.
  if (!/^[a-zA-Z][\w]{2,}$/.test(segment)) return null;
  return segment;
}

/**
 * If `url` is a private-chat invite link (t.me/+<hash> or t.me/joinchat/<hash>),
 * return the invite hash. Returns null for any other link.
 */
export function telegramInviteHashFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return null;
  }
  if (!TELEGRAM_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const segments = parsed.pathname.replace(/^\/+/, "").split("/");
  if (segments[0]?.startsWith("+")) {
    return segments[0].slice(1) || null;
  }
  if (segments[0] === "joinchat" && segments[1]) {
    return segments[1];
  }
  return null;
}

export type TelegramLinkTarget =
  | { kind: "username"; value: string }
  | { kind: "invite"; value: string };

/** Classify a Telegram link as a public username or a private invite hash. */
export function telegramLinkTarget(url: string): TelegramLinkTarget | null {
  const username = telegramUsernameFromUrl(url);
  if (username) return { kind: "username", value: username };
  const invite = telegramInviteHashFromUrl(url);
  if (invite) return { kind: "invite", value: invite };
  return null;
}
