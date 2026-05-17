import React, { type SubmitEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  ScrollText,
  Settings,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import "./index.css";
import { useListPageSize } from "./useListPageSize";
import { AuditSection } from "./AuditSection";
import { SettingsSection } from "./SettingsSection";
import { api, ApiError, withMinRefreshDuration } from "./lib/api";
import {
  Button,
  EmptyState,
  IconButton,
  MetricCard,
  NavButton,
  PageHeader,
  PaginationBar,
  Panel,
  PanelBody,
  PanelHeading,
  Status,
  TextInput,
  glass,
  glassInset,
} from "./components/ui";
import { cn } from "./lib/cn";

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

type AuthState = "checking" | "signed-out" | "signed-in";

function App() {
  const reduceMotion = useReducedMotion();
  const [authState, setAuthState] = useState<AuthState>("checking");
  const isSignedIn = authState === "signed-in";
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
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuthState("signed-out");
        return;
      }
      setNotice({ kind: "error", text: "Refresh failed." });
    } finally {
      setIsRefreshingBots(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void api<void>("/api/session")
      .then(() => {
        if (!cancelled) {
          setAuthState("signed-in");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuthState("signed-out");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isSignedIn) {
      return;
    }

    void loadBots();
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
      setAuthState("signed-in");
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

  if (authState === "checking") {
    return (
      <motion.div className="flex min-h-dvh items-center justify-center p-6" aria-busy aria-label="Checking session">
        <Loader2 size={28} className="animate-spin text-zinc-500" aria-hidden />
      </motion.div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {authState === "signed-out" ? (
        <motion.div
          key="login"
          className="flex min-h-dvh items-center justify-center p-6"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98 }}
          transition={pageTransition}
        >
          <main className="w-full max-w-md">
            <section className={cn(glass, "p-6")} aria-labelledby="login-title">
              <motion.div className="mb-6 flex flex-col items-center gap-3 text-center">
                <span className="inline-flex size-11 items-center justify-center rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
                  <ShieldCheck size={22} strokeWidth={1.75} />
                </span>
                <h1 id="login-title" className="m-0 text-2xl font-semibold tracking-tight">
                  TG Bot Gate
                </h1>
              </motion.div>
              <form onSubmit={handleLogin} className="flex flex-col gap-3.5">
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
              <Status kind={notice.kind} text={notice.text} />
            </section>
          </main>
        </motion.div>
      ) : (
        <motion.div
          key="app"
          className="flex h-dvh max-h-dvh flex-col overflow-hidden md:flex-row"
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: 8 }}
          transition={pageTransition}
        >
          <aside
            className={cn(
              glass,
              "flex shrink-0 flex-col gap-4 p-4 md:h-dvh md:w-56 md:overflow-y-auto md:rounded-none md:rounded-r-2xl",
            )}
            aria-label="Application"
          >
            <div className="flex items-center gap-2.5 px-1">
              <span className="inline-flex size-8 items-center justify-center rounded-lg border border-black/6 bg-black/5 dark:border-white/10 dark:bg-white/8">
                <ShieldCheck size={18} strokeWidth={1.75} />
              </span>
              <span className="text-[15px] font-semibold tracking-tight">TG Bot Gate</span>
            </div>
            <nav className="flex flex-col gap-1" aria-label="Primary">
              <NavButton
                active={section === "bots"}
                icon={<LayoutDashboard size={17} strokeWidth={1.75} />}
                onClick={() => setSection("bots")}
              >
                Bots
              </NavButton>
              <NavButton
                active={section === "audit"}
                icon={<ScrollText size={17} strokeWidth={1.75} />}
                onClick={() => setSection("audit")}
              >
                Audit
              </NavButton>
              <NavButton
                active={section === "settings"}
                icon={<Settings size={17} strokeWidth={1.75} />}
                onClick={() => setSection("settings")}
              >
                Settings
              </NavButton>
            </nav>
          </aside>

          <motion.div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-4 md:p-6">
            {section === "bots" ? (
              <motion.div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-hidden">
                <PageHeader
                  title="Bots"
                  action={
                    <IconButton
                      label="Refresh"
                      variant="toolbar"
                      busy={isRefreshingBots}
                      onClick={() =>
                        void loadBots().catch(() => setNotice({ kind: "error", text: "Refresh failed." }))
                      }
                    >
                      <RefreshCw
                        size={15}
                        strokeWidth={2}
                        className={cn(isRefreshingBots && "animate-spin")}
                        aria-hidden
                      />
                    </IconButton>
                  }
                />

                <div className="grid gap-2.5 sm:grid-cols-3">
                  <MetricCard
                    icon={<Bot size={18} strokeWidth={1.75} />}
                    label="Count"
                    value={bots.length.toString()}
                  />
                  <MetricCard
                    icon={<ShieldCheck size={18} strokeWidth={1.75} />}
                    label="Storage"
                    value="Hashed"
                  />
                  <EndpointMetricCard />
                </div>

                <div className="grid min-h-0 flex-1 gap-3.5 lg:grid-cols-[minmax(0,280px)_1fr]">
                  <Panel>
                    <PanelHeading title="Add" />
                    <PanelBody>
                      <form onSubmit={handleRegister} className="flex flex-col gap-3.5">
                        <TextInput label="Name" value={label} onChange={setLabel} placeholder="Label" required />
                        <TextInput
                          label="Token"
                          value={token}
                          onChange={setToken}
                          placeholder="Bot token"
                          required
                        />
                        <Button disabled={isLoading} icon={<Plus size={18} strokeWidth={1.75} />} type="submit">
                          Add
                        </Button>
                      </form>
                      <Status kind={notice.kind} text={notice.text} />
                    </PanelBody>
                  </Panel>

                  <Panel className="flex min-h-0 flex-1 flex-col">
                    <PanelHeading title="List" />
                    <PanelBody className="flex min-h-0 flex-1 flex-col gap-3">
                      <div ref={botsListViewportRef} className="min-h-0 flex-1 overflow-auto">
                        <BotList
                          bots={paginatedBots}
                          isLoading={isLoading}
                          onDelete={handleDelete}
                          measureRow={sortedBots.length === 0}
                        />
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
                    </PanelBody>
                  </Panel>
                </div>
              </motion.div>
            ) : section === "audit" ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <AuditSection active />
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <SettingsSection active />
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const ENDPOINT_SAMPLE = "/bot<TOKEN>/<METHOD>";

function EndpointMetricCard() {
  return (
    <MetricCard
      label="Path"
      onClick={() => void navigator.clipboard.writeText(ENDPOINT_SAMPLE)}
      className="relative pr-12"
    >
      <code className="mt-1 block truncate font-mono text-xs text-zinc-700 dark:text-zinc-300">
        {ENDPOINT_SAMPLE}
      </code>
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-zinc-500" aria-hidden>
        <Copy size={15} strokeWidth={2} />
      </span>
    </MetricCard>
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
    return <EmptyState title="None" />;
  }

  return (
    <ul className={cn(glassInset, "divide-y divide-black/6 dark:divide-white/8")} aria-label="Bots">
      {measureRow ? (
        <li data-list-row className="flex items-center justify-between gap-3 px-4 py-3" aria-hidden>
          <div className="min-w-0 flex-1">
            <p className="m-0 font-medium text-zinc-900 dark:text-zinc-50">Probe</p>
            <p className="mt-1 mb-0 truncate font-mono text-xs text-zinc-500">
              <code>0000000000000000000000000000000000000000000000000000000000000000</code>
            </p>
            <p className="mt-1 mb-0 text-xs text-zinc-500">—</p>
          </div>
        </li>
      ) : null}
      {bots.map((bot) => (
        <li key={bot.token_hash} data-list-row className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="m-0 font-medium text-zinc-900 dark:text-zinc-50">{bot.label}</p>
            <p className="mt-1 mb-0 truncate font-mono text-xs text-zinc-500">
              <code>{bot.token_hash}</code>
            </p>
            <p className="mt-1 mb-0 text-xs text-zinc-500">
              {new Date(bot.created_at * 1000).toLocaleString()}
            </p>
          </div>
          <IconButton label="Delete" disabled={isLoading} onClick={() => void onDelete(bot.token_hash)}>
            <Trash2 size={16} strokeWidth={2} />
          </IconButton>
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
