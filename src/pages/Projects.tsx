import { useMemo, useState } from "react"
import { AlertTriangle, ArrowRight, Check, Clock3, Download, ShieldCheck, Sparkles } from "lucide-react"
import { Badge, Button, Card, CardHeader, Drawer, Field, Input, MetricCard, Note, Select, Title } from "../components/ui"
import { download, toCsv } from "../lib/csv"
import { HOURS_PER_MONTH, projectStats } from "../lib/finance"
import { money, pct } from "../lib/format"
import { go, routeParams } from "../lib/router"
import { useStore } from "../lib/store"

export default function ProjectsPage() {
  const { state } = useStore()
  const [client, setClient] = useState("All")
  const [selectedId, setSelectedId] = useState<string | null>(routeParams().get("id"))
  const stats = useMemo(() => state.projects.map((p) => projectStats(state, p)), [state])
  const rows = stats.filter((p) => client === "All" || p.project.clientId === client).sort((a, b) => a.margin - b.margin)
  const billed = rows.reduce((s, p) => s + p.billed, 0)
  const cost = rows.reduce((s, p) => s + p.cost, 0)
  const contribution = billed - cost
  const labour = rows.reduce((s, p) => s + p.labour, 0)
  const contractors = rows.reduce((s, p) => s + p.contractors, 0)
  const direct = rows.reduce((s, p) => s + p.direct, 0)
  const hours = rows.reduce((s, p) => s + p.hours, 0)
  const unassigned = rows.reduce((s, p) => s + p.project.unassignedHours, 0)
  const selected = stats.find((p) => p.project.id === selectedId)

  const exportCsv = () =>
    download(
      "centsai-project-profitability.csv",
      toCsv([["Project", "Client", "Billed", "Labour", "Contractors", "Direct", "Contribution", "Margin %", "Budget used %"], ...rows.map((p) => [p.project.name, p.client.name, Math.round(p.billed), Math.round(p.labour), p.contractors, p.direct, Math.round(p.contribution), p.margin.toFixed(1), p.budgetUsed.toFixed(0)])]),
    )

  return (
    <div className="page">
      <div className="page-intro">
        <div>
          <Title>Projects & Profitability</Title>
          <p>Which client work actually makes money — after people, contractors and direct costs.</p>
        </div>
        <div className="intro-actions">
          <Select value={client} onChange={(e) => setClient(e.target.value)} aria-label="Client">
            <option value="All">All clients</option>
            {state.clients.filter((c) => state.projects.some((p) => p.clientId === c.id)).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Button icon={Download} onClick={exportCsv}>
            Export analysis
          </Button>
        </div>
      </div>
      <div className="demo-note">
        <ShieldCheck size={14} /> Estimates use recorded costs and owner-provided rates (salary ÷ {HOURS_PER_MONTH} h). They are not audited profit figures.
      </div>
      <div className="metric-grid">
        <MetricCard label="Billed Revenue" value={money(billed)} detail={`Across ${rows.length} projects to date`} />
        <MetricCard label="Attributed Costs" value={money(cost)} detail={`${pct(billed ? (cost / billed) * 100 : 0)} of billed revenue`} />
        <MetricCard label="Estimated Contribution" value={money(contribution)} detail="Before shared overhead" forecast />
        <MetricCard label="Blended Margin" value={pct(billed ? (contribution / billed) * 100 : 0)} detail={`${rows.filter((p) => p.margin < 25).length} project(s) below 25%`} tone={rows.some((p) => p.margin < 25) ? "amber" : undefined} />
      </div>
      <Card>
        <CardHeader title="Profitability Comparison" action={<span className="section-note">Lowest margin first</span>} />
        <div className="project-cards">
          {rows.map((p) => (
            <button className="project-row" key={p.project.id} onClick={() => setSelectedId(p.project.id)}>
              <div>
                <strong>{p.project.name}</strong>
                <small>
                  {p.client.name} · {p.project.billing}
                  {p.flags.length ? ` · ${p.flags.join(" · ")}` : ""}
                </small>
              </div>
              <div className="margin-bar" title={`Margin ${pct(p.margin)}`}>
                <span className={p.margin < 25 ? "bar-risk-amber" : ""} style={{ width: `${Math.max(2, Math.min(100, p.margin))}%` }} />
              </div>
              <div>
                <small>Contribution</small>
                <strong>{money(p.contribution)}</strong>
              </div>
              <div>
                <small>Margin</small>
                <Badge tone={p.margin < 25 ? "amber" : "green"}>{pct(p.margin)}</Badge>
              </div>
              <ArrowRight size={15} />
            </button>
          ))}
        </div>
      </Card>
      <div className="two-column">
        <Card>
          <CardHeader title="Cost Attribution" />
          <div className="bar-list">
            {[
              ["Employee time", labour],
              ["Contractors", contractors],
              ["Direct project costs", direct],
            ].map(([name, value]) => (
              <div key={name as string}>
                <div>
                  <span>{name}</span>
                  <strong>
                    {money(value as number)} <small className="muted">{pct(cost ? ((value as number) / cost) * 100 : 0, 0)}</small>
                  </strong>
                </div>
                <div className="bar">
                  <span style={{ width: `${cost ? ((value as number) / cost) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Data Quality" />
          <div className="quality-score">
            <strong>{pct(hours + unassigned ? (hours / (hours + unassigned)) * 100 : 100, 0)}</strong>
            <span>of logged hours are attributed to a person</span>
          </div>
          {stats.filter((p) => p.project.unassignedHours > 0).map((p) => (
            <p className="section-note" key={p.project.id}>
              {p.project.name} has {p.project.unassignedHours} unassigned hours. Assigning them will change its estimated margin.
            </p>
          ))}
          {unassigned > 0 ? (
            <Button onClick={() => setSelectedId(stats.find((p) => p.project.unassignedHours > 0)!.project.id)}>Assign missing hours</Button>
          ) : (
            <p className="integrity-inline">
              <Check size={14} /> All hours are attributed.
            </p>
          )}
        </Card>
      </div>
      {selected && <ProjectDrawer id={selected.project.id} close={() => setSelectedId(null)} />}
    </div>
  )
}

function ProjectDrawer({ id, close }: { id: string; close: () => void }) {
  const { state, assignHours, log, actor, toast, can } = useStore()
  const p = projectStats(state, state.projects.find((x) => x.id === id)!)
  const [employeeId, setEmployeeId] = useState(state.employees[0]?.id ?? "")
  const [hours, setHours] = useState(p.project.unassignedHours || 8)
  const fromUnassigned = Math.min(hours, p.project.unassignedHours)

  const assign = async () => {
    if (!can.edit) return toast("Viewers can't change project data.")
    if (!(hours > 0)) return toast("Enter a positive number of hours")
    const employee = state.employees.find((e) => e.id === employeeId)!
    const res = await assignHours(id, employeeId, hours)
    if (!res.ok) return toast(res.message)
    log({ actor, action: "Hours attributed", detail: `${hours}h on ${p.project.name} → ${employee.name} (${money((employee.monthlySalary / HOURS_PER_MONTH) * hours)})`, ref: id, outcome: "info" })
    toast(`${hours}h assigned — margin recalculated`)
  }

  const story =
    p.billed === 0
      ? "Nothing has been billed yet, so margin can't be estimated."
      : `${p.project.name} has billed ${money(p.billed)} so far against ${money(p.cost)} of attributed costs, leaving an estimated contribution of ${money(p.contribution)} (${pct(p.margin)}). ` +
        (p.budgetUsed > 100 ? `Costs are ${pct(p.budgetUsed - 100, 0)} over the ${money(p.project.budgetCost)} cost budget. ` : `${pct(p.budgetUsed, 0)} of the cost budget is used. `) +
        (p.contractors > p.labour * 0.5 ? "Contractor spend is a large share of cost — check whether that work was scoped into the fee. " : "") +
        (p.project.unassignedHours ? `${p.project.unassignedHours} hours are unassigned, so the true margin is likely lower.` : "")

  return (
    <Drawer eyebrow="PROJECT PROFITABILITY" title={p.project.name} onClose={close} footer={<Button onClick={() => go(`copilot?q=${encodeURIComponent("Which projects have the lowest margins?")}`)}>Ask CentsAI</Button>}>
      <div className="drawer-status">
        <Badge tone={p.margin < 25 ? "amber" : "green"}>{pct(p.margin)} margin</Badge>
        <div className="drawer-amount">
          <strong>{money(p.contribution)}</strong>
          <small>estimated contribution</small>
        </div>
      </div>
      <div className="detail-grid">
        <div><span>Client</span><strong>{p.client.name}</strong></div>
        <div><span>Billing</span><strong>{p.project.billing}{p.project.retainer ? ` · ${money(p.project.retainer.amount)}/mo` : ""}</strong></div>
        <div><span>Contract value</span><strong>{money(p.project.contractValue)}</strong></div>
        <div><span>Billed to date</span><strong>{money(p.billed)}</strong></div>
        <div><span>Collected</span><strong>{money(p.collected)}</strong></div>
        <div><span>Not yet billed</span><strong>{money(p.unbilled)}</strong></div>
      </div>
      <div className="budget-meter">
        <div>
          <span>Cost budget used</span>
          <strong className={p.budgetUsed > 100 ? "danger-text" : ""}>
            {money(p.cost)} / {money(p.project.budgetCost)}
          </strong>
        </div>
        <div className="bar">
          <span className={p.budgetUsed > 100 ? "bar-risk" : ""} style={{ width: `${Math.min(100, p.budgetUsed)}%` }} />
        </div>
      </div>
      <div className="ai-explanation drawer-explain">
        <div className="ai-label">
          <Sparkles size={13} /> CentsAI explanation
        </div>
        <p>{story}</p>
      </div>
      <Title level={3}>Labour attribution</Title>
      <div className="mini-table">
        {p.labourLines.map((l) => (
          <div key={l.name}>
            <span>
              {l.name} <small>{l.role}</small>
            </span>
            <span>{l.hours}h × {money(l.rate)}</span>
            <b>{money(l.cost)}</b>
          </div>
        ))}
        {p.bills.map((b) => (
          <div key={b.id}>
            <span>
              {b.vendor} <small>contractor · {b.status}</small>
            </span>
            <span>{b.reference}</span>
            <b>{money(b.amount)}</b>
          </div>
        ))}
        {p.direct > 0 && (
          <div>
            <span>Direct costs</span>
            <span>ledger</span>
            <b>{money(p.direct)}</b>
          </div>
        )}
      </div>
      <div className="assign-hours">
        <Title level={3}>
          <Clock3 size={14} /> {p.project.unassignedHours ? `Assign ${p.project.unassignedHours} unassigned hours` : "Log additional hours"}
        </Title>
        <div className="compact-form-grid">
          <Field label="Team member">
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              {state.employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {money(e.monthlySalary / HOURS_PER_MONTH)}/h
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Hours">
            <Input type="number" min="1" value={hours} onChange={(e) => setHours(Number(e.target.value))} />
          </Field>
        </div>
        {p.project.unassignedHours > 0 && fromUnassigned > 0 && <small className="section-note">{fromUnassigned}h will come from the unassigned pool.</small>}
        <Button variant="primary" disabled={!can.edit} onClick={assign}>
          {p.project.unassignedHours ? "Assign hours" : "Log hours"}
        </Button>
      </div>
      {p.flags.includes("Over budget") && (
        <Note icon={AlertTriangle} tone="amber">
          Over budget: consider a change request for extra scope before the next milestone invoice.
        </Note>
      )}
    </Drawer>
  )
}
