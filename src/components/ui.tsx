import { useEffect, useState, useCallback } from "react"
import { ArrowUpRight, Loader2, X, type LucideIcon } from "lucide-react"

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger"
  icon?: LucideIcon
  loading?: boolean
}

export function Button({ variant = "secondary", icon: Icon, loading, disabled, className = "", children, type = "button", ...props }: ButtonProps) {
  const IconComponent = loading ? Loader2 : Icon
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`button button-${variant} ${loading ? "loading" : ""} ${className}`}
      {...props}
    >
      {IconComponent && <IconComponent size={15} className={loading ? "animate-spin" : undefined} />}
      {children}
    </button>
  )
}

export function useAction<T extends unknown[], R = void>(
  fn: (...args: T) => Promise<R> | R,
  onError?: (err: unknown) => void,
) {
  const [busy, setBusy] = useState(false)
  const run = useCallback(
    async (...args: T): Promise<R | undefined> => {
      if (busy) return undefined
      setBusy(true)
      try {
        return await fn(...args)
      } catch (err) {
        if (onError) onError(err)
        else console.error(err)
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [busy, fn, onError],
  )
  return { run, busy }
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ""}`} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`select ${props.className ?? ""}`} />
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`textarea ${props.className ?? ""}`} />
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`toggle ${checked ? "toggle-on" : ""}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  )
}

export function Title({ children, level = 1, className = "" }: { children: React.ReactNode; level?: number; className?: string }) {
  return (
    <div role="heading" aria-level={level} className={`title title-${level} ${className}`}>
      {children}
    </div>
  )
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>
}

export type Tone = "green" | "amber" | "red" | "blue" | "neutral"

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: Tone | string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function CardHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="card-header">
      <Title level={2}>{title}</Title>
      {action}
    </div>
  )
}

export function MetricCard({ label, value, detail, positive, forecast, tone, onClick }: {
  label: string
  value: string
  detail: string
  positive?: boolean
  forecast?: boolean
  tone?: "amber" | "red"
  onClick?: () => void
}) {
  return (
    <Card className={`metric-card ${onClick ? "metric-link" : ""}`}>
      <div className="metric-top" onClick={onClick}>
        <span>{label}</span>
        {forecast && <Badge tone="blue">Forecast</Badge>}
      </div>
      <div className={`metric-value ${tone ? `${tone}-text` : ""}`}>{value}</div>
      <div className={`metric-detail ${positive ? "positive" : ""}`}>
        {positive && <ArrowUpRight size={14} />}
        {detail}
      </div>
    </Card>
  )
}

export function Segmented<T extends string | number>({ options, value, onChange, labels }: {
  options: T[]
  value: T
  onChange: (value: T) => void
  labels?: Partial<Record<string, string>>
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((item) => (
        <Button key={String(item)} variant="ghost" role="tab" aria-selected={value === item} className={value === item ? "selected" : ""} onClick={() => onChange(item)}>
          {labels?.[String(item)] ?? String(item)}
        </Button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({ options, value, onChange, counts }: {
  options: T[]
  value: T
  onChange: (value: T) => void
  counts?: Partial<Record<T, number>>
}) {
  return (
    <div className="tabs" role="tablist">
      {options.map((item) => (
        <Button key={item} variant="ghost" role="tab" aria-selected={value === item} className={value === item ? "selected" : ""} onClick={() => onChange(item)}>
          {item}
          {counts?.[item] ? <span className="tab-count">{counts[item]}</span> : null}
        </Button>
      ))}
    </div>
  )
}

const useEscape = (onClose: () => void) =>
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

export function Modal({ children, onClose, className = "" }: { children: React.ReactNode; onClose: () => void; className?: string }) {
  useEscape(onClose)
  return (
    <div className="modal-shell" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className}`} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  )
}

export function FormModal({
  eyebrow,
  title,
  onClose,
  onSubmit,
  children,
  submitLabel,
  busyLabel,
  wide,
}: {
  eyebrow: string
  title: string
  onClose: () => void
  onSubmit: ((setStep: (label: string) => void) => Promise<void | boolean> | void | boolean) | (() => Promise<void | boolean> | void | boolean)
  children: React.ReactNode
  submitLabel: string
  busyLabel?: string
  wide?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [stepLabel, setStepLabel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEscape(() => {
    if (!busy) onClose()
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setStepLabel(null)
    try {
      await onSubmit((label: string) => setStepLabel(label))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      setBusy(false)
      setStepLabel(null)
    }
  }

  const defaultBusy = submitLabel.toLowerCase().startsWith("create")
    ? submitLabel.replace(/^create/i, "Creating") + "…"
    : submitLabel.toLowerCase().startsWith("save")
    ? "Saving…"
    : submitLabel.toLowerCase().startsWith("import")
    ? "Importing…"
    : `${submitLabel}…`
  const activeBusyLabel = stepLabel ?? busyLabel ?? defaultBusy

  return (
    <div className="modal-shell" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form
        className={`modal form-modal ${wide ? "import-modal" : ""}`}
        role="dialog"
        aria-modal="true"
        onSubmit={handleSubmit}
      >
        <div className="form-modal-head">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <Title level={2}>{title}</Title>
          </div>
          <Button variant="ghost" icon={X} aria-label="Close" disabled={busy} onClick={() => !busy && onClose()} />
        </div>
        {error && (
          <div className="banner banner-danger" role="alert">
            {error}
          </div>
        )}
        {children}
        <div className="modal-actions">
          <Button disabled={busy} onClick={() => !busy && onClose()}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={busy} disabled={busy}>
            {busy ? activeBusyLabel : submitLabel}
          </Button>
        </div>
      </form>
    </div>
  )
}

export function Drawer({ eyebrow, title, onClose, children, footer }: {
  eyebrow: string
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  useEscape(onClose)
  return (
    <div className="drawer-shell" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <Title level={2}>{title}</Title>
          </div>
          <Button variant="ghost" icon={X} aria-label="Close" onClick={onClose} />
        </div>
        {children}
        {footer && <div className="drawer-footer">{footer}</div>}
      </aside>
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`cents-logo ${compact ? "cents-logo-compact" : ""}`}>
      <div className="cents-symbol" aria-hidden="true">
        <span className="symbol-coin" />
        <span className="symbol-bar symbol-bar-one" />
        <span className="symbol-bar symbol-bar-two" />
        <span className="symbol-bar symbol-bar-three" />
      </div>
      <div className="cents-wordmark">
        Cents<span>AI</span>
      </div>
    </div>
  )
}

/** Labelled form field. */
export function Field({ label, children, full, hint }: { label: string; children: React.ReactNode; full?: boolean; hint?: string }) {
  return (
    <label className={full ? "full-field" : ""}>
      {label}
      {children}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  )
}

export function Note({ children, icon: Icon, tone = "green" }: { children: React.ReactNode; icon: LucideIcon; tone?: "green" | "amber" }) {
  return (
    <div className={`registration-note ${tone === "amber" ? "note-amber" : ""}`}>
      <Icon size={15} />
      <span>{children}</span>
    </div>
  )
}
