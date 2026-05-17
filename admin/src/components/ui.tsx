import { type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/cn";

export const glass = cn(
  "relative isolate overflow-hidden rounded-2xl",
  "border border-white/65 bg-linear-to-br from-white/92 to-white/72",
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_0_0_0.5px_rgba(0,0,0,0.06),0_14px_48px_rgba(0,0,0,0.1)]",
  "backdrop-blur-3xl backdrop-saturate-200",
  "dark:border-white/10 dark:from-zinc-800/90 dark:to-zinc-900/75",
);

export const glassInset = cn(
  "overflow-hidden rounded-xl",
  "border border-black/6 bg-black/4 dark:border-white/8 dark:bg-white/6",
);

export function PageHeader({
  action,
  className,
  title,
}: {
  action?: ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <header className={cn("flex items-center justify-between gap-3", className)}>
      <h1 className="m-0 text-[28px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {title}
      </h1>
      {action}
    </header>
  );
}

export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={cn(glass, className)}>{children}</section>;
}

export function PanelHeading({
  children,
  className,
  description,
  title,
}: {
  children?: ReactNode;
  className?: string;
  description?: string;
  title: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 border-b border-black/6 px-[18px] py-3.5 dark:border-white/8",
        className,
      )}
    >
      <div>
        <h2 className="m-0 text-[13px] font-semibold tracking-[0.08em] text-zinc-500 uppercase dark:text-zinc-400">
          {title}
        </h2>
        {description ? <p className="mt-1.5 mb-0 text-sm text-zinc-500 dark:text-zinc-400">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-[18px] py-4", className)}>{children}</div>;
}

export function Button({
  children,
  className,
  disabled,
  icon,
  onClick,
  size = "md",
  type = "submit",
  variant = "primary",
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  icon?: ReactNode;
  onClick?: () => void;
  size?: "md" | "sm";
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const variants = {
    primary:
      "bg-zinc-900 text-white hover:bg-black disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white",
    secondary:
      "bg-black/6 text-zinc-900 hover:bg-black/10 dark:bg-white/10 dark:text-zinc-100 dark:hover:bg-white/14",
    danger: "bg-red-500/12 text-red-600 hover:bg-red-500/20 dark:text-red-400",
    ghost: "bg-transparent hover:bg-black/5 dark:hover:bg-white/8",
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex w-full items-center justify-center gap-2 rounded-xl font-semibold transition-colors",
        size === "sm" ? "min-h-9 px-3 text-sm" : "min-h-11 px-4 text-[15px]",
        variants[variant],
        className,
      )}
    >
      {icon ? <span className="inline-flex shrink-0">{icon}</span> : null}
      <span>{children}</span>
    </button>
  );
}

export function IconButton({
  busy = false,
  children,
  className,
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
  const isDisabled = disabled || busy;
  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={onClick}
      aria-busy={busy}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-40",
        variant === "toolbar"
          ? "border border-black/6 bg-black/4 text-zinc-700 hover:bg-black/8 dark:border-white/10 dark:bg-white/8 dark:text-zinc-200 dark:hover:bg-white/12"
          : "bg-black/6 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/14",
        busy && "animate-pulse",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TextInput({
  autoComplete,
  className,
  disabled,
  icon,
  label,
  onChange,
  placeholder,
  required,
  type = "text",
  value,
}: {
  autoComplete?: string;
  className?: string;
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
  value: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-semibold tracking-wide text-zinc-500 dark:text-zinc-400">{label}</span>
      <div className="flex min-h-11 items-center gap-2.5 rounded-[10px] border border-black/6 bg-black/4 px-3 focus-within:border-zinc-900 focus-within:ring-3 focus-within:ring-black/6 dark:border-white/10 dark:bg-white/6 dark:focus-within:border-zinc-200 dark:focus-within:ring-white/10">
        {icon ? <span className="inline-flex text-zinc-500">{icon}</span> : null}
        <input
          autoComplete={autoComplete}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          type={type}
          value={value}
          className="min-w-0 flex-1 border-0 bg-transparent py-2 outline-none"
        />
      </div>
    </label>
  );
}

export function NumberInput({
  disabled,
  label,
  max,
  min,
  onChange,
  value,
}: {
  disabled?: boolean;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold tracking-wide text-zinc-500 dark:text-zinc-400">{label}</span>
      <div className="flex min-h-11 items-center rounded-[10px] border border-black/6 bg-black/4 px-3 focus-within:border-zinc-900 focus-within:ring-3 focus-within:ring-black/6 dark:border-white/10 dark:bg-white/6 dark:focus-within:border-zinc-200 dark:focus-within:ring-white/10">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full border-0 bg-transparent py-2 outline-none"
        />
      </div>
    </label>
  );
}

export function Status({
  kind,
  text,
}: {
  kind: "idle" | "success" | "error" | "info";
  text: string;
}) {
  if (!text) {
    return <p className="min-h-5" aria-live="polite" />;
  }
  const tone =
    kind === "success"
      ? "text-green-600 dark:text-green-400"
      : kind === "error"
        ? "text-red-600 dark:text-red-400"
        : kind === "info"
          ? "text-zinc-500 dark:text-zinc-400"
          : "text-zinc-600";
  return (
    <p className={cn("m-0 text-sm", tone)} aria-live="polite">
      {text}
    </p>
  );
}

export function NavButton({
  active,
  children,
  icon,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[15px] font-medium transition-colors",
        active
          ? "bg-black/8 text-zinc-900 ring-1 ring-black/8 dark:bg-white/12 dark:text-zinc-50 dark:ring-white/12"
          : "text-zinc-600 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/8",
      )}
    >
      <span className="inline-flex shrink-0 opacity-80">{icon}</span>
      {children}
    </button>
  );
}

export function PaginationBar({
  disabled,
  onNext,
  onPrevious,
  page,
  total,
  totalPages,
}: {
  disabled?: boolean;
  onNext: () => void;
  onPrevious: () => void;
  page: number;
  total: number;
  totalPages: number;
}) {
  const canGoBack = page > 1 && !disabled;
  const canGoForward = page < totalPages && !disabled;

  return (
    <nav className="pt-2" aria-label="Pagination">
      <div className="flex items-center justify-center gap-2">
        <IconButton label="Previous page" variant="toolbar" disabled={!canGoBack} onClick={onPrevious}>
          <ChevronLeft size={16} strokeWidth={2.25} aria-hidden />
        </IconButton>
        <div className="min-w-[88px] text-center" aria-live="polite">
          <p className="m-0 text-lg font-semibold tabular-nums">
            <span>{page}</span>
            <span className="mx-1 text-zinc-400">/</span>
            <span className="text-zinc-500">{totalPages}</span>
          </p>
          <p className="m-0 text-xs text-zinc-500">{total} entries</p>
        </div>
        <IconButton label="Next page" variant="toolbar" disabled={!canGoForward} onClick={onNext}>
          <ChevronRight size={16} strokeWidth={2.25} aria-hidden />
        </IconButton>
      </div>
    </nav>
  );
}

export function EmptyState({ title }: { title: string }) {
  return (
    <div className={cn(glassInset, "px-4 py-8 text-center")}>
      <p className="m-0 text-sm font-medium text-zinc-500">{title}</p>
    </div>
  );
}

export function MetricCard({
  children,
  className,
  icon,
  label,
  onClick,
  value,
}: {
  children?: ReactNode;
  className?: string;
  icon?: ReactNode;
  label: string;
  onClick?: () => void;
  value?: string;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        glass,
        "flex min-h-[72px] flex-1 items-center gap-3 px-4 py-3 text-left",
        onClick && "cursor-pointer transition-transform hover:scale-[1.01] active:scale-[0.99]",
        className,
      )}
    >
      {icon ? (
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-black/6 bg-black/5 dark:border-white/10 dark:bg-white/8">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <span className="block text-xs font-semibold tracking-wide text-zinc-500 uppercase">{label}</span>
        {value ? <strong className="mt-0.5 block text-lg font-semibold text-zinc-900 dark:text-zinc-50">{value}</strong> : null}
        {children}
      </div>
    </Tag>
  );
}

export function SettingSwitch({
  checked,
  disabled,
  hint,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  hint: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <li className="border-b border-black/6 last:border-b-0 dark:border-white/8">
      <label
        className={cn(
          "flex cursor-pointer items-center justify-between gap-3.5 px-3.5 py-3",
          disabled && "cursor-not-allowed opacity-45",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-zinc-900 dark:text-zinc-50">{label}</span>
          <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>
        </span>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="size-[18px] shrink-0 accent-zinc-900 dark:accent-zinc-100"
        />
      </label>
    </li>
  );
}
