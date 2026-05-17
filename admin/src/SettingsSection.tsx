import { type SubmitEvent, useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, Save } from "lucide-react";
import { api, ApiError } from "./lib/api";
import {
  Button,
  NumberInput,
  PageHeader,
  Panel,
  PanelBody,
  PanelFooter,
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

const idleNotice: Notice = { kind: "idle", text: "" };

function bytesToMb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

function mbToBytes(mb: number): number {
  return mb * 1024 * 1024;
}

type SettingsSectionProps = {
  active: boolean;
};

function SettingsSubheading({ id, children }: { id: string; children: string }) {
  return (
    <h3
      id={id}
      className="m-0 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400"
    >
      {children}
    </h3>
  );
}

export function SettingsSection({ active }: SettingsSectionProps) {
  const [form, setForm] = useState<GateSettings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);
  const [gateNotice, setGateNotice] = useState<Notice>(idleNotice);
  const [passwordNotice, setPasswordNotice] = useState<Notice>(idleNotice);

  const loadSettings = useCallback(async () => {
    setLoadError("");
    const data = await api<GateSettings>("/api/settings");
    setForm(data);
  }, []);

  useEffect(() => {
    if (!active) return;
    void loadSettings().catch(() => {
      setLoadError("Could not load settings.");
      setForm(null);
    });
  }, [active, loadSettings]);

  async function handleSaveSettings(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;

    setIsSaving(true);
    setGateNotice(idleNotice);

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
      setGateNotice({ kind: "success", text: "Saved. Changes apply immediately." });
    } catch (error) {
      setGateNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Save failed.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleChangePassword(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPasswordSaving(true);
    setPasswordNotice(idleNotice);

    try {
      await api<void>("/api/settings/password", {
        method: "PUT",
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setPasswordNotice({ kind: "success", text: "Password updated." });
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 401
          ? "Current password is incorrect."
          : error instanceof Error
            ? error.message
            : "Password update failed.";
      setPasswordNotice({ kind: "error", text: message });
    } finally {
      setIsPasswordSaving(false);
    }
  }

  if (!active) return null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3.5">
      <PageHeader title="Settings" />

      <div className="grid items-start gap-3.5 lg:grid-cols-2">
        <form onSubmit={handleSaveSettings} className="min-w-0">
          <Panel>
            <PanelHeading
              title="Runtime"
              description="Audit logging and proxy body limits. Saved to the database."
            />
            <PanelBody className="flex flex-col gap-5">
              {loadError ? (
                <Status kind="error" text={loadError} />
              ) : null}

              {form ? (
                <>
                  <section className="flex flex-col gap-3" aria-labelledby="settings-audit-heading">
                    <SettingsSubheading id="settings-audit-heading">Audit</SettingsSubheading>
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
                  </section>

                  <section className="flex flex-col gap-3" aria-labelledby="settings-proxy-heading">
                    <SettingsSubheading id="settings-proxy-heading">Proxy</SettingsSubheading>
                    <NumberInput
                      label="Max request body (MB)"
                      min={MIN_BODY_MB}
                      max={MAX_BODY_MB}
                      value={bytesToMb(form.max_proxy_body_bytes)}
                      onChange={(mb) =>
                        setForm({ ...form, max_proxy_body_bytes: mbToBytes(mb || MIN_BODY_MB) })
                      }
                    />
                  </section>
                </>
              ) : loadError ? null : (
                <p className="m-0 text-sm text-zinc-500">Loading…</p>
              )}
            </PanelBody>
            <PanelFooter>
              <div className="min-h-5 min-w-0 flex-1">
                <Status kind={gateNotice.kind} text={gateNotice.text} />
              </div>
              <Button
                className="w-full shrink-0 sm:w-auto sm:min-w-[168px]"
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
            </PanelFooter>
          </Panel>
        </form>

        <form onSubmit={handleChangePassword} className="min-w-0">
          <Panel>
            <PanelHeading
              title="Admin password"
              description="SHA-256 hash stored in the database. Separate from runtime settings."
            />
            <PanelBody className="flex flex-col gap-3.5">
              <div className="grid gap-3.5">
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
            </PanelBody>
            <PanelFooter>
              <div className="min-h-5 min-w-0 flex-1">
                <Status kind={passwordNotice.kind} text={passwordNotice.text} />
              </div>
              <Button
                type="submit"
                variant="secondary"
                className="w-full shrink-0 sm:w-auto sm:min-w-[168px]"
                disabled={isPasswordSaving}
                icon={
                  isPasswordSaving ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <KeyRound size={18} strokeWidth={1.75} />
                  )
                }
              >
                {isPasswordSaving ? "Updating…" : "Update password"}
              </Button>
            </PanelFooter>
          </Panel>
        </form>
      </div>
    </div>
  );
}
