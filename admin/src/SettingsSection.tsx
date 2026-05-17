import { FormEvent, useCallback, useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";

const MIN_BODY_MB = 1;
const MAX_BODY_MB = 100;

export type GateSettings = {
  audit_log: boolean;
  audit_capture: boolean;
  audit_retention_days: number;
  audit_errors_only: boolean;
  audit_max_body_bytes: number;
  max_proxy_body_bytes: number;
};

type Notice = {
  kind: "idle" | "success" | "error";
  text: string;
};

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

function bytesToMb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

function mbToBytes(mb: number): number {
  return mb * 1024 * 1024;
}

type SettingsSectionProps = {
  active: boolean;
};

export function SettingsSection({ active }: SettingsSectionProps) {
  const [form, setForm] = useState<GateSettings | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>({ kind: "idle", text: "" });

  const loadSettings = useCallback(async () => {
    const data = await api<GateSettings>("/api/settings");
    setForm(data);
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }
    void loadSettings().catch(() => {
      setNotice({ kind: "error", text: "Could not load settings." });
    });
  }, [active, loadSettings]);

  async function handleSaveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) {
      return;
    }

    setIsLoading(true);
    setNotice({ kind: "idle", text: "" });

    try {
      const updated = await api<GateSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          audit_log: form.audit_log,
          audit_capture: form.audit_capture,
          audit_retention_days: form.audit_retention_days,
          audit_errors_only: form.audit_errors_only,
          audit_max_body_bytes: mbToBytes(bytesToMb(form.audit_max_body_bytes)),
          max_proxy_body_bytes: mbToBytes(bytesToMb(form.max_proxy_body_bytes)),
        }),
      });
      setForm(updated);
      setNotice({ kind: "success", text: "Settings saved. Changes apply immediately." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Save failed.";
      setNotice({ kind: "error", text: message });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setNotice({ kind: "idle", text: "" });

    try {
      await api<void>("/api/settings/password", {
        method: "PUT",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setNotice({ kind: "success", text: "Password updated." });
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 401
          ? "Current password is incorrect."
          : error instanceof Error
            ? error.message
            : "Password update failed.";
      setNotice({ kind: "error", text: message });
    } finally {
      setIsLoading(false);
    }
  }

  if (!active) {
    return null;
  }

  return (
    <div className="settings-workspace">
      <header className="page-header">
        <h1 className="page-title">Settings</h1>
      </header>

      {notice.kind !== "idle" ? (
        <p className={`settings-banner settings-banner--${notice.kind}`} role="status">
          {notice.text}
        </p>
      ) : null}

      <div className="content-stack">
        <section className="panel material">
          <div className="panel-head">
            <h2 className="panel-title">Audit</h2>
            <p className="panel-desc">Proxy traffic logging and SQLite capture.</p>
          </div>
          {form ? (
            <form className="settings-form" onSubmit={handleSaveSettings}>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={form.audit_log}
                  onChange={(event) => setForm({ ...form, audit_log: event.target.checked })}
                />
                <span>Stdout JSON log for /bot requests</span>
              </label>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={form.audit_capture}
                  onChange={(event) => setForm({ ...form, audit_capture: event.target.checked })}
                />
                <span>Persist request/response bodies to database</span>
              </label>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={form.audit_errors_only}
                  disabled={!form.audit_capture}
                  onChange={(event) => setForm({ ...form, audit_errors_only: event.target.checked })}
                />
                <span>Capture errors only (HTTP status ≥ 400)</span>
              </label>
              <label className="settings-field">
                <span>Retention (days)</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={form.audit_retention_days}
                  disabled={!form.audit_capture}
                  onChange={(event) =>
                    setForm({ ...form, audit_retention_days: Number(event.target.value) || 1 })
                  }
                />
              </label>
              <label className="settings-field">
                <span>Max audit body (MB)</span>
                <input
                  type="number"
                  min={MIN_BODY_MB}
                  max={MAX_BODY_MB}
                  value={bytesToMb(form.audit_max_body_bytes)}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      audit_max_body_bytes: mbToBytes(Number(event.target.value) || MIN_BODY_MB),
                    })
                  }
                />
              </label>
              <button className="button primary button--md" type="submit" disabled={isLoading}>
                {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} strokeWidth={1.75} />}
                <span className="button-label">Save audit settings</span>
              </button>
            </form>
          ) : null}
        </section>

        <section className="panel material">
          <div className="panel-head">
            <h2 className="panel-title">Proxy</h2>
            <p className="panel-desc">Limits for forwarded Telegram API requests.</p>
          </div>
          {form ? (
            <form className="settings-form" onSubmit={handleSaveSettings}>
              <label className="settings-field">
                <span>Max request body (MB)</span>
                <input
                  type="number"
                  min={MIN_BODY_MB}
                  max={MAX_BODY_MB}
                  value={bytesToMb(form.max_proxy_body_bytes)}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      max_proxy_body_bytes: mbToBytes(Number(event.target.value) || MIN_BODY_MB),
                    })
                  }
                />
              </label>
              <button className="button primary button--md" type="submit" disabled={isLoading}>
                {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} strokeWidth={1.75} />}
                <span className="button-label">Save proxy settings</span>
              </button>
            </form>
          ) : null}
        </section>

        <section className="panel material">
          <div className="panel-head">
            <h2 className="panel-title">Admin password</h2>
            <p className="panel-desc">Stored as a hash in the database.</p>
          </div>
          <form className="settings-form" onSubmit={handleChangePassword}>
            <label className="settings-field">
              <span>Current password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </label>
            <label className="settings-field">
              <span>New password</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </label>
            <button className="button secondary button--md" type="submit" disabled={isLoading}>
              Update password
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
