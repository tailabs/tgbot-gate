import { KeyboardEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { prettifyAuditBody } from "./auditFormat";
import { useListPageSize } from "./useListPageSize";

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

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MIN_REFRESH_MS = 450;

async function withMinRefreshDuration(run: () => Promise<void>): Promise<void> {
  const started = Date.now();
  await run();
  const remaining = MIN_REFRESH_MS - (Date.now() - started);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
    ...init,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new ApiError(response.status, message || `Request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

type AuditSectionProps = {
  active: boolean;
};

export function AuditSection({ active }: AuditSectionProps) {
  const listViewportRef = useRef<HTMLDivElement>(null);
  const { pageSize, ready: layoutReady } = useListPageSize(listViewportRef, {
    max: 50,
    rowSelector: ".audit-row:not(.audit-row--expanded)",
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
        setNotice({
          kind: "info",
          text: "Audit capture is off. Enable it in Settings.",
        });
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
      if (!captureEnabled) {
        return;
      }

      setIsRefreshing(true);
      try {
        await withMinRefreshDuration(async () => {
          const params = new URLSearchParams();
          params.set("page", String(targetPage));
          params.set("page_size", String(Math.max(1, pageSize)));
          if (search.trim()) {
            params.set("q", search.trim());
          }
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
    if (!active) {
      return;
    }
    void loadStatus();
  }, [active, loadStatus]);

  useEffect(() => {
    if (!active || captureEnabled !== true || !layoutReady) {
      return;
    }
    void loadEntries(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, captureEnabled, layoutReady]);

  useEffect(() => {
    if (!active || captureEnabled !== true || !layoutReady) {
      return;
    }
    void loadEntries(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize]);

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void loadEntries(1);
    }
  }

  return (
    <div className="audit-workspace">
      <header className="page-header">
        <h1 className="page-title">Audit</h1>
      </header>

      <section className="audit-panel material" aria-labelledby="audit-panel-title">
        <div className="audit-panel-toolbar">
          <h2 id="audit-panel-title" className="audit-panel-title">
            Captured requests
          </h2>
        </div>

        <div className="audit-panel-filters">
          <label className="audit-search">
            <Search size={16} strokeWidth={2} className="audit-search-icon" aria-hidden />
            <span className="sr-only">Search audit log</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search path, IP, body…"
              aria-label="Search audit log"
              disabled={captureEnabled === false}
            />
          </label>
          <IconButton
              label="Refresh audit"
              className={isRefreshing ? "icon-btn--refreshing" : ""}
              busy={isRefreshing}
              onClick={() => void (captureEnabled ? loadEntries(page) : loadStatus())}
              variant="toolbar"
            >
              <RefreshCw size={15} strokeWidth={2} aria-hidden />
            </IconButton>
        </div>

        {notice.text ? (
          <p className={`audit-banner audit-banner--${notice.kind}`} role="status">
            {notice.text}
          </p>
        ) : null}

        <div className="audit-panel-body">
          <div className="list-viewport" ref={listViewportRef}>
            {captureEnabled === null ? (
              <div className="empty-state material-inset">
                <p className="empty-title">Loading…</p>
              </div>
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
                  if (details[key]) {
                    return;
                  }
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
        </div>
      </section>
    </div>
  );
}

function PaginationBar({
  page,
  totalPages,
  total,
  disabled,
  onPrevious,
  onNext,
}: {
  page: number;
  totalPages: number;
  total: number;
  disabled?: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const canGoBack = page > 1 && !disabled;
  const canGoForward = page < totalPages && !disabled;

  return (
    <nav className="list-pagination" aria-label="Pagination">
      <div className="pagination-shell">
        <IconButton label="Previous page" variant="toolbar" disabled={!canGoBack} onClick={onPrevious}>
          <ChevronLeft size={16} strokeWidth={2.25} aria-hidden />
        </IconButton>
        <div className="pagination-center" aria-live="polite">
          <p className="pagination-page">
            <span className="pagination-page-current">{page}</span>
            <span className="pagination-page-sep">/</span>
            <span className="pagination-page-total">{totalPages}</span>
          </p>
          <p className="pagination-meta">{total} entries</p>
        </div>
        <IconButton label="Next page" variant="toolbar" disabled={!canGoForward} onClick={onNext}>
          <ChevronRight size={16} strokeWidth={2.25} aria-hidden />
        </IconButton>
      </div>
    </nav>
  );
}

function IconButton({
  busy = false,
  children,
  className = "",
  disabled,
  label,
  onClick,
  variant = "default",
}: {
  busy?: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  variant?: "default" | "toolbar";
}) {
  const variantClass = variant === "toolbar" ? "icon-btn icon-btn--toolbar" : "icon-btn";
  const isDisabled = disabled || busy;
  return (
    <button
      type="button"
      className={`${variantClass} ${className}`.trim()}
      disabled={isDisabled}
      onClick={onClick}
      aria-busy={busy}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function statusTone(status: number): "ok" | "warn" | "error" {
  if (status >= 500) {
    return "error";
  }
  if (status >= 400) {
    return "warn";
  }
  return "ok";
}

function formatAuditTime(tsMs: number): string {
  return new Date(tsMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
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
    return (
      <div className="empty-state material-inset">
        <p className="empty-title">No audit entries</p>
      </div>
    );
  }

  return (
    <ul className="grouped-list grouped-list--inset" aria-label="Audit log">
      {entries.map((entry) => {
        const key = `${entry.shard}:${entry.id}`;
        const expanded = expandedKey === key;
        const detail = details[key];
        return (
          <li key={key} className={`grouped-row audit-row${expanded ? " audit-row--expanded" : ""}`}>
            <button
              type="button"
              className="audit-row-toggle"
              aria-expanded={expanded}
              onClick={() => void onToggle(entry)}
              disabled={isLoading}
            >
              <div className="audit-row-head">
                <span className={`audit-status audit-status--${statusTone(entry.status)}`}>{entry.status}</span>
                <div className="audit-row-primary">
                  <span className="audit-method">{entry.method}</span>
                  <span className="audit-path" title={entry.path}>
                    {entry.path}
                  </span>
                </div>
                <div className="audit-row-trail">
                  <div className="audit-row-metrics">
                    <span className="audit-latency">{entry.latency_ms} ms</span>
                    <time className="audit-time" dateTime={new Date(entry.ts_ms).toISOString()}>
                      {formatAuditTime(entry.ts_ms)}
                    </time>
                  </div>
                  <ChevronDown size={16} strokeWidth={2} className="audit-row-chevron" aria-hidden />
                </div>
              </div>
              <p className="audit-row-sub">
                <span className="audit-client">{entry.client_ip}</span>
              </p>
            </button>
            {expanded ? (
              <div className="audit-detail" aria-label="Request and response bodies">
                {detail ? (
                  <>
                    <section className="audit-detail-pane">
                      <h3 className="audit-detail-heading">Request</h3>
                      <pre className="audit-body">{prettifyAuditBody(detail.request_body)}</pre>
                    </section>
                    <section className="audit-detail-pane">
                      <h3 className="audit-detail-heading">Response</h3>
                      <pre className="audit-body">{prettifyAuditBody(detail.response_body)}</pre>
                    </section>
                  </>
                ) : (
                  <p className="audit-detail-loading">Loading bodies…</p>
                )}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
