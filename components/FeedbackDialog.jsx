"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";

/**
 * Community feedback dialog (owner request: in-app bug reports & suggestions,
 * retrievable as the project's community issue list).
 *
 * Storage is P2P + local (lib/userfeedback.js): the form SAYS so honestly —
 * reports are shared with other users of the network, not sent to a company
 * server. The dialog also lists existing community reports (newest first)
 * and offers a JSON export for the maintainers (human-run issue import).
 *
 * Dialog contract: role=dialog + aria-modal, Escape closes, initial focus on
 * the type selector, focus is trapped while open.
 */
export default function FeedbackDialog({ open, onClose, page = "unknown" }) {
  const [type, setType] = useState("bug");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [state, setState] = useState("idle"); // idle|sending|sent|error
  const [message, setMessage] = useState("");
  const [reports, setReports] = useState(null);
  const dialogRef = useRef(null);

  // Load the community issue list while open (local + shared, honest degrade).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    import("@/lib/userfeedback").then((m) => m.listFeedback())
      .then((r) => alive && setReports(r))
      .catch(() => alive && setReports([]));
    return () => { alive = false; };
  }, [open, state]);

  // Escape + focus trap (dialog contract).
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Initial focus: first interactive element of the form.
    requestAnimationFrame(() => {
      dialogRef.current?.querySelector("select, input, textarea, button")?.focus();
    });
    const onKey = (e) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;
      const els = [...dialogRef.current?.querySelectorAll("a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])") ?? []];
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    setState("sending");
    setMessage("");
    try {
      const m = await import("@/lib/userfeedback");
      const res = await m.submitFeedback({ type, page, title, body });
      setState("sent");
      setMessage(res.shared
        ? "Report saved and shared with the network — thank you."
        : "Report saved locally (the P2P layer is offline — it will sync on the next submit). Thank you.");
      setTitle(""); setBody("");
    } catch (err) {
      setState("error");
      setMessage(String(err?.message ?? err));
    }
  };

  const exportJson = async () => {
    const m = await import("@/lib/userfeedback");
    const json = await m.exportFeedbackJson();
    try {
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "pharos-community-reports.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Community feedback"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Report an issue · suggest a change</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Reports are saved on your device and shared with other users of the network (P2P) — there is no company server. The maintainers export them as issues for the repository.
            </p>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-zinc-400 hover:text-white" aria-label="Close feedback">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div className="flex gap-2">
            {[
              { id: "bug", label: "🐞 Bug" },
              { id: "suggestion", label: "💡 Suggestion" },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setType(t.id)}
                aria-pressed={type === t.id}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  type === t.id ? "bg-emerald-600 text-white" : "bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="Short title (e.g. “Search ignores genre filter”)"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-600"
            aria-label="Title"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder={"What happened, or what would you change? Include the page and steps if it's a bug."}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-600"
            aria-label="Description"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-zinc-600">Filed from: {page}</span>
            <button
              type="submit"
              disabled={state === "sending"}
              className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {state === "sending" ? "Sending…" : "Send report"}
            </button>
          </div>
          {message && (
            <p role="status" className={`text-xs ${state === "error" ? "text-red-400" : "text-emerald-400"}`}>{message}</p>
          )}
        </form>

        {/* Community issue list */}
        <section className="mt-6" aria-label="Community reports">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
              Community reports {reports ? `(${reports.length})` : ""}
            </h3>
            {reports?.length > 0 && (
              <button onClick={exportJson} className="text-[11px] text-zinc-500 underline hover:text-emerald-400">
                Export JSON (for maintainers)
              </button>
            )}
          </div>
          {reports === null && <p className="text-xs text-zinc-600">Loading reports…</p>}
          {reports?.length === 0 && (
            <p className="text-xs text-zinc-600">No reports yet — yours will be the first.</p>
          )}
          <ul className="divide-y divide-zinc-800/60 rounded-lg border border-zinc-800/60">
            {(reports ?? []).slice(0, 20).map((r) => (
              <li key={r.hash} className="px-3 py-2">
                <p className="text-sm font-medium">
                  <span className={r.type === "bug" ? "text-red-400" : "text-sky-400"}>
                    {r.type === "bug" ? "🐞" : "💡"}
                  </span>{" "}
                  {r.title}
                  {(r.n ?? 1) > 1 && <span className="ml-1.5 text-[11px] text-zinc-600">×{r.n}</span>}
                  {r.mine && <span className="ml-1.5 rounded bg-zinc-800 px-1 text-[10px] text-zinc-400">yours</span>}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{r.body}</p>
                <p className="mt-0.5 text-[10px] text-zinc-700">
                  {r.page} · {new Date(r.at).toISOString().slice(0, 10)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
