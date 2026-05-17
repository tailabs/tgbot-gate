import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { prettifyAuditBody } from "../auditFormat";
import type { AuditDetail, AuditListItem } from "../hooks/useAuditLog";
import { cn } from "../lib/cn";
import { glass } from "./ui";

type BodyTab = "request" | "response";

type AuditDetailDialogProps = {
  detail: AuditDetail | null;
  entry: AuditListItem | null;
  loading: boolean;
  onClose: () => void;
};

function formatTime(tsMs: number): string {
  return new Date(tsMs).toLocaleString();
}

export function AuditDetailDialog({ detail, entry, loading, onClose }: AuditDetailDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<BodyTab>("request");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (entry) {
      if (!dialog.open) {
        dialog.showModal();
      }
      setTab("request");
    } else if (dialog.open) {
      dialog.close();
    }
  }, [entry]);

  if (!entry) {
    return null;
  }

  const statusTone = entry.status >= 500 ? "error" : entry.status >= 400 ? "warn" : "ok";

  const statusClass = {
    ok: "bg-green-500/15 text-green-700 dark:text-green-400",
    warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    error: "bg-red-500/15 text-red-600 dark:text-red-400",
  }[statusTone];

  return (
    <dialog
      ref={dialogRef}
      className={cn(
        glass,
        "m-auto flex h-[min(88dvh,40rem)] w-[min(92vw,42rem)] max-w-none flex-col border-0 p-0",
        "backdrop:bg-black/45",
      )}
      onClose={onClose}
      aria-labelledby="audit-detail-title"
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-black/6 px-5 py-4 dark:border-white/8">
        <div className="min-w-0 flex-1">
          <p className="m-0 mb-2 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums",
                statusClass,
              )}
            >
              {entry.status}
            </span>
            <span className="font-mono text-xs font-semibold text-zinc-500">{entry.method}</span>
          </p>
          <h2
            id="audit-detail-title"
            className="m-0 break-all font-mono text-sm font-medium text-zinc-900 dark:text-zinc-50"
          >
            {entry.path}
          </h2>
          <p className="m-0 mt-2 text-xs text-zinc-500">
            {entry.client_ip} · {entry.latency_ms} ms · {formatTime(entry.ts_ms)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-black/6 dark:hover:bg-white/10"
          aria-label="Close"
        >
          <X size={18} strokeWidth={2} />
        </button>
      </header>

      <div
        className="flex shrink-0 gap-1 border-b border-black/6 px-5 pt-2 dark:border-white/8"
        role="tablist"
      >
        {(["request", "response"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "rounded-t-lg px-3 py-2 text-sm font-medium capitalize transition-colors",
              tab === value
                ? "bg-black/6 text-zinc-900 dark:bg-white/10 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
            )}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5" role="tabpanel">
        {loading ? (
          <p className="m-0 text-sm text-zinc-500">Loading bodies…</p>
        ) : detail ? (
          <pre className="m-0 rounded-lg bg-black/5 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all dark:bg-white/6">
            {tab === "request"
              ? prettifyAuditBody(detail.request_body)
              : prettifyAuditBody(detail.response_body)}
          </pre>
        ) : (
          <p className="m-0 text-sm text-zinc-500">Failed to load bodies.</p>
        )}
      </div>
    </dialog>
  );
}