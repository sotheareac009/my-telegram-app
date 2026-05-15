// app/api/telegram/contacts/route.ts

import { createClient } from "@/lib/telegram";
import { Api } from "telegram";

// simple in-memory cache: userId -> base64 photo
const photoCache = new Map<string, string | null>();

async function fetchPhotoWithTimeout(
    client: any,
    user: any,
    timeoutMs = 3000
): Promise<string | null> {
    const cached = photoCache.get(user.id?.toString());
    if (cached !== undefined) return cached;

    try {
        const result = await Promise.race([
            client.downloadProfilePhoto(user, { isBig: false }),
            new Promise<null>((resolve) =>
                setTimeout(() => resolve(null), timeoutMs)
            ),
        ]);

        const buffer = result as Buffer | null;
        const photo =
            buffer && buffer.length > 0
                ? `data:image/jpeg;base64,${buffer.toString("base64")}`
                : null;

        photoCache.set(user.id?.toString(), photo);
        return photo;
    } catch {
        photoCache.set(user.id?.toString(), null);
        return null;
    }
}

// fetch in batches to avoid hammering the connection
async function fetchPhotosInBatches(
    client: any,
    contacts: any[],
    batchSize = 5
): Promise<(string | null)[]> {
    const results: (string | null)[] = [];

    for (let i = 0; i < contacts.length; i += batchSize) {
        const batch = contacts.slice(i, i + batchSize);
        const batchResults = await Promise.all(
            batch.map((c) => fetchPhotoWithTimeout(client, c._raw))
        );
        results.push(...batchResults);
    }

    return results;
}

export async function POST(request: Request) {
    try {
        const body = await request.json();

        const sessionString = body.sessionString;
        const page = Number(body.page || 1);
        const limit = Number(body.limit || 30);
        const search = String(body.search || "").toLowerCase();

        if (!sessionString) {
            return Response.json(
                { error: "Missing sessionString" },
                { status: 400 }
            );
        }

        const client = createClient(sessionString);
        await client.connect();

        try {
            const result = await client.invoke(
                new Api.messages.GetDialogs({
                    offsetDate: 0,
                    offsetId: 0,
                    offsetPeer: new Api.InputPeerEmpty(),
                    limit: 100,
                    //@ts-ignore
                    hash: BigInt(0),
                })
            );

            // @ts-ignore
            const users: Map<string, any> = new Map(
                // @ts-ignore
                (result.users || []).map((u: any) => [u.id?.toString(), u])
            );

            // @ts-ignore
            let recentChats = (result.dialogs || [])
                .filter((dialog: any) => dialog.peer?.className === "PeerUser")
                .map((dialog: any) => {
                    const userId = dialog.peer.userId?.toString();
                    const user = users.get(userId);
                    if (!user) return null;
                    return {
                        id: userId,
                        firstName: user.firstName || "",
                        lastName: user.lastName || "",
                        username: user.username || "",
                        phone: user.phone || "",
                        _raw: user,
                    };
                })
                .filter(Boolean);

            if (search) {
                recentChats = recentChats.filter((contact: any) => {
                    const fullName =
                        `${contact.firstName} ${contact.lastName}`.toLowerCase();
                    return (
                        fullName.includes(search) ||
                        contact.username.toLowerCase().includes(search) ||
                        contact.phone.toLowerCase().includes(search)
                    );
                });
            }

            const total = recentChats.length;
            const totalPages = Math.ceil(total / limit);
            const start = (page - 1) * limit;
            const end = start + limit;
            const pageChats = recentChats.slice(start, end);

            // fetch photos in batches of 5
            const photos = await fetchPhotosInBatches(client, pageChats, 5);

            const contacts = pageChats.map((contact: any, i: number) => {
                const { _raw, ...rest } = contact;
                return { ...rest, photo: photos[i] };
            });

            return Response.json({
                success: true,
                page,
                limit,
                total,
                totalPages,
                contacts,
            });
        } finally {
            await client.disconnect();
        }
    } catch (error) {
        console.error(error);
        return Response.json(
            { error: "Failed to fetch recent chats" },
            { status: 500 }
        );
    }
}