import { type KeyboardEvent, useRef } from "react";
import { Eye, RefreshCw, Search } from "lucide-react";
import { AuditDetailDialog } from "./components/AuditDetailDialog";
import { auditEntryKey, useAuditLog, type AuditListItem } from "./hooks/useAuditLog";
import { useViewportPageSize } from "./hooks/useViewportPageSize";
import {
  Button,
  EmptyState,
  IconButton,
  PageHeader,
  PaginationBar,
  Panel,
  PanelBody,
  PanelHeading,
  Status,
} from "./components/ui";
import { cn } from "./lib/cn";

const ROW_PX = 52;

type AuditSectionProps = {
  active: boolean;
  className?: string;
};

function statusTone(status: number): "ok" | "warn" | "error" {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "ok";
}

const statusClass = {
  ok: "bg-green-500/15 text-green-700 dark:text-green-400",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  error: "bg-red-500/15 text-red-600 dark:text-red-400",
} as const;

function formatAuditTime(tsMs: number): string {
  return new Date(tsMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function AuditSection({ active, className }: AuditSectionProps) {
  const listViewportRef = useRef<HTMLDivElement>(null);
  const pageSize = useViewportPageSize(listViewportRef, { max: 50, min: 5, rowPx: ROW_PX });

  const {
    captureEnabled,
    closeModal,
    entries,
    goToPage,
    isDetailLoading,
    isListLoading,
    modalDetail,
    modalEntry,
    notice,
    openDetail,
    page,
    refresh,
    runSearch,
    search,
    setSearch,
    total,
    totalPages,
  } = useAuditLog(active, pageSize);

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      runSearch();
    }
  }

  if (!active) {
    return null;
  }

  return (
    <>
      <div className={cn("flex min-h-0 flex-1 flex-col gap-3.5", className)}>
        <PageHeader title="Audit" className="shrink-0" />

        <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <PanelHeading title="Captured requests" className="shrink-0" />

          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-black/6 px-[18px] py-3 dark:border-white/8">
            <label className="flex min-h-10 min-w-[200px] flex-1 items-center gap-2 rounded-[10px] border border-black/6 bg-black/4 px-3 dark:border-white/10 dark:bg-white/6">
              <Search size={16} strokeWidth={2} className="shrink-0 text-zinc-500" aria-hidden />
              <span className="sr-only">Search audit log</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search path, IP, body…"
                aria-label="Search audit log"
                disabled={captureEnabled === false}
                className="min-w-0 flex-1 border-0 bg-transparent outline-none"
              />
            </label>
            <IconButton label="Refresh audit" busy={isListLoading} variant="toolbar" onClick={refresh}>
              <RefreshCw size={15} strokeWidth={2} aria-hidden />
            </IconButton>
          </div>

          {notice.text ? (
            <div className="shrink-0 px-[18px] pt-3">
              <Status kind={notice.kind} text={notice.text} />
            </div>
          ) : null}

          <PanelBody className="flex min-h-0 flex-1 flex-col !p-0">
            <div
              ref={listViewportRef}
              className={cn(
                "min-h-0 flex-1 overflow-y-auto px-[18px] py-3",
                isListLoading && "pointer-events-none opacity-60",
              )}
              aria-busy={isListLoading}
            >
              {captureEnabled === null ? (
                <EmptyState title="Loading…" />
              ) : captureEnabled === false ? (
                <EmptyState title="Audit capture is off" />
              ) : entries.length === 0 && !isListLoading ? (
                <EmptyState title="No audit entries" />
              ) : (
                <ul className="m-0 list-none divide-y divide-black/6 p-0 dark:divide-white/8" aria-label="Audit log">
                  {entries.map((entry) => (
                    <AuditRow
                      key={auditEntryKey(entry)}
                      entry={entry}
                      onView={() => void openDetail(entry)}
                    />
                  ))}
                </ul>
              )}
            </div>

            {captureEnabled ? (
              <footer className="shrink-0 border-t border-black/6 px-[18px] py-3 dark:border-white/8">
                {totalPages > 1 ? (
                  <PaginationBar
                    page={page}
                    totalPages={totalPages}
                    total={total}
                    disabled={isListLoading}
                    onPrevious={() => goToPage(page - 1)}
                    onNext={() => goToPage(page + 1)}
                  />
                ) : (
                  <p className="m-0 text-center text-xs text-zinc-500">
                    {total === 0 ? "No entries" : `${total} ${total === 1 ? "entry" : "entries"}`}
                  </p>
                )}
              </footer>
            ) : null}
          </PanelBody>
        </Panel>
      </div>

      <AuditDetailDialog
        entry={modalEntry}
        detail={modalDetail}
        loading={isDetailLoading}
        onClose={closeModal}
      />
    </>
  );
}

function AuditRow({ entry, onView }: { entry: AuditListItem; onView: () => void }) {
  const tone = statusTone(entry.status);

  return (
    <li className="flex items-center gap-3 py-2.5">
      <span
        className={cn(
          "inline-flex min-w-10 shrink-0 items-center justify-center rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums",
          statusClass[tone],
        )}
      >
        {entry.status}
      </span>

      <div className="grid min-w-0 flex-1 grid-cols-1 gap-0.5 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-x-3">
        <span className="font-mono text-xs font-semibold text-zinc-500">{entry.method}</span>
        <span
          className="truncate font-mono text-sm text-zinc-800 dark:text-zinc-100"
          title={entry.path}
        >
          {entry.path}
        </span>
        <span className="text-xs text-zinc-500 sm:text-right">{entry.client_ip}</span>
      </div>

      <div className="hidden shrink-0 text-right text-xs text-zinc-500 sm:block">
        <p className="m-0 tabular-nums">{entry.latency_ms} ms</p>
        <time className="m-0 block whitespace-nowrap" dateTime={new Date(entry.ts_ms).toISOString()}>
          {formatAuditTime(entry.ts_ms)}
        </time>
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-auto shrink-0"
        icon={<Eye size={16} strokeWidth={2} />}
        onClick={onView}
      >
        Bodies
      </Button>
    </li>
  );
}
