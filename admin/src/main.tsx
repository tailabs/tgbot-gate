import React, { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
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
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import "./styles.css";

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
    throw new Error(message || `Request failed with ${response.status}`);
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
  const [notice, setNotice] = useState<Notice>({ kind: "idle", text: "" });

  const sortedBots = useMemo(
    () => [...bots].sort((left, right) => right.created_at - left.created_at),
    [bots],
  );

  const loadBots = useCallback(async () => {
    const data = await api<BotsResponse>("/api/bots");
    setBots(data.bots);
  }, []);

  useEffect(() => {
    if (!isSignedIn) {
      return;
    }

    void loadBots().catch(() => {
      setNotice({ kind: "error", text: "Refresh failed." });
    });
  }, [isSignedIn, loadBots]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
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

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
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
              <div className="login-brand">
                <div className="icon-slot icon-slot--accent" aria-hidden>
                  <ShieldCheck size={22} strokeWidth={1.75} />
                </div>
                <h1 id="login-title">TG Bot Gate</h1>
              </div>
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
              <span className="nav-item nav-item-active" aria-current="page">
                <LayoutDashboard size={17} strokeWidth={1.75} aria-hidden />
                Overview
              </span>
            </nav>
          </aside>

          <div className="main-column">
            <header className="page-header">
              <h1 className="page-title">Bots</h1>
              <IconButton
                label="Refresh"
                disabled={isLoading}
                onClick={() => void loadBots()}
                variant="toolbar"
              >
                {isLoading ? <Loader2 size={15} strokeWidth={2} className="animate-spin" /> : <RefreshCw size={15} strokeWidth={2} />}
              </IconButton>
            </header>

            <div className="metrics-strip material">
              <StatTile icon={<Bot size={18} strokeWidth={1.75} />} label="Count" value={bots.length.toString()} />
              <StatTile icon={<ShieldCheck size={18} strokeWidth={1.75} />} label="Storage" value="Hashed" />
              <EndpointTile />
            </div>

            <div className="content-stack">
              <Panel title="Add">
                <form onSubmit={handleRegister} className="register-form">
                  <TextInput label="Name" value={label} onChange={setLabel} placeholder="Label" required />
                  <TextInput label="Token" value={token} onChange={setToken} placeholder="Bot token" required />
                  <Button disabled={isLoading} icon={<Plus size={18} strokeWidth={1.75} />} type="submit">
                    Add
                  </Button>
                </form>
                <Status notice={notice} />
              </Panel>

              <Panel title="List">
                <BotList bots={sortedBots} isLoading={isLoading} onDelete={handleDelete} />
              </Panel>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
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
  children,
  className = "",
  disabled,
  label,
  onClick,
  variant = "default",
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  variant?: "default" | "toolbar";
}) {
  const variantClass = variant === "toolbar" ? "icon-btn icon-btn--toolbar" : "icon-btn";
  return (
    <button
      type="button"
      className={`${variantClass} ${className}`.trim()}
      disabled={disabled}
      onClick={onClick}
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
  onDelete,
}: {
  bots: BotRecord[];
  isLoading: boolean;
  onDelete: (tokenHash: string) => Promise<void>;
}) {
  if (bots.length === 0) {
    return (
      <div className="empty-state material-inset">
        <p className="empty-title">None</p>
      </div>
    );
  }

  return (
    <ul className="grouped-list grouped-list--inset" aria-label="Bots">
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
