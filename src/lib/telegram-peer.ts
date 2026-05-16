import { Api } from "telegram";
import bigInt from "big-integer";

/**
 * Resolve a Telegram user into an addressable input peer.
 *
 * Every API route spins up a fresh client, so the GramJS entity cache is
 * always cold — passing a bare numeric id to getMessages/sendMessage throws
 * "Could not find the input entity". An explicit `InputPeerUser` (id +
 * accessHash) sidesteps resolution entirely and works on a cold client.
 *
 * When the caller didn't supply an accessHash (or sent the "0" placeholder),
 * we recover it from the account's contact list before giving up.
 */
export async function resolveUserPeer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  userId: string | number,
  accessHash?: string | null,
): Promise<Api.InputPeerUser | string> {
  const idStr = String(userId);

  if (accessHash && accessHash !== "0") {
    return new Api.InputPeerUser({
      userId: bigInt(idStr),
      accessHash: bigInt(String(accessHash)),
    });
  }

  // No usable accessHash — look the user up in the contact list to recover it.
  try {
    const res = await client.invoke(
      new Api.contacts.GetContacts({ hash: bigInt(0) }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const users: any[] = res?.users ?? [];
    const match = users.find((u) => u?.id?.toString() === idStr);
    if (match?.accessHash) {
      return new Api.InputPeerUser({
        userId: bigInt(idStr),
        accessHash: match.accessHash,
      });
    }
  } catch {
    // fall through to the bare-id last resort
  }

  // Last resort: GramJS will try its own resolution (works only if the
  // entity happens to be cached or is a username).
  return idStr;
}

/**
 * Resolve a user into an `InputUser` (the shape `users.GetUsers` needs).
 * Recovers a missing accessHash from the contact list, same as
 * {@link resolveUserPeer}.
 */
export async function resolveInputUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  userId: string | number,
  accessHash?: string | null,
): Promise<Api.InputUser> {
  const idStr = String(userId);

  if (accessHash && accessHash !== "0") {
    return new Api.InputUser({
      userId: bigInt(idStr),
      accessHash: bigInt(String(accessHash)),
    });
  }

  try {
    const res = await client.invoke(
      new Api.contacts.GetContacts({ hash: bigInt(0) }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const users: any[] = res?.users ?? [];
    const match = users.find((u) => u?.id?.toString() === idStr);
    if (match?.accessHash) {
      return new Api.InputUser({
        userId: bigInt(idStr),
        accessHash: match.accessHash,
      });
    }
  } catch {
    // fall through
  }

  // accessHash truly unavailable — accessHash 0 only works for cached entities.
  return new Api.InputUser({ userId: bigInt(idStr), accessHash: bigInt(0) });
}
