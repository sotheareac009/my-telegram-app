// app/api/telegram/contacts/route.ts

import { createClient } from "@/lib/telegram";
import { Api } from "telegram";

/** Cap per-photo download so one slow avatar can't stall the whole list. */
const PHOTO_TIMEOUT_MS = 5000;

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
                new Api.contacts.GetContacts({
                    //@ts-ignore
                    hash: BigInt(0),
                })
            );
            // Keep each user's resolved entity so we can download its profile
            // photo after pagination.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const entityById = new Map<string, any>();
            //@ts-ignore
            let contacts = result.users.map((user: any) => {
                const id = user.id?.toString();
                if (id) entityById.set(id, user);
                return {
                    id,
                    // accessHash is the per-user security token the conversation /
                    // send-message routes need to address this user.
                    accessHash: user.accessHash ? user.accessHash.toString() : "0",
                    firstName: user.firstName || "",
                    lastName: user.lastName || "",
                    username: user.username || "",
                    phone: user.phone || "",
                    photo: undefined as string | undefined,
                };
            });

            // search
            if (search) {
                contacts = contacts.filter((contact: any) => {
                    const fullName =
                        `${contact.firstName} ${contact.lastName}`.toLowerCase();

                    return (
                        fullName.includes(search) ||
                        contact.username.toLowerCase().includes(search) ||
                        contact.phone.toLowerCase().includes(search)
                    );
                });
            }

            // pagination
            const total = contacts.length;
            const totalPages = Math.ceil(total / limit);

            const start = (page - 1) * limit;
            const end = start + limit;

            const paginatedContacts = contacts.slice(start, end);

            // Download profile photos for just this page, in parallel. Each is
            // best-effort and time-boxed so the list never hangs on a slow one.
            await Promise.all(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                paginatedContacts.map(async (contact: any) => {
                    const entity = entityById.get(contact.id);
                    if (
                        !entity ||
                        !(entity.photo instanceof Api.UserProfilePhoto)
                    ) {
                        return;
                    }
                    try {
                        const buf = (await Promise.race([
                            client.downloadProfilePhoto(entity, { isBig: false }),
                            new Promise<null>((resolve) =>
                                setTimeout(() => resolve(null), PHOTO_TIMEOUT_MS),
                            ),
                        ])) as Buffer | null;
                        if (buf && buf.length > 0) {
                            const b =
                                buf instanceof Buffer ? buf : Buffer.from(buf);
                            contact.photo = `data:image/jpeg;base64,${b.toString("base64")}`;
                        }
                    } catch {
                        // no photo / privacy-restricted — gradient fallback
                    }
                }),
            );

            return Response.json({
                success: true,
                page,
                limit,
                total,
                totalPages,
                contacts: paginatedContacts,
            });
        } finally {
            await client.disconnect();
        }
    } catch (error) {
        console.error(error);

        return Response.json(
            { error: "Failed to fetch contacts" },
            { status: 500 }
        );
    }
}