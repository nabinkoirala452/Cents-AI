import { useEffect, useMemo, useRef, useState } from "react"
import { Bell, Bot, Check, ChevronDown, Command, Loader2, LogOut, Menu, Moon, Search, Sun, X } from "lucide-react"
import { buildBriefing, clientOf, invoiceTotal, receivables } from "../lib/finance"
import { initials, money } from "../lib/format"
import { go, NAV_GROUPS, PAGES, type PageId } from "../lib/router"
import { useStore } from "../lib/store"
import { Badge, Button, Logo } from "./ui"

export function Sidebar({ page, open, close, signOut }: { page: PageId; open: boolean; close: () => void; signOut: () => void }) {
  const { state, today, actor, mode, paypalMode, paypalEnvironment } = useStore()
  const counts: Partial<Record<PageId, number>> = {
    invoices: receivables(state, today).overdue.length,
    approvals: state.approvals.filter((a) => a.status === "Pending" || a.status === "Submitted").length,
  }
  return (
    <>
      {open && <div className="sidebar-scrim" onClick={close} />}
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand">
          <Logo compact />
          <Button variant="ghost" className="sidebar-close" onClick={close} aria-label="Close navigation" icon={X} />
        </div>
        <div className="workspace">
          <div className="workspace-label">WORKSPACE</div>
          <button className="workspace-row" onClick={() => go("settings")}>
            <div className="workspace-avatar">{initials(state.settings.agencyName)}</div>
            <div>
              <strong>{state.settings.agencyName}</strong>
              <small>{state.settings.agencyType} · {mode === "hosted" ? (paypalMode === "fake" ? "Fake PayPal adapter" : `PayPal ${paypalEnvironment}`) : "Sandbox demo"}</small>
            </div>
            <ChevronDown size={14} />
          </button>
        </div>
        <nav className="nav" aria-label="Main">
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map((id) => {
                const { label, icon: Icon } = PAGES[id]
                return (
                  <button
                    className={`nav-item ${page === id ? "active" : ""}`}
                    key={id}
                    aria-current={page === id ? "page" : undefined}
                    onClick={() => {
                      go(id)
                      close()
                    }}
                  >
                    <Icon size={16} strokeWidth={1.8} />
                    <span>{label}</span>
                    {counts[id] ? <b className={`nav-count ${id === "invoices" ? "nav-count-red" : ""}`}>{counts[id]}</b> : null}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
        <div className="profile">
          <div className="avatar">{initials(actor)}</div>
          <div>
            <strong>{actor}</strong>
            <small>{state.settings.role}</small>
          </div>
          <Button variant="ghost" className="profile-signout" icon={LogOut} aria-label="Sign out" onClick={signOut}>
            <span>Sign out</span>
          </Button>
        </div>
      </aside>
    </>
  )
}

export function Header({ page, dark, setDark, menu }: { page: PageId; dark: boolean; setDark: (v: boolean) => void; menu: () => void }) {
  const { state, today, actor, pendingRequests } = useStore()
  const [palette, setPalette] = useState(false)
  const [bell, setBell] = useState(false)
  const alerts = useMemo(() => buildBriefing(state, today).priorities.slice(0, 6), [state, today])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPalette(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <header className="topbar">
      <div className="topbar-title">
        <Button variant="ghost" className="mobile-menu" onClick={menu} aria-label="Open navigation" icon={Menu} />
        <span>{state.settings.agencyName}</span>
        <span>/</span>
        <strong>{PAGES[page].label}</strong>
        {pendingRequests > 0 && (
          <span className="working-badge inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium text-amber-500 bg-amber-500/10 rounded-full animate-pulse">
            <Loader2 size={12} className="animate-spin" />
            Working…
          </span>
        )}
      </div>
      <div className="top-actions">
        <button className="command-search" onClick={() => setPalette(true)}>
          <Search size={15} />
          <span>Search records</span>
          <kbd>
            <Command size={11} /> K
          </kbd>
        </button>
        <Button variant="ghost" aria-label="Search" className="icon-button mobile-search" icon={Search} onClick={() => setPalette(true)} />
        <div className="popover-anchor">
          <Button variant="ghost" aria-label="Notifications" className={`icon-button ${alerts.some((a) => a.severity === "high") ? "notification" : ""}`} icon={Bell} onClick={() => setBell(!bell)} />
          {bell && (
            <>
              <div className="popover-scrim" onClick={() => setBell(false)} />
              <div className="popover">
                <div className="popover-head">
                  <strong>Alerts</strong>
                  <small>Computed from current records</small>
                </div>
                {alerts.length === 0 && <p className="popover-empty"><Check size={14} /> Nothing needs attention.</p>}
                {alerts.map((a) => (
                  <button key={a.id} className="popover-item" onClick={() => { setBell(false); go(a.action.to) }}>
                    <span className={`severity severity-${a.severity === "low" ? "medium" : a.severity}`}>!</span>
                    <span>
                      <strong>{a.title}</strong>
                      <small>{a.detail}</small>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <Button variant="ghost" aria-label={dark ? "Use light theme" : "Use dark theme"} className="icon-button" icon={dark ? Sun : Moon} onClick={() => setDark(!dark)} />
        <div className="header-avatar" title={actor}>{initials(actor)}</div>
      </div>
      {pendingRequests > 0 && (
        <div className="topbar-progress-track">
          <div className="topbar-progress-indicator" />
        </div>
      )}
      {palette && <CommandPalette close={() => setPalette(false)} />}
    </header>
  )
}

type Hit = { group: string; label: string; detail: string; to: string }

function CommandPalette({ close }: { close: () => void }) {
  const { state } = useStore()
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
  }, [])

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase()
    const match = (...fields: string[]) => !q || fields.some((f) => f.toLowerCase().includes(q))
    const out: Hit[] = []
    for (const [id, p] of Object.entries(PAGES)) if (match(p.label)) out.push({ group: "Pages", label: p.label, detail: "Go to page", to: id })
    if (q) {
      for (const inv of state.invoices)
        if (match(inv.id, clientOf(state, inv.clientId).name, inv.lineItems[0]?.description ?? ""))
          out.push({ group: "Invoices", label: `${inv.id} · ${clientOf(state, inv.clientId).name}`, detail: `${money(invoiceTotal(inv), inv.currency)} · ${inv.status}`, to: `invoices?id=${inv.id}` })
      for (const t of state.transactions.slice(0, 200))
        if (match(t.description, t.party, t.id)) out.push({ group: "Transactions", label: t.description, detail: `${t.party} · ${money(t.amount)}`, to: `transactions?id=${t.id}` })
      for (const p of state.projects) if (match(p.name)) out.push({ group: "Projects", label: p.name, detail: clientOf(state, p.clientId).name, to: `projects?id=${p.id}` })
      out.push({ group: "Ask", label: `Ask CentsAI: “${query.trim()}”`, detail: "Answer from your records", to: `copilot?q=${encodeURIComponent(query.trim())}` })
    }
    return out.slice(0, 14)
  }, [query, state])

  const pick = (hit?: Hit) => {
    if (!hit) return
    close()
    go(hit.to)
  }

  return (
    <div className="modal-shell palette-shell" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Search">
        <div className="palette-input">
          <Search size={16} />
          <input
            ref={input}
            value={query}
            placeholder="Search invoices, transactions, projects — or ask a question"
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") close()
              if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, hits.length - 1))
              if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0))
              if (e.key === "Enter") pick(hits[active])
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-results">
          {hits.map((hit, i) => (
            <button key={hit.group + hit.label + i} className={i === active ? "active" : ""} onMouseEnter={() => setActive(i)} onClick={() => pick(hit)}>
              {hit.group === "Ask" ? <Bot size={14} /> : <Badge tone="neutral">{hit.group}</Badge>}
              <strong>{hit.label}</strong>
              <small>{hit.detail}</small>
            </button>
          ))}
          {hits.length === 0 && <p className="popover-empty">No matches.</p>}
        </div>
      </div>
    </div>
  )
}

export function Toast() {
  const { toastMessage, clearToast } = useStore()
  if (!toastMessage) return null
  return (
    <div className="toast" role="status">
      <Check size={16} />
      {toastMessage}
      <Button variant="ghost" icon={X} aria-label="Dismiss" onClick={clearToast} />
    </div>
  )
}
