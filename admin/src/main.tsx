import React, {
  KeyboardEvent,
  ReactNode,
  type SubmitEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Bot,
  Copy,
  KeyRound,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  Plus,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ShieldCheck,
  Trash2,
  ScrollText,
  Settings,
} from "lucide-react";
import "./styles.css";
import { useListPageSize } from "./useListPageSize";
import { AuditSection } from "./AuditSection";
import { SettingsSection } from "./SettingsSection";

type BotRecord = {
  token_hash: string;
  label: string;
  created_at: number;
};

type BotsResponse = {
  bots: BotRecord[];
};

type Notice = {
  kind: "idle" | "success" | "error";
  text: string;
};

type AppSection = "bots" | "audit" | "settings";

const MIN_REFRESH_MS = 450;

async function withMinRefreshDuration(run: () => Promise<void>): Promise<void> {
  const started = Date.now();
  await run();
  const remaining = MIN_REFRESH_MS - (Date.now() - started);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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

function App() {
  const reduceMotion = useReducedMotion();
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [bots, setBots] = useState<BotRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshingBots, setIsRefreshingBots] = useState(false);
  const [botsPage, setBotsPage] = useState(1);
  const [section, setSection] = useState<AppSection>("bots");
  const [notice, setNotice] = useState<Notice>({ kind: "idle", text: "" });
  const botsListViewportRef = useRef<HTMLDivElement>(null);
  const { pageSize: botsPageSize } = useListPageSize(botsListViewportRef);
  
  const sortedBots = useMemo(
    () => [...bots].sort((left, right) => right.created_at - left.created_at),
    [bots],
  );

  const botsTotalPages = Math.max(1, Math.ceil(sortedBots.length / botsPageSize));

  const paginatedBots = useMemo(() => {
    const page = Math.min(botsPage, botsTotalPages);
    const offset = (page - 1) * botsPageSize;
    return sortedBots.slice(offset, offset + botsPageSize);
  }, [sortedBots, botsPage, botsTotalPages, botsPageSize]);

  useEffect(() => {
    if (botsPage > botsTotalPages) {
      setBotsPage(botsTotalPages);
    }
  }, [botsPage, botsTotalPages]);

  useEffect(() => {
    setBotsPage(1);
  }, [botsPageSize]);

  const loadBots = useCallback(async () => {
    setIsRefreshingBots(true);
    try {
      await withMinRefreshDuration(async () => {
        const data = await api<BotsResponse>("/api/bots");
        setBots(data.bots);
      });
    } finally {
      setIsRefreshingBots(false);
    }
  }, []);


  useEffect(() => {
    if (!isSignedIn) {
      return;
    }

    void loadBots().catch(() => {
      setNotice({ kind: "error", text: "Refresh failed." });
    });
  }, [isSignedIn, loadBots]);


  async function handleLogin(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setNotice({ kind: "idle", text: "" });

    try {
      await api<void>("/api/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setPassword("");
      setIsSignedIn(true);
      setNotice({ kind: "idle", text: "" });
    } catch {
      setNotice({ kind: "error", text: "Wrong password." });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRegister(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setNotice({ kind: "idle", text: "" });

    try {
      await api<BotRecord>("/api/bots", {
        method: "POST",
        body: JSON.stringify({ label, token }),
      });
      setToken("");
      setLabel("");
      setNotice({ kind: "idle", text: "" });
      setBotsPage(1);
      await loadBots();
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Save failed.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(tokenHash: string) {
    setIsLoading(true);
    setNotice({ kind: "idle", text: "" });

    try {
      await api<void>(`/api/bots/${tokenHash}`, { method: "DELETE" });
      setBots((current) => current.filter((bot) => bot.token_hash !== tokenHash));
      setNotice({ kind: "idle", text: "" });
    } catch {
      setNotice({ kind: "error", text: "Remove failed." });
    } finally {
      setIsLoading(false);
    }
  }


  const pageTransition = reduceMotion ? { duration: 0 } : { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] as const };

  return (
    <AnimatePresence mode="wait">
      {!isSignedIn ? (
        <motion.div
          key="login"
          className="login-shell"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98 }}
          transition={pageTransition}
        >
          <main className="login-center">
            <section className="login-panel material" aria-labelledby="login-title">
              <motion.div className="login-brand">
                <div className="icon-slot icon-slot--accent" aria-hidden>
                  <ShieldCheck size={22} strokeWidth={1.75} />
                </div>
                <h1 id="login-title">TG Bot Gate</h1>
              </motion.div>
              <form onSubmit={handleLogin} className="stack">
                <TextInput
                  icon={<LockKeyhole size={18} strokeWidth={1.75} />}
                  label="Password"
                  value={password}
                  onChange={setPassword}
                  type="password"
                  autoComplete="current-password"
                  required
                />
                <Button disabled={isLoading} icon={isLoading ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={18} strokeWidth={1.75} />}>
                  {isLoading ? "…" : "Sign In"}
                </Button>
              </form>
              <Status notice={notice} />
            </section>
          </main>
        </motion.div>
      ) : (
        <motion.div
          key="app"
          className="chrome"
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: 8 }}
          transition={pageTransition}
        >
          <aside className="sidebar material-sidebar" aria-label="Application">
            <div className="sidebar-brand">
              <div className="icon-slot icon-slot--sm" aria-hidden>
                <ShieldCheck size={18} strokeWidth={1.75} />
              </div>
              <span className="sidebar-title">TG Bot Gate</span>
            </div>
            <nav className="sidebar-nav" aria-label="Primary">
              <button type="button" className={`nav-item ${section === "bots" ? "nav-item-active" : ""}`} aria-current={section === "bots" ? "page" : undefined} onClick={() => setSection("bots")}>
                <LayoutDashboard size={17} strokeWidth={1.75} aria-hidden />
                Bots
              </button>
              <button type="button" className={`nav-item ${section === "audit" ? "nav-item-active" : ""}`} aria-current={section === "audit" ? "page" : undefined} onClick={() => setSection("audit")}>
                <ScrollText size={17} strokeWidth={1.75} aria-hidden />
                Audit
              </button>
              <button type="button" className={`nav-item ${section === "settings" ? "nav-item-active" : ""}`} aria-current={section === "settings" ? "page" : undefined} onClick={() => setSection("settings")}>
                <Settings size={17} strokeWidth={1.75} aria-hidden />
                Settings
              </button>
            </nav>
          </aside>

          <div className="main-column main-column--fill">
            {section === "bots" ? (
              <div className="bots-workspace">
            <header className="page-header">
              <h1 className="page-title">Bots</h1>
              <IconButton
                label="Refresh"
                className={isRefreshingBots ? "icon-btn--refreshing" : ""}
                busy={isRefreshingBots}
                onClick={() => void loadBots().catch(() => setNotice({ kind: "error", text: "Refresh failed." }))}
                variant="toolbar"
              >
                <RefreshCw size={15} strokeWidth={2} aria-hidden />
              </IconButton>
            </header>

            <div className="metrics-strip material">
              <StatTile icon={<Bot size={18} strokeWidth={1.75} />} label="Count" value={bots.length.toString()} />
              <StatTile icon={<ShieldCheck size={18} strokeWidth={1.75} />} label="Storage" value="Hashed" />
              <EndpointTile />
            </div>

            <div className="content-stack content-stack--fill">
              <Panel title="Add" className="panel--compact">
                <form onSubmit={handleRegister} className="register-form">
                  <TextInput label="Name" value={label} onChange={setLabel} placeholder="Label" required />
                  <TextInput label="Token" value={token} onChange={setToken} placeholder="Bot token" required />
                  <Button disabled={isLoading} icon={<Plus size={18} strokeWidth={1.75} />} type="submit">
                    Add
                  </Button>
                </form>
                <Status notice={notice} />
              </Panel>

              <Panel title="List" className="panel--fill">
                <div className="list-viewport" ref={botsListViewportRef}>
                  <BotList bots={paginatedBots} isLoading={isLoading} onDelete={handleDelete} measureRow={sortedBots.length === 0} />
                </div>
                {sortedBots.length > botsPageSize ? (
                  <PaginationBar
                    page={Math.min(botsPage, botsTotalPages)}
                    totalPages={botsTotalPages}
                    total={sortedBots.length}
                    disabled={isLoading || isRefreshingBots}
                    onPrevious={() => setBotsPage((current) => Math.max(1, current - 1))}
                    onNext={() => setBotsPage((current) => Math.min(botsTotalPages, current + 1))}
                  />
                ) : null}
              </Panel>
            </div>
              </div>
            ) : section === "audit" ? (
              <AuditSection active />
            ) : (
              <SettingsSection active />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
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

function Button({
  children,
  disabled,
  icon,
  onClick,
  size = "md",
  type = "submit",
  variant = "primary",
}: {
  children: ReactNode;
  disabled?: boolean;
  icon?: ReactNode;
  onClick?: () => void;
  size?: "md" | "sm";
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  return (
    <button
      className={`button ${variant} button--${size}`}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {icon ? <span className="button-lead-icon">{icon}</span> : null}
      <span className="button-label">{children}</span>
    </button>
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

function Panel({
  action,
  children,
  className = "",
  description,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: string;
  title?: string;
}) {
  return (
    <section className={`panel material ${className}`}>
      {title ? (
        <div className="section-heading">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      <div className="panel-body">{children}</div>
    </section>
  );
}

function StatTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="metrics-cell">
      <div className="icon-slot icon-slot--compact" aria-hidden>
        {icon}
      </div>
      <div className="stat-tile-body">
        <span className="stat-tile-label">{label}</span>
        <strong className="stat-tile-value">{value}</strong>
      </div>
    </div>
  );
}

const ENDPOINT_SAMPLE = "/bot<TOKEN>/<METHOD>";

function EndpointTile() {
  function handleCopy() {
    void navigator.clipboard.writeText(ENDPOINT_SAMPLE);
  }

  return (
    <button type="button" className="metrics-cell metrics-cell--interactive" onClick={handleCopy} aria-label="Copy path">
      <div className="endpoint-tile-main">
        <span className="stat-tile-label">Path</span>
        <code className="endpoint-code">{ENDPOINT_SAMPLE}</code>
      </div>
      <span className="endpoint-copy-btn" aria-hidden>
        <Copy size={15} strokeWidth={2} />
      </span>
    </button>
  );
}

function TextInput({
  autoComplete,
  icon,
  label,
  onChange,
  placeholder,
  required,
  type = "text",
  value,
}: {
  autoComplete?: string;
  icon?: ReactNode;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
  value: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <div className="input-shell">
        {icon ? <span className="input-lead-icon">{icon}</span> : null}
        <input
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          type={type}
          value={value}
        />
      </div>
    </label>
  );
}

function Status({ notice }: { notice: Notice }) {
  if (!notice.text) {
    return <p className="status" aria-live="polite" />;
  }

  return (
    <p className={`status ${notice.kind}`} aria-live="polite">
      {notice.text}
    </p>
  );
}

function BotList({
  bots,
  isLoading,
  measureRow = false,
  onDelete,
}: {
  bots: BotRecord[];
  isLoading: boolean;
  measureRow?: boolean;
  onDelete: (tokenHash: string) => Promise<void>;
}) {
  if (bots.length === 0 && !measureRow) {
    return (
      <div className="empty-state material-inset">
        <p className="empty-title">None</p>
      </div>
    );
  }

  return (
    <ul className="grouped-list grouped-list--inset" aria-label="Bots">
      {measureRow ? (
        <li className="grouped-row grouped-row--probe" aria-hidden>
          <div className="row-main">
            <p className="row-title">Probe</p>
            <p className="row-meta">
              <code>0000000000000000000000000000000000000000000000000000000000000000</code>
            </p>
            <p className="row-date">—</p>
          </div>
        </li>
      ) : null}
      {bots.map((bot) => (
        <li key={bot.token_hash} className="grouped-row">
          <div className="row-main">
            <p className="row-title">{bot.label}</p>
            <p className="row-meta">
              <code>{bot.token_hash}</code>
            </p>
            <p className="row-date">{new Date(bot.created_at * 1000).toLocaleString()}</p>
          </div>
          <div className="row-actions">
            <IconButton label="Delete" disabled={isLoading} onClick={() => void onDelete(bot.token_hash)}>
              <Trash2 size={16} strokeWidth={2} />
            </IconButton>
          </div>
        </li>
      ))}
    </ul>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
