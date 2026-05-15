"use client";

import { useEffect, useState } from "react";
import { LayoutGrid, List, ChevronLeft, ChevronRight, Search, X, ArrowLeft } from "lucide-react";
import TelegramChat from "@/components/TelegramChat";

type Contact = {
    id: string;
    firstName: string;
    lastName: string;
    username: string;
    phone: string;
    photo?: string;
};

type ChatContact = {
    id: string;
    firstName: string;
    lastName?: string;
    username?: string;
    phone?: string;
    photo?: string | null;
    isOnline?: boolean;
    lastSeen?: string | null;
};

const AVATAR_GRADIENTS = [
    "from-violet-400 to-indigo-500",
    "from-sky-400 to-cyan-500",
    "from-emerald-400 to-teal-500",
    "from-rose-400 to-pink-500",
    "from-amber-400 to-orange-500",
    "from-fuchsia-400 to-purple-500",
];

function getAvatarGradient(name: string) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

function ContactAvatar({ contact, name, gradient }: { contact: any; name: string; gradient: string }) {
    const [imgError, setImgError] = useState(false);
    return (
        <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-semibold text-[15px] shrink-0 shadow-sm overflow-hidden`}>
            {contact.photo && !imgError ? (
                <img
                    src={contact.photo}
                    alt={contact.firstName}
                    className="w-10 h-10 rounded-full object-cover"
                    onError={() => setImgError(true)}
                />
            ) : (
                name.charAt(0).toUpperCase()
            )}
        </div>
    );
}

export default function RecentChats({ sessionString }: { sessionString: string }) {
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState<"list" | "grid">("list");
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [search, setSearch] = useState("");
    const [searchInput, setSearchInput] = useState("");

    // ── Chat state ──
    const [selectedContact, setSelectedContact] = useState<ChatContact | null>(null);
    const [chatLoading, setChatLoading] = useState(false);

    async function loadContacts(currentPage = 1, currentSearch = "") {
        try {
            setLoading(true);
            const res = await fetch("/api/telegram/recent-chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionString, page: currentPage, limit: 30, search: currentSearch }),
            });
            const data = await res.json();
            setContacts(data.contacts || []);
            setTotalPages(data.totalPages || 1);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { loadContacts(page, search); }, [page, search]);

    async function openChat(contact: Contact) {
        // optimistically show chat immediately with basic info
        setSelectedContact({
            id: contact.id,
            firstName: contact.firstName,
            lastName: contact.lastName,
            username: contact.username,
            phone: contact.phone,
            photo: contact.photo ?? null,
        });
        setChatLoading(true);

        // fetch full user details (online status, bio, etc.)
        try {
            const res = await fetch("/api/telegram/user", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionString, userId: contact.id }),
            });
            const data = await res.json();
            if (data.success) {
                setSelectedContact(data.user);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setChatLoading(false);
        }
    }

    function getName(c: Contact) {
        return `${c.firstName || ""} ${c.lastName || ""}`.trim() || "Unknown";
    }

    function handleSearch() { setPage(1); setSearch(searchInput); }
    function clearSearch() { setSearchInput(""); setSearch(""); setPage(1); }

    // ── Chat view ──────────────────────────────────────────────────────────────
    if (selectedContact) {
        return (
            <div className="flex flex-col h-full">
                {/* Breadcrumb */}
                <div className="flex items-center gap-2 px-4 py-2.5 bg-white border-b border-stone-200 shrink-0">
                    <button
                        onClick={() => setSelectedContact(null)}
                        className="flex items-center gap-1.5 text-[13px] font-medium text-stone-500 hover:text-indigo-500 transition-colors"
                    >
                        <ArrowLeft size={15} />
                        Contacts
                    </button>
                    <span className="text-stone-300 text-sm">/</span>
                    <span className="text-[13px] font-medium text-stone-800 truncate">
                        {`${selectedContact.firstName} ${selectedContact.lastName || ""}`.trim()}
                    </span>
                </div>

                {/* Chat */}
                <div className="h-screen flex justify-center">
                    <div className="w-full max-w-[700px] h-full flex flex-col">
                        <div className="flex-1 overflow-hidden">
                            <TelegramChat
                                //@ts-ignore
                                contact={selectedContact}
                                messages={[]}
                                onSendMessage={() => { }}
                                isLoading={chatLoading}
                            />
                        </div>
                    </div>
                </div>

            </div>
        );
    }

    // ── List / Grid view ───────────────────────────────────────────────────────
    return (
        <div className="flex h-full flex-col bg-stone-50">

            {/* ── Header ── */}
            <div className="sticky top-0 z-10 bg-white border-b border-stone-200/80 px-6 pt-5 pb-4 shadow-[0_1px_6px_0_rgba(0,0,0,0.04)]">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-[18px] font-semibold tracking-tight text-stone-900 leading-tight">
                            Contacts
                        </h2>
                        <p className="text-[11px] font-mono text-stone-400 mt-0.5">
                            Page {page} of {totalPages}
                        </p>
                    </div>

                    <div className="flex items-center gap-1 bg-stone-100 rounded-xl p-1 border border-stone-200">
                        <button
                            onClick={() => setView("list")}
                            className={`flex items-center justify-center rounded-lg p-2 transition-all duration-150 ${view === "list"
                                ? "bg-white text-stone-900 shadow-sm border border-stone-200"
                                : "text-stone-400 hover:text-stone-600"
                                }`}
                        >
                            <List size={15} />
                        </button>
                        <button
                            onClick={() => setView("grid")}
                            className={`flex items-center justify-center rounded-lg p-2 transition-all duration-150 ${view === "grid"
                                ? "bg-white text-stone-900 shadow-sm border border-stone-200"
                                : "text-stone-400 hover:text-stone-600"
                                }`}
                        >
                            <LayoutGrid size={15} />
                        </button>
                    </div>
                </div>

                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
                        <input
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                            placeholder="Search contacts…"
                            className="w-full bg-stone-100 border border-stone-200 text-stone-800 text-[13.5px] placeholder-stone-400 rounded-xl py-2.5 pl-9 pr-9 outline-none transition-all focus:bg-white focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50"
                        />
                        {searchInput && (
                            <button
                                onClick={clearSearch}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition-colors"
                            >
                                <X size={13} />
                            </button>
                        )}
                    </div>
                    <button
                        onClick={handleSearch}
                        className="bg-indigo-500 hover:bg-indigo-600 active:scale-[0.97] text-white text-[13.5px] font-medium px-4 rounded-xl transition-all shadow-sm shadow-indigo-200 whitespace-nowrap"
                    >
                        Search
                    </button>
                </div>
            </div>

            {/* ── Body ── */}
            <div className="flex-1 overflow-y-auto min-h-0">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-48 gap-3">
                        <div className="w-6 h-6 rounded-full border-2 border-stone-200 border-t-indigo-500 animate-spin" />
                        <span className="text-[13px] text-stone-400">Loading contacts…</span>
                    </div>
                ) : contacts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 gap-2">
                        <span className="text-3xl opacity-30">🔍</span>
                        <span className="text-[13px] text-stone-400">No contacts found</span>
                    </div>
                ) : view === "list" ? (
                    <div className="py-2">
                        {contacts.map((contact) => {
                            const name = getName(contact);
                            const gradient = getAvatarGradient(name);
                            return (
                                <div
                                    key={contact.id}
                                    onClick={() => openChat(contact)}
                                    className="flex items-center gap-3.5 px-6 py-3 hover:bg-white transition-colors cursor-pointer border-b border-stone-100 last:border-0"
                                >
                                    <ContactAvatar contact={contact} name={name} gradient={gradient} />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[13.5px] font-medium text-stone-800 truncate leading-tight">
                                            {name}
                                        </p>
                                        <p className="text-[11.5px] font-mono text-stone-400 truncate mt-0.5">
                                            {contact.username ? `@${contact.username}` : contact.phone}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-5">
                        {contacts.map((contact) => {
                            const name = getName(contact);
                            const gradient = getAvatarGradient(name);
                            return (
                                <div
                                    key={contact.id}
                                    onClick={() => openChat(contact)}
                                    className="bg-white border border-stone-200 rounded-2xl p-4 text-center cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:shadow-stone-200/80 hover:border-stone-300 transition-all duration-150"
                                >
                                    <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-semibold text-xl mx-auto mb-3 shadow-sm`}>
                                        {name.charAt(0).toUpperCase()}
                                    </div>
                                    <p className="text-[13px] font-medium text-stone-800 truncate leading-tight">
                                        {name}
                                    </p>
                                    <p className="text-[11px] font-mono text-stone-400 truncate mt-1">
                                        {contact.username ? `@${contact.username}` : contact.phone}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Pagination ── */}
            <div className="flex items-center justify-between px-6 py-3.5 border-t border-stone-200 bg-white">
                <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="flex items-center gap-1.5 text-[13px] font-medium text-stone-600 bg-stone-100 hover:bg-stone-200 border border-stone-200 px-3.5 py-2 rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <ChevronLeft size={14} />
                    Prev
                </button>

                <div className="flex items-center gap-1.5">
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => (
                        <button
                            key={i}
                            onClick={() => setPage(i + 1)}
                            className={`rounded-full transition-all duration-200 ${i + 1 === page
                                ? "w-5 h-2 bg-indigo-500"
                                : "w-2 h-2 bg-stone-300 hover:bg-stone-400"
                                }`}
                        />
                    ))}
                </div>

                <button
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="flex items-center gap-1.5 text-[13px] font-medium text-stone-600 bg-stone-100 hover:bg-stone-200 border border-stone-200 px-3.5 py-2 rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    Next
                    <ChevronRight size={14} />
                </button>
            </div>
        </div>
    );
}