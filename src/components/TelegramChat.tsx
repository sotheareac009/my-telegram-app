"use client";

import { useState, useRef, useEffect } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Message {
    id: string;
    text: string;
    timestamp: Date;
    fromMe: boolean;
    status?: "sent" | "delivered" | "read";
}

interface Contact {
    id: string;
    firstName: string;
    lastName?: string;
    username?: string;
    photo?: string | null;
    lastSeen?: string;
    isOnline?: boolean;
}

interface TelegramChatProps {
    contact: Contact;
    messages: Message[];
    onSendMessage: (text: string) => void;
    onBack?: () => void;
    isLoading?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const gradients = [
    "from-[#FF6B6B] to-[#FF8E53]",
    "from-[#4FACFE] to-[#00F2FE]",
    "from-[#43E97B] to-[#38F9D7]",
    "from-[#FA709A] to-[#FEE140]",
    "from-[#A18CD1] to-[#FBC2EB]",
    "from-[#FD746C] to-[#FF9068]",
    "from-[#4481EB] to-[#04BEFE]",
];

function getGradient(id: string) {
    const idx = id?.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    return gradients[idx % gradients.length];
}

function formatTime(date: Date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateLabel(date: Date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

function groupMessagesByDate(messages: Message[]) {
    const groups: { label: string; messages: Message[] }[] = [];
    let lastLabel = "";
    for (const msg of messages) {
        const label = formatDateLabel(msg.timestamp);
        if (label !== lastLabel) {
            groups.push({ label, messages: [msg] });
            lastLabel = label;
        } else {
            groups[groups.length - 1].messages.push(msg);
        }
    }
    return groups;
}

// ── Avatar ─────────────────────────────────────────────────────────────────────
function Avatar({
    contact,
    size = "md",
}: {
    contact: Contact;
    size?: "sm" | "md" | "lg";
}) {
    const [imgError, setImgError] = useState(false);
    const gradient = getGradient(contact.id);
    const name = `${contact.firstName} ${contact.lastName || ""}`.trim();
    const sizeClass = size === "sm" ? "w-8 h-8 text-xs" : size === "lg" ? "w-12 h-12 text-lg" : "w-10 h-10 text-sm";

    return (
        <div className="relative shrink-0">
            <div
                className={`${sizeClass} rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-semibold overflow-hidden`}
            >
                {contact.photo && !imgError ? (
                    <img
                        src={contact.photo}
                        alt={name}
                        className="w-full h-full object-cover"
                        onError={() => setImgError(true)}
                    />
                ) : (
                    name.charAt(0).toUpperCase()
                )}
            </div>
            {contact.isOnline && (
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-[#4dcd5e] rounded-full border-2 border-white" />
            )}
        </div>
    );
}

// ── Tick (read receipt) ────────────────────────────────────────────────────────
function Ticks({ status }: { status?: Message["status"] }) {
    if (!status) return null;
    const color = status === "read" ? "#4dcd5e" : "#aab8c2";
    if (status === "sent") {
        return (
            <svg width="14" height="10" viewBox="0 0 14 10" fill="none" className="inline-block ml-1">
                <path d="M1 5l3 3 5-6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }
    return (
        <svg width="18" height="10" viewBox="0 0 18 10" fill="none" className="inline-block ml-1">
            <path d="M1 5l3 3 5-6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M6 5l3 3 5-6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// ── Bubble ─────────────────────────────────────────────────────────────────────
function Bubble({ msg }: { msg: Message }) {
    return (
        <div className={`flex ${msg.fromMe ? "justify-end" : "justify-start"} mb-1`}>
            <div
                className={`
                    relative max-w-[75%] px-3 py-2 rounded-2xl text-sm leading-relaxed
                    ${msg.fromMe
                        ? "bg-[#effdde] text-[#111] rounded-br-sm shadow-sm"
                        : "bg-white text-[#111] rounded-bl-sm shadow-sm"
                    }
                `}
                style={{ wordBreak: "break-word" }}
            >
                <span>{msg.text}</span>
                <span className="ml-2 text-[10px] text-[#aab8c2] whitespace-nowrap float-right mt-1 -mb-0.5 leading-none select-none">
                    {formatTime(msg.timestamp)}
                    {msg.fromMe && <Ticks status={msg.status} />}
                </span>
            </div>
        </div>
    );
}

// ── Date Divider ───────────────────────────────────────────────────────────────
function DateDivider({ label }: { label: string }) {
    return (
        <div className="flex justify-center my-3">
            <span className="bg-[#ffffffcc] text-[#8a9aaa] text-[11px] px-3 py-1 rounded-full select-none backdrop-blur-sm shadow-sm">
                {label}
            </span>
        </div>
    );
}

// ── Typing Indicator ───────────────────────────────────────────────────────────
function TypingIndicator() {
    return (
        <div className="flex justify-start mb-2">
            <div className="bg-white px-4 py-3 rounded-2xl rounded-bl-sm flex gap-1 items-center shadow-sm">
                {[0, 1, 2].map((i) => (
                    <span
                        key={i}
                        className="w-1.5 h-1.5 rounded-full bg-[#aab8c2] animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.8s" }}
                    />
                ))}
            </div>
        </div>
    );
}

// ── Main Chat Component ────────────────────────────────────────────────────────
export default function TelegramChat({
    contact,
    messages,
    onSendMessage,
    onBack,
    isLoading = false,
}: TelegramChatProps) {
    const [input, setInput] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const grouped = groupMessagesByDate(messages);

    // Scroll behaviour:
    //  - atBottomRef: is the user parked near the bottom of the history?
    //  - didInitialScrollRef: has the one-time jump-to-bottom run for this
    //    chat? Re-armed when the contact changes.
    //  - forceScrollRef: set when the user sends, so their own message is
    //    always revealed even if they were scrolled up reading history.
    const atBottomRef = useRef(true);
    const didInitialScrollRef = useRef(false);
    const forceScrollRef = useRef(false);

    function handleScroll() {
        const el = scrollRef.current;
        if (!el) return;
        const distanceFromBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight;
        atBottomRef.current = distanceFromBottom < 120;
    }

    // New chat selected — re-arm the one-time jump-to-bottom.
    useEffect(() => {
        didInitialScrollRef.current = false;
        atBottomRef.current = true;
    }, [contact.id]);

    // Pin to the latest message only when appropriate, so a background poll
    // doesn't yank the user away from history they're scrolled up reading.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        // First batch for this chat — jump straight to the bottom.
        if (!didInitialScrollRef.current && messages.length > 0) {
            el.scrollTop = el.scrollHeight;
            didInitialScrollRef.current = true;
            atBottomRef.current = true;
            forceScrollRef.current = false;
            return;
        }
        // Otherwise only follow if the user is at the bottom, or just sent.
        if (forceScrollRef.current || atBottomRef.current) {
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
            forceScrollRef.current = false;
        }
    }, [messages, isTyping]);

    // auto-resize textarea
    function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
        setInput(e.target.value);
        e.target.style.height = "auto";
        e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
    }

    function handleSend() {
        const text = input.trim();
        if (!text) return;
        // Reveal the user's own message even if they were reading history.
        forceScrollRef.current = true;
        onSendMessage(text);
        setInput("");
        if (inputRef.current) {
            inputRef.current.style.height = "auto";
        }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }

    const name = `${contact.firstName} ${contact.lastName || ""}`.trim();

    return (
        <div
            className="flex flex-col h-full w-full"
            style={{
                background: "#f0f2f5",
                fontFamily: "'Roboto', sans-serif",
            }}
        >
            {/* ── Header ── */}
            <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-200 shadow-sm shrink-0">
                {onBack && (
                    <button
                        onClick={onBack}
                        className="text-[#8a9aaa] hover:text-[#3390ec] transition-colors p-1 -ml-1 rounded-full hover:bg-[#3390ec]/10"
                        aria-label="Back"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                )}

                <Avatar contact={contact} size="md" />

                <div className="flex-1 min-w-0">
                    <p className="text-[#111] font-medium text-[15px] truncate leading-tight">{name}</p>
                    <p className="text-[#8a9aaa] text-[12px] truncate leading-tight">
                        {contact.isOnline ? (
                            <span className="text-[#4dcd5e]">online</span>
                        ) : (
                            contact.lastSeen || "last seen recently"
                        )}
                    </p>
                </div>

                {/* header actions */}
                <div className="flex gap-1 text-[#8a9aaa]">
                    <button className="p-2 hover:text-[#3390ec] hover:bg-[#3390ec]/10 rounded-full transition-colors">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                    </button>
                    <button className="p-2 hover:text-[#3390ec] hover:bg-[#3390ec]/10 rounded-full transition-colors">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="5" r="1.5" fill="currentColor" />
                            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                            <circle cx="12" cy="19" r="1.5" fill="currentColor" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* ── Messages ── */}
            <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto px-4 py-2"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%234a90d9' fill-opacity='0.04'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                }}
            >
                {isLoading ? (
                    <div className="flex justify-center items-center h-full">
                        <div className="w-8 h-8 border-2 border-[#3390ec] border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex flex-col justify-center items-center h-full gap-3 select-none">
                        <div className="w-16 h-16 rounded-full bg-white shadow flex items-center justify-center">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                                <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke="#aab8c2" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                        </div>
                        <p className="text-[#aab8c2] text-sm">No messages yet. Say hello!</p>
                    </div>
                ) : (
                    <>
                        {grouped.map((group) => (
                            <div key={group.label}>
                                <DateDivider label={group.label} />
                                {group.messages.map((msg) => (
                                    <Bubble key={msg.id} msg={msg} />
                                ))}
                            </div>
                        ))}
                        {isTyping && <TypingIndicator />}
                    </>
                )}
                <div ref={bottomRef} />
            </div>

            {/* ── Input Bar ── */}
            <div className="shrink-0 px-3 py-2 bg-white border-t border-gray-200 flex items-end gap-2">
                {/* emoji button */}
                <button className="text-[#8a9aaa] hover:text-[#3390ec] transition-colors p-2 rounded-full hover:bg-[#3390ec]/10 shrink-0 mb-0.5">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
                        <path d="M8.5 14.5s1 1.5 3.5 1.5 3.5-1.5 3.5-1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        <circle cx="9" cy="10" r="1" fill="currentColor" />
                        <circle cx="15" cy="10" r="1" fill="currentColor" />
                    </svg>
                </button>

                {/* textarea */}
                <div className="flex-1 bg-[#f0f2f5] rounded-2xl px-3 py-2 flex items-end gap-2">
                    <textarea
                        ref={inputRef}
                        rows={1}
                        value={input}
                        onChange={handleInput}
                        onKeyDown={handleKeyDown}
                        placeholder="Message"
                        className="flex-1 bg-transparent text-[#111] placeholder-[#aab8c2] text-sm resize-none outline-none leading-relaxed max-h-[120px] overflow-y-auto"
                        style={{ scrollbarWidth: "none" }}
                    />
                    {/* attach button */}
                    <button className="text-[#8a9aaa] hover:text-[#3390ec] transition-colors shrink-0 mb-0.5">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                </div>

                {/* send / mic button */}
                <button
                    onClick={handleSend}
                    className={`
                        w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all duration-200 mb-0.5
                        ${input.trim()
                            ? "bg-[#3390ec] text-white shadow-lg shadow-[#3390ec]/30 scale-100 hover:scale-105"
                            : "bg-[#f0f2f5] text-[#8a9aaa]"
                        }
                    `}
                    aria-label="Send"
                >
                    {input.trim() ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke="currentColor" strokeWidth="1.5" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            <line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                    )}
                </button>
            </div>
        </div>
    );
}