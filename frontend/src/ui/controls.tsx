import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  pending?: boolean;
  pendingLabel?: string;
  block?: boolean;
};

export function Button({
  variant = "primary",
  pending = false,
  pendingLabel,
  block = false,
  children,
  disabled,
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} ${block ? "btn-block" : ""} ${className}`}
      disabled={disabled || pending}
      aria-busy={pending}
      {...rest}
    >
      {pending && <span className="spinner spinner-inline" aria-hidden="true" />}
      <span>{pending && pendingLabel ? pendingLabel : children}</span>
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className={error ? "field field-invalid" : "field"}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <p className="field-error">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

type NumberFieldProps = {
  label: ReactNode;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  hint?: ReactNode;
  error?: string;
  disabled?: boolean;
};

/** Number input that never emits NaN and shows its allowed range. */
export function NumberField({ label, value, onChange, min, max, step = 1, unit, hint, error, disabled }: NumberFieldProps) {
  const id = useId();
  const range =
    min !== undefined && max !== undefined ? `Entre ${min} et ${max}${unit ? ` ${unit}` : ""}.` : undefined;
  return (
    <Field label={label} hint={hint ?? range} error={error} htmlFor={id}>
      <div className="input-unit">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : ""}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.valueAsNumber;
            onChange(Number.isFinite(next) ? next : 0);
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </div>
    </Field>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="toggle-row">
      <label className="toggle" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="toggle-track" aria-hidden="true">
          <span className="toggle-thumb" />
        </span>
        <span className="toggle-label">{label}</span>
      </label>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export type SegmentOption<T extends string> = { value: T; label: ReactNode; tone?: "buy" | "sell" | "live" };

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled}
          className={`segment ${value === option.value ? `active ${option.tone ?? ""}` : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Collapsible({
  title,
  children,
  defaultOpen = false,
  badge,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: ReactNode;
}) {
  return (
    <details className="collapsible" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        {badge !== undefined && <span className="badge">{badge}</span>}
      </summary>
      <div className="collapsible-body">{children}</div>
    </details>
  );
}
