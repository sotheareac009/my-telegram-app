// app/api/telegram/contacts/route.ts

import { createClient } from "@/lib/telegram";
import { Api } from "telegram";

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
            //@ts-ignore
            let contacts = result.users.map((user: any) => ({
                id: user.id?.toString(),
                // accessHash is the per-user security token the conversation /
                // send-message routes need to address this user.
                accessHash: user.accessHash ? user.accessHash.toString() : "0",
                firstName: user.firstName || "",
                lastName: user.lastName || "",
                username: user.username || "",
                phone: user.phone || "",
            }));

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