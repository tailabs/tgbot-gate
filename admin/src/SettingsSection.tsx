import { type ReactNode, type SubmitEvent, useCallback, useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { api, ApiError } from "./lib/api";
import {
  Button,
  NumberInput,
  PageHeader,
  Panel,
  PanelBody,
  PanelHeading,
  SettingSwitch,
  Status,
  TextInput,
  glassInset,
} from "./components/ui";
import { cn } from "./lib/cn";

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
  const [isSaving, setIsSaving] = useState(false);
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>({ kind: "idle", text: "" });

  const loadSettings = useCallback(async () => {
    const data = await api<GateSettings>("/api/settings");
    setForm(data);
  }, []);

  useEffect(() => {
    if (!active) return;
    void loadSettings().catch(() => {
      setNotice({ kind: "error", text: "Could not load settings." });
    });
  }, [active, loadSettings]);

  async function handleSaveSettings(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;

    setIsSaving(true);
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
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Save failed." });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleChangePassword(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPasswordSaving(true);
    setNotice({ kind: "idle", text: "" });

    try {
      await api<void>("/api/settings/password", {
        method: "PUT",
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
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
      setIsPasswordSaving(false);
    }
  }

  if (!active) return null;

  return (
    <div className="flex flex-col gap-3.5">
      <PageHeader title="Settings" />
      <Status kind={notice.kind} text={notice.text} />

      <form className="flex flex-col gap-3.5" onSubmit={handleSaveSettings}>
        <Panel>
          <PanelHeading title="Audit" description="Proxy traffic logging and SQLite capture." />
          <PanelBody className="flex flex-col gap-3.5">
            {form ? (
              <>
                <ul className={cn(glassInset)} aria-label="Audit options">
                  <SettingSwitch
                    label="Stdout JSON log"
                    hint="Log /bot requests to server stdout"
                    checked={form.audit_log}
                    onChange={(audit_log) => setForm({ ...form, audit_log })}
                  />
                  <SettingSwitch
                    label="Database capture"
                    hint="Persist request and response bodies to SQLite"
                    checked={form.audit_capture}
                    onChange={(audit_capture) => setForm({ ...form, audit_capture })}
                  />
                  <SettingSwitch
                    label="Errors only"
                    hint="HTTP status 400 and above"
                    checked={form.audit_errors_only}
                    disabled={!form.audit_capture}
                    onChange={(audit_errors_only) => setForm({ ...form, audit_errors_only })}
                  />
                </ul>
                <div
                  className={cn(
                    "grid gap-3.5 sm:grid-cols-2",
                    !form.audit_capture && "pointer-events-none opacity-45",
                  )}
                >
                  <NumberInput
                    label="Retention (days)"
                    min={1}
                    max={365}
                    value={form.audit_retention_days}
                    disabled={!form.audit_capture}
                    onChange={(audit_retention_days) =>
                      setForm({ ...form, audit_retention_days: audit_retention_days || 1 })
                    }
                  />
                  <NumberInput
                    label="Max body (MB)"
                    min={MIN_BODY_MB}
                    max={MAX_BODY_MB}
                    value={bytesToMb(form.audit_max_body_bytes)}
                    disabled={!form.audit_capture}
                    onChange={(mb) =>
                      setForm({ ...form, audit_max_body_bytes: mbToBytes(mb || MIN_BODY_MB) })
                    }
                  />
                </div>
              </>
            ) : (
              <p className="m-0 text-sm text-zinc-500">Loading…</p>
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeading title="Proxy" description="Limits for forwarded Telegram API requests." />
          <PanelBody>
            {form ? (
              <NumberInput
                label="Max request body (MB)"
                min={MIN_BODY_MB}
                max={MAX_BODY_MB}
                value={bytesToMb(form.max_proxy_body_bytes)}
                onChange={(mb) =>
                  setForm({ ...form, max_proxy_body_bytes: mbToBytes(mb || MIN_BODY_MB) })
                }
              />
            ) : (
              <p className="m-0 text-sm text-zinc-500">Loading…</p>
            )}
          </PanelBody>
        </Panel>

        <div className="flex justify-end">
          <Button
            className="w-full sm:w-auto sm:min-w-[168px]"
            disabled={isSaving || !form}
            icon={
              isSaving ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Save size={18} strokeWidth={1.75} />
              )
            }
          >
            {isSaving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>

      <Panel>
        <PanelHeading title="Admin password" description="Stored as a SHA-256 hash in the database." />
        <PanelBody>
          <form className="flex flex-col gap-3.5" onSubmit={handleChangePassword}>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <TextInput
                label="Current password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={setCurrentPassword}
                required
              />
              <TextInput
                label="New password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={setNewPassword}
                required
              />
            </div>
            <Button variant="secondary" className="w-full sm:w-auto" disabled={isPasswordSaving} type="submit">
              {isPasswordSaving ? "Updating…" : "Update password"}
            </Button>
          </form>
        </PanelBody>
      </Panel>
    </div>
  );
}
