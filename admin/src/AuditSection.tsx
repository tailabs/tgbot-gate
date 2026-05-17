import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw, Search } from "lucide-react";
import { prettifyAuditBody } from "./auditFormat";
import { useListPageSize } from "./useListPageSize";
import { api, ApiError, withMinRefreshDuration } from "./lib/api";
import {
  EmptyState,
  IconButton,
  PageHeader,
  PaginationBar,
  Panel,
  PanelBody,
  Status,
  glassInset,
} from "./components/ui";
import { cn } from "./lib/cn";

export type AuditListItem = {
  shard: string;
  id: number;
  ts_ms: number;
  method: string;
  path: string;
  kind: string;
  status: number;
  latency_ms: number;
  client_ip: string;
};

export type AuditDetail = AuditListItem & {
  request_body?: string | null;
  response_body?: string | null;
};

type AuditListResponse = {
  entries: AuditListItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

type AuditStatusResponse = {
  enabled: boolean;
};

type Notice = {
  kind: "idle" | "info" | "error";
  text: string;
};

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
};

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
  const listViewportRef = useRef<HTMLDivElement>(null);
  const { pageSize, ready: layoutReady } = useListPageSize(listViewportRef, {
    max: 50,
    rowSelector: "[data-audit-row]:not([data-expanded])",
    fallbackRowHeight: 68,
  });

  const [captureEnabled, setCaptureEnabled] = useState<boolean | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<AuditListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, AuditDetail>>({});
  const [notice, setNotice] = useState<Notice>({ kind: "idle", text: "" });

  const loadStatus = useCallback(async () => {
    try {
      const status = await api<AuditStatusResponse>("/api/audit/status");
      setCaptureEnabled(status.enabled);
      if (!status.enabled) {
        setNotice({ kind: "info", text: "Audit capture is off. Enable it in Settings." });
        setEntries([]);
        setTotal(0);
        setTotalPages(1);
      } else {
        setNotice({ kind: "idle", text: "" });
      }
    } catch {
      setCaptureEnabled(false);
      setNotice({ kind: "error", text: "Could not read audit status." });
    }
  }, []);

  const loadEntries = useCallback(
    async (targetPage = page) => {
      if (!captureEnabled) return;

      setIsRefreshing(true);
      try {
        await withMinRefreshDuration(async () => {
          const params = new URLSearchParams();
          params.set("page", String(targetPage));
          params.set("page_size", String(Math.max(1, pageSize)));
          if (search.trim()) params.set("q", search.trim());
          const data = await api<AuditListResponse>(`/api/audit?${params.toString()}`);
          setEntries(data.entries);
          setPage(data.page);
          setTotal(data.total);
          setTotalPages(data.total_pages);
          setExpandedKey(null);
          setDetails({});
          setNotice({ kind: "idle", text: "" });
        });
      } catch (error) {
        setEntries([]);
        setTotal(0);
        setTotalPages(1);
        setExpandedKey(null);
        setDetails({});
        const message =
          error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Audit refresh failed.";
        setNotice({ kind: "error", text: message });
      } finally {
        setIsRefreshing(false);
      }
    },
    [captureEnabled, page, pageSize, search],
  );

  useEffect(() => {
    if (!active) return;
    void loadStatus();
  }, [active, loadStatus]);

  useEffect(() => {
    if (!active || captureEnabled !== true || !layoutReady) return;
    void loadEntries(1);
  }, [active, captureEnabled, layoutReady]);

  useEffect(() => {
    if (!active || captureEnabled !== true || !layoutReady) return;
    void loadEntries(1);
  }, [pageSize]);

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void loadEntries(1);
    }
  }

  if (!active) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      <PageHeader title="Audit" />

      <Panel className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-black/6 px-[18px] py-3 dark:border-white/8">
          <h2 className="m-0 text-[13px] font-semibold tracking-[0.08em] text-zinc-500 uppercase">
            Captured requests
          </h2>
        </div>

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
          <IconButton
            label="Refresh audit"
            busy={isRefreshing}
            variant="toolbar"
            onClick={() => void (captureEnabled ? loadEntries(page) : loadStatus())}
          >
            <RefreshCw size={15} strokeWidth={2} aria-hidden />
          </IconButton>
        </div>

        {notice.text ? (
          <div className="px-[18px] pt-3">
            <Status kind={notice.kind} text={notice.text} />
          </div>
        ) : null}

        <PanelBody className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="min-h-0 flex-1 overflow-y-auto" ref={listViewportRef}>
            {captureEnabled === null ? (
              <EmptyState title="Loading…" />
            ) : (
              <AuditList
                entries={entries}
                expandedKey={expandedKey}
                details={details}
                isLoading={isRefreshing}
                onToggle={async (item) => {
                  const key = `${item.shard}:${item.id}`;
                  if (expandedKey === key) {
                    setExpandedKey(null);
                    return;
                  }
                  setExpandedKey(key);
                  if (details[key]) return;
                  try {
                    const detail = await api<AuditDetail>(`/api/audit/${item.shard}/${item.id}`);
                    setDetails((current) => ({ ...current, [key]: detail }));
                  } catch {
                    setNotice({ kind: "error", text: "Failed to load audit detail." });
                  }
                }}
              />
            )}
          </div>
          {captureEnabled && totalPages > 1 ? (
            <PaginationBar
              page={page}
              totalPages={totalPages}
              total={total}
              disabled={isRefreshing}
              onPrevious={() => void loadEntries(page - 1)}
              onNext={() => void loadEntries(page + 1)}
            />
          ) : null}
        </PanelBody>
      </Panel>
    </div>
  );
}

function AuditList({
  entries,
  expandedKey,
  details,
  isLoading,
  onToggle,
}: {
  entries: AuditListItem[];
  expandedKey: string | null;
  details: Record<string, AuditDetail>;
  isLoading: boolean;
  onToggle: (item: AuditListItem) => Promise<void>;
}) {
  if (entries.length === 0) {
    return <EmptyState title="No audit entries" />;
  }

  return (
    <ul className={cn(glassInset, "divide-y divide-black/6 dark:divide-white/8")} aria-label="Audit log">
      {entries.map((entry) => {
        const key = `${entry.shard}:${entry.id}`;
        const expanded = expandedKey === key;
        const detail = details[key];
        const tone = statusTone(entry.status);
        return (
          <li
            key={key}
            data-audit-row
            data-expanded={expanded ? "" : undefined}
            className={cn(expanded && "bg-black/3 dark:bg-white/4")}
          >
            <button
              type="button"
              className="w-full px-4 py-3 text-left disabled:opacity-50"
              aria-expanded={expanded}
              onClick={() => void onToggle(entry)}
              disabled={isLoading}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className={cn(
                    "inline-flex min-w-10 shrink-0 items-center justify-center rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums",
                    statusClass[tone],
                  )}
                >
                  {entry.status}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-mono text-xs font-semibold text-zinc-500">{entry.method}</span>
                    <span className="truncate font-mono text-sm text-zinc-800 dark:text-zinc-100" title={entry.path}>
                      {entry.path}
                    </span>
                  </div>
                  <p className="m-0 mt-1 text-xs text-zinc-500">{entry.client_ip}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-right text-xs text-zinc-500">
                  <div>
                    <p className="m-0 tabular-nums">{entry.latency_ms} ms</p>
                    <time className="m-0 block" dateTime={new Date(entry.ts_ms).toISOString()}>
                      {formatAuditTime(entry.ts_ms)}
                    </time>
                  </div>
                  <ChevronDown
                    size={16}
                    strokeWidth={2}
                    className={cn("transition-transform", expanded && "rotate-180")}
                    aria-hidden
                  />
                </div>
              </div>
            </button>
            {expanded ? (
              <div className="space-y-3 border-t border-black/6 px-4 pb-4 dark:border-white/8">
                {detail ? (
                  <>
                    <section>
                      <h3 className="m-0 mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                        Request
                      </h3>
                      <pre className="m-0 max-h-64 overflow-auto rounded-lg bg-black/5 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all dark:bg-white/6">
                        {prettifyAuditBody(detail.request_body)}
                      </pre>
                    </section>
                    <section>
                      <h3 className="m-0 mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                        Response
                      </h3>
                      <pre className="m-0 max-h-64 overflow-auto rounded-lg bg-black/5 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all dark:bg-white/6">
                        {prettifyAuditBody(detail.response_body)}
                      </pre>
                    </section>
                  </>
                ) : (
                  <p className="m-0 text-sm text-zinc-500">Loading bodies…</p>
                )}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
