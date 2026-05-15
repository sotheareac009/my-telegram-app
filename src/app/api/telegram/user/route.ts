// app/api/telegram/user/route.ts

import { createClient } from "@/lib/telegram";
import { Api } from "telegram";

export async function POST(request: Request) {
    try {
        const body = await request.json();

        const sessionString = body.sessionString;
        const userId = body.userId;

        if (!sessionString) {
            return Response.json(
                { error: "Missing sessionString" },
                { status: 400 }
            );
        }

        if (!userId) {
            return Response.json(
                { error: "Missing userId" },
                { status: 400 }
            );
        }

        const client = createClient(sessionString);
        await client.connect();

        try {
            const result = await client.invoke(
                new Api.users.GetUsers({
                    id: [
                        new Api.InputUser({
                            //@ts-ignore
                            userId: BigInt(userId),
                            //@ts-ignore
                            accessHash: BigInt(0),
                        }),
                    ],
                })
            );

            const user = result[0] as any;

            if (!user) {
                return Response.json(
                    { error: "User not found" },
                    { status: 404 }
                );
            }

            // fetch profile photo
            let photo: string | null = null;
            try {
                const buffer = await Promise.race([
                    client.downloadProfilePhoto(user, { isBig: false }),
                    new Promise<null>((resolve) =>
                        setTimeout(() => resolve(null), 3000)
                    ),
                ]) as Buffer | null;

                if (buffer && buffer.length > 0) {
                    photo = `data:image/jpeg;base64,${buffer.toString("base64")}`;
                }
            } catch {
                // no photo or privacy restricted
            }

            return Response.json({
                success: true,
                user: {
                    id: user.id?.toString(),
                    firstName: user.firstName || "",
                    lastName: user.lastName || "",
                    username: user.username || "",
                    phone: user.phone || "",
                    bio: user.about || "",
                    isOnline: user.status?.className === "UserStatusOnline",
                    lastSeen: user.status?.wasOnline
                        ? new Date(user.status.wasOnline * 1000).toISOString()
                        : null,
                    photo,
                },
            });
        } finally {
            await client.disconnect();
        }
    } catch (error) {
        console.error(error);
        return Response.json(
            { error: "Failed to fetch user" },
            { status: 500 }
        );
    }
}