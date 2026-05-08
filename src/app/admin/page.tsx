"use client";

import { useEffect, useState } from "react";

const PAGE_SIZE = 20;

interface AccessCode {
  id: string;
  code: string;
  is_active: boolean;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  phone_number: string;
}

export default function AdminDashboard() {
  const [password, setPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [codes, setCodes] = useState<AccessCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formFirstName, setFormFirstName] = useState("");
  const [formLastName, setFormLastName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [generating, setGenerating] = useState(false);
  const [formError, setFormError] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function fetchCodes(q: string, p: number) {
    setListLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(p),
        pageSize: String(PAGE_SIZE),
      });
      if (q.trim()) params.set("q", q.trim());

      const res = await fetch(`/api/admin/codes?${params.toString()}`, {
        headers: { "x-admin-password": password },
      });
      if (res.ok) {
        const json = await res.json();
        setCodes(json.data);
        setTotal(json.total);
      }
    } finally {
      setListLoading(false);
    }
  }

  // Reset to page 1 whenever search query changes (page change re-fetches via the effect below)
  function onSearchChange(value: string) {
    setSearchQuery(value);
    setPage(1);
  }

  // Debounced fetch on search/page change once authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    const t = setTimeout(() => {
      fetchCodes(searchQuery, page);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, page, isAuthenticated]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/admin/codes?page=1&pageSize=${PAGE_SIZE}`, {
        headers: { "x-admin-password": password },
      });
      if (res.ok) {
        const json = await res.json();
        setCodes(json.data);
        setTotal(json.total);
        setIsAuthenticated(true);
      } else {
        setError("Invalid admin password");
      }
    } catch {
      setError("Failed to connect");
    } finally {
      setLoading(false);
    }
  }

  function openGenerateModal() {
    setEditingId(null);
    setFormFirstName("");
    setFormLastName("");
    setFormPhone("");
    setFormError("");
    setShowGenerateModal(true);
  }

  function openEditModal(code: AccessCode) {
    setEditingId(code.id);
    setFormFirstName(code.first_name ?? "");
    setFormLastName(code.last_name ?? "");
    setFormPhone(code.phone_number ?? "");
    setFormError("");
    setShowGenerateModal(true);
  }

  async function submitGenerate(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    if (!formPhone.trim()) {
      setFormError("Phone number is required");
      return;
    }

    setGenerating(true);
    try {
      const isEdit = editingId !== null;
      const res = await fetch("/api/admin/codes", {
        method: isEdit ? "PATCH" : "POST",
        headers: {
          "x-admin-password": password,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(isEdit ? { id: editingId } : {}),
          first_name: formFirstName,
          last_name: formLastName,
          phone_number: formPhone,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setShowGenerateModal(false);
        if (isEdit) {
          // Same page — local update is fine and avoids a refetch flicker.
          setCodes(codes.map(c => c.id === updated.id ? updated : c));
        } else {
          // New code: jump back to page 1 and clear any active search so it's visible.
          setSearchQuery("");
          if (page !== 1) {
            setPage(1); // triggers refetch via effect
          } else {
            fetchCodes("", 1);
          }
        }
      } else {
        const data = await res.json().catch(() => ({}));
        setFormError(data.error || (isEdit ? "Failed to update code" : "Failed to generate code"));
      }
    } catch {
      setFormError(editingId ? "Failed to update code" : "Failed to generate code");
    } finally {
      setGenerating(false);
    }
  }

  async function toggleStatus(id: string, currentStatus: boolean) {
    try {
      const res = await fetch("/api/admin/codes", {
        method: "PATCH",
        headers: { 
          "x-admin-password": password,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id, is_active: !currentStatus }),
      });
      if (res.ok) {
        setCodes(codes.map(c => c.id === id ? { ...c, is_active: !currentStatus } : c));
      }
    } catch (err) {
      alert("Failed to update status");
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-zinc-50 p-6">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 -left-40 h-[420px] w-[420px] rounded-full bg-indigo-300/40 blur-3xl" />
          <div className="absolute -bottom-40 -right-40 h-[420px] w-[420px] rounded-full bg-fuchsia-300/40 blur-3xl" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#fafafa_70%)]" />
        </div>

        <form
          onSubmit={handleLogin}
          className="relative w-full max-w-sm rounded-3xl border border-zinc-200/80 bg-white/80 p-8 shadow-xl shadow-zinc-900/5 backdrop-blur-xl"
        >
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-500 to-fuchsia-500 shadow-lg shadow-indigo-500/30 ring-1 ring-white/40">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h1 className="bg-linear-to-b from-zinc-900 to-zinc-700 bg-clip-text text-2xl font-semibold tracking-tight text-transparent">
              Admin Access
            </h1>
            <p className="mt-1.5 text-sm text-zinc-500">
              Sign in to manage access codes
            </p>
          </div>

          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Password
          </label>
          <div className="relative mb-1">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              autoFocus
              className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-zinc-900 placeholder:text-zinc-300 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <div className="min-h-5 mt-2 mb-4">
            {error && (
              <p className="flex items-center gap-1.5 text-sm text-rose-600">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {error}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !password}
            className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-linear-to-r from-indigo-500 to-fuchsia-500 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:shadow-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            {loading ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                  <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                Authenticating
              </>
            ) : (
              <>
                Continue
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-0.5">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </>
            )}
          </button>

          <p className="mt-6 text-center text-xs text-zinc-400">
            Restricted area · Authorized personnel only
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-zinc-50 p-6 dark:bg-zinc-950">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-center justify-between rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Access Codes</h1>
            <p className="text-sm text-zinc-500">Manage user access to the platform</p>
          </div>
          <button
            onClick={openGenerateModal}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-500"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Generate New Code
          </button>
        </div>

        <div className="mb-4 flex items-center gap-3">
          <div className="relative flex-1">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search by code, name, or phone…"
              className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-9 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
          <span className="text-xs text-zinc-500 whitespace-nowrap">
            {listLoading ? "Loading…" : `${total} ${total === 1 ? "result" : "results"}`}
          </span>
        </div>

        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
              <tr>
                <th className="px-6 py-4 font-medium">Access Code</th>
                <th className="px-6 py-4 font-medium">Name</th>
                <th className="px-6 py-4 font-medium">Phone</th>
                <th className="px-6 py-4 font-medium">Created</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {codes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-zinc-500">
                    {listLoading
                      ? "Loading…"
                      : searchQuery
                        ? `No results for "${searchQuery}".`
                        : "No access codes found."}
                  </td>
                </tr>
              ) : codes.map((code) => {
                const fullName = [code.first_name, code.last_name].filter(Boolean).join(" ");
                return (
                  <tr key={code.id} className="transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <td className="px-6 py-4">
                      <code className="rounded-md bg-zinc-100 px-2 py-1 font-mono font-bold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                        {code.code}
                      </code>
                    </td>
                    <td className="px-6 py-4 text-zinc-700 dark:text-zinc-300">
                      {fullName || <span className="text-zinc-400">—</span>}
                    </td>
                    <td className="px-6 py-4 text-zinc-700 dark:text-zinc-300">
                      {code.phone_number || <span className="text-zinc-400">—</span>}
                    </td>
                    <td className="px-6 py-4 text-zinc-500">
                      {new Date(code.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${code.is_active ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20" : "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/10 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20"}`}>
                        {code.is_active ? "Active" : "Revoked"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-4">
                        <button
                          onClick={() => openEditModal(code)}
                          className="text-sm font-semibold text-blue-600 transition-colors hover:text-blue-500"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => toggleStatus(code.id, code.is_active)}
                          className={`text-sm font-semibold transition-colors ${code.is_active ? "text-red-600 hover:text-red-500" : "text-emerald-600 hover:text-emerald-500"}`}
                        >
                          {code.is_active ? "Revoke Access" : "Restore Access"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <p className="text-zinc-500">
              Showing{" "}
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {(page - 1) * PAGE_SIZE + 1}
              </span>
              {"–"}
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {Math.min(page * PAGE_SIZE, total)}
              </span>{" "}
              of{" "}
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{total}</span>
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || listLoading}
                className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                Previous
              </button>
              <span className="px-3 text-zinc-500">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || listLoading}
                className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Next
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/50 backdrop-blur-sm p-4">
          <form
            onSubmit={submitGenerate}
            className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
                  {editingId ? "Edit User Details" : "Generate Access Code"}
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {editingId ? "Update the user information for this code." : "Enter the user details below."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGenerateModal(false)}
                className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  First Name
                </label>
                <input
                  type="text"
                  value={formFirstName}
                  onChange={(e) => setFormFirstName(e.target.value)}
                  placeholder="Optional"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Last Name
                </label>
                <input
                  type="text"
                  value={formLastName}
                  onChange={(e) => setFormLastName(e.target.value)}
                  placeholder="Optional"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Phone Number <span className="text-rose-500">*</span>
              </label>
              <input
                type="tel"
                value={formPhone}
                onChange={(e) => setFormPhone(e.target.value)}
                placeholder="+1 555 123 4567"
                required
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
              />
            </div>

            <div className="min-h-5 mt-3">
              {formError && (
                <p className="text-sm text-rose-600">{formError}</p>
              )}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowGenerateModal(false)}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={generating}
                className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generating
                  ? (editingId ? "Saving..." : "Generating...")
                  : (editingId ? "Save Changes" : "Generate Code")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
