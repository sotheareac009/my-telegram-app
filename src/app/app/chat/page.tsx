'use client';

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import TelegramChat from "@/components/TelegramChat";

interface Contact {
    id: string;
    firstName: string;
    lastName?: string;
    username?: string;
    phone?: string;
    photo?: string | null;
    isOnline?: boolean;
    lastSeen?: string | null;
}

export default function ChatPage() {
    const searchParams = useSearchParams();
    const userId = searchParams.get("id") as string;
    console.log("User ID from params:", userId);

    const [contact, setContact] = useState<Contact | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!userId) return;

        async function fetchUser() {
            try {
                setIsLoading(true);
                setError(null);

                const sessionString = localStorage.getItem("sessionString");

                if (!sessionString) {
                    setError("No session found. Please log in again.");
                    return;
                }

                const res = await fetch("/api/telegram/user", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sessionString, userId }),
                });

                const data = await res.json();

                if (!res.ok || !data.success) {
                    setError(data.error || "Failed to fetch user");
                    return;
                }

                setContact(data.user);
            } catch (err) {
                setError("Something went wrong.");
            } finally {
                setIsLoading(false);
            }
        }

        fetchUser();
    }, [userId]);

    console.log("Contact:", contact, "Error:", error);

    if (error) {
        return (
            <div className="flex justify-center items-center h-screen bg-stone-50">
                <div className="text-center">
                    <p className="text-red-400 text-sm">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex justify-center items-center h-screen bg-stone-50">
            <div className="w-[500px] h-screen">
                <TelegramChat
                    //@ts-ignore
                    contact={contact ?? { id: userId, firstName: "" }}
                    messages={[]}
                    onSendMessage={() => { }}
                    isLoading={false}
                    sessionString={localStorage.getItem("sessionString") || undefined}
                />
            </div>
        </div>
    );
}