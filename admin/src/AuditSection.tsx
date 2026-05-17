import { type KeyboardEvent } from "react";
import { Eye, RefreshCw, Search } from "lucide-react";
import { AuditDetailDialog } from "./components/AuditDetailDialog";
import { auditEntryKey, AUDIT_PAGE_SIZE, useAuditLog, type AuditListItem } from "./hooks/useAuditLog";
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
  glassInset,
} from "./components/ui";
import { cn } from "./lib/cn";

type AuditSectionProps = {
  active: boolean;
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

export function AuditSection({ active }: AuditSectionProps) {
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
  } = useAuditLog(active);

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
      <div className="flex flex-col gap-3.5">
        <PageHeader title="Audit" />

        <Panel>
          <div className="flex flex-wrap items-center gap-2 border-b border-black/6 px-[18px] py-3 dark:border-white/8">
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
            <div className="px-[18px] pt-3">
              <Status kind={notice.kind} text={notice.text} />
            </div>
          ) : null}

          <PanelBody className="flex flex-col gap-3">
            {captureEnabled === null ? (
              <EmptyState title="Loading…" />
            ) : captureEnabled === false ? (
              <EmptyState title="Audit capture is off" />
            ) : entries.length === 0 && !isListLoading ? (
              <EmptyState title="No audit entries" />
            ) : (
              <div
                className={cn(glassInset, "overflow-x-auto", isListLoading && "pointer-events-none opacity-60")}
                aria-busy={isListLoading}
              >
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <caption className="sr-only">Audit log, {AUDIT_PAGE_SIZE} rows per page</caption>
                  <thead>
                    <tr className="border-b border-black/6 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:border-white/8 dark:text-zinc-400">
                      <th className="px-3 py-2.5 font-semibold">Status</th>
                      <th className="px-3 py-2.5 font-semibold">Method</th>
                      <th className="px-3 py-2.5 font-semibold">Path</th>
                      <th className="hidden px-3 py-2.5 font-semibold sm:table-cell">Client</th>
                      <th className="hidden px-3 py-2.5 font-semibold md:table-cell">Latency</th>
                      <th className="hidden px-3 py-2.5 font-semibold lg:table-cell">Time</th>
                      <th className="px-3 py-2.5 font-semibold">
                        <span className="sr-only">Bodies</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/6 dark:divide-white/8">
                    {entries.map((entry) => (
                      <AuditTableRow
                        key={auditEntryKey(entry)}
                        entry={entry}
                        onView={() => void openDetail(entry)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {captureEnabled ? (
              totalPages > 1 ? (
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
              )
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

function AuditTableRow({ entry, onView }: { entry: AuditListItem; onView: () => void }) {
  const tone = statusTone(entry.status);

  return (
    <tr className="text-zinc-800 dark:text-zinc-100">
      <td className="px-3 py-2.5 align-middle">
        <span
          className={cn(
            "inline-flex min-w-10 items-center justify-center rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums",
            statusClass[tone],
          )}
        >
          {entry.status}
        </span>
      </td>
      <td className="px-3 py-2.5 align-middle font-mono text-xs font-semibold text-zinc-500">
        {entry.method}
      </td>
      <td className="max-w-[min(24rem,40vw)] truncate px-3 py-2.5 align-middle font-mono text-sm" title={entry.path}>
        {entry.path}
      </td>
      <td className="hidden px-3 py-2.5 align-middle text-xs text-zinc-500 sm:table-cell">{entry.client_ip}</td>
      <td className="hidden px-3 py-2.5 align-middle text-xs tabular-nums text-zinc-500 md:table-cell">
        {entry.latency_ms} ms
      </td>
      <td className="hidden px-3 py-2.5 align-middle text-xs whitespace-nowrap text-zinc-500 lg:table-cell">
        <time dateTime={new Date(entry.ts_ms).toISOString()}>{formatAuditTime(entry.ts_ms)}</time>
      </td>
      <td className="px-3 py-2.5 align-middle">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-auto"
          icon={<Eye size={16} strokeWidth={2} />}
          onClick={onView}
        >
          Bodies
        </Button>
      </td>
    </tr>
  );
}
