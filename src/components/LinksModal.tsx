"use client";

import { useEffect, useMemo, useState } from "react";

export interface LinkEntry {
  id: number;
  fileName: string;
  caption: string;
  type: "photo" | "video" | "file";
  url: string;
}

interface LinksModalProps {
  entries: LinkEntry[];
  onClose: () => void;
}

function entryTitle(entry: LinkEntry): string {
  const caption = entry.caption.trim();
  if (caption) return caption;
  if (entry.fileName) return entry.fileName;
  return `Item ${entry.id}`;
}

function formatClipboardText(entries: LinkEntry[]): string {
  return entries
    .map((entry) => `${entryTitle(entry)}\n${entry.url}`)
    .join("\n\n");
}

async function writeToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // fall through to legacy path
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  el.remove();
}

export default function LinksModal({ entries, onClose }: LinksModalProps) {
  const text = useMemo(() => formatClipboardText(entries), [entries]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleCopy() {
    await writeToClipboard(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {entries.length} {entries.length === 1 ? "link" : "links"}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Caption (or filename) shown above each download URL
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-5 md:grid-cols-2">
          <div className="flex min-h-[260px] min-w-0 flex-col">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Items
            </p>
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950/40"
                >
                  <p className="break-words text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {entryTitle(entry)}
                  </p>
                  <p className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
                    <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      {entry.type}
                    </span>
                    <span className="truncate">{entry.fileName || `id ${entry.id}`}</span>
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex min-h-[260px] min-w-0 flex-col">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Clipboard preview
            </p>
            <textarea
              readOnly
              value={text}
              onFocus={(e) => e.currentTarget.select()}
              className="min-h-0 flex-1 resize-none rounded-xl border border-zinc-200 bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-700 outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-500"
          >
            {copied ? "Copied" : "Copy to clipboard"}
          </button>
        </div>
      </div>
    </div>
  );
}
