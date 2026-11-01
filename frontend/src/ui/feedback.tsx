import { useSyncExternalStore, type ReactNode } from "react";

import { getInFlight, subscribeLoading } from "../lib/loading";

/** Thin indeterminate bar at the top of the screen while any user request is running. */
export function GlobalProgress() {
  const busy = useSyncExternalStore(subscribeLoading, getInFlight, () => 0) > 0;
  return (
    <div className={busy ? "global-progress active" : "global-progress"} role="progressbar" aria-hidden={!busy}>
      <span />
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  );
}

type Tone = "info" | "success" | "warning" | "danger";

export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      {title && <p className="notice-title">{title}</p>}
      {children && <div className="notice-body">{children}</div>}
    </div>
  );
}

/** Shows whichever of error / success is set; nothing otherwise. */
export function ActionFeedback({ error, success }: { error?: string; success?: string }) {
  if (error) {
    return <Notice tone="danger">{error}</Notice>;
  }
  if (success) {
    return <Notice tone="success">{success}</Notice>;
  }
  return null;
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {children && <div className="meta">{children}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone,
  detail,
  emphasis = false,
}: {
  label: string;
  value: ReactNode;
  tone?: string;
  detail?: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className={emphasis ? "stat stat-emphasis" : "stat"}>
      <span className="stat-label">{label}</span>
      <strong className={`stat-value ${tone ?? ""}`}>{value}</strong>
      {detail && <span className="stat-detail">{detail}</span>}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-header">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="meta">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
