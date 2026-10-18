import { useMemo, useState } from "react"
import { AlertTriangle, ArrowRight, Calculator, Pencil, Plus, ShieldCheck, Trash2, UserPlus } from "lucide-react"
import { Badge, Button, Card, CardHeader, Field, FormModal, Input, MetricCard, Segmented, Select, Tabs, Title } from "../components/ui"
import { addDays, dayInMonth, fmtDay, fmtMonth, monthKey } from "../lib/dates"
import { buildEvents, cashBalance, forecast, monthlyPayroll, projectOf, type CashEvent } from "../lib/finance"
import { money } from "../lib/format"
import { go } from "../lib/router"
import { useStore } from "../lib/store"
import type { ContractorBill, Employee } from "../lib/types"

export default function PayrollPage() {
  const { state, today, removeEmployee: deleteEmployeeFromStore, log, actor, toast, can, requestContractorPayment } = useStore()
  const [tab, setTab] = useState<"Employees" | "Contractors">("Employees")
  const [window_, setWindow] = useState<7 | 14 | 30>(14)
  const [editing, setEditing] = useState<Employee | "new" | null>(null)
  const [addingBill, setAddingBill] = useState(false)
  const [payingBillId, setPayingBillId] = useState<string | null>(null)
  const [hire, setHire] = useState({ salary: 5600, start: dayInMonth(today, 1, 1), equipment: 8130, other: 630 })

  const payroll = monthlyPayroll(state)
  const unpaid = state.contractorBills.filter((b) => b.status !== "Paid")
  const events = buildEvents(state, today, 30, "expected")
  const upcoming = events.filter((e) => (e.kind === "payroll" || e.kind === "contractor") && e.date <= addDays(today, window_))
  const monthStart = `${monthKey(today)}-01`
  const paidThisMonth = state.transactions.filter((t) => t.date >= monthStart && (t.category === "Payroll" || t.category === "Contractors")).reduce((s, t) => s + t.amount, 0)
  const nextPayDate = (e: Employee) => {
    const d = dayInMonth(today, 0, e.payDay)
    return d > today ? d : dayInMonth(today, 1, e.payDay)
  }

  const cons = useMemo(() => forecast(state, today, 30, "conservative"), [state, today])
  const riskyPay = upcoming.find((e) => e.kind === "payroll" && (cons.series.find((p) => p.date === e.date)?.balance ?? Infinity) < state.settings.safetyThreshold)

  const hireResult = useMemo(() => {
    const payDay = state.employees[0]?.payDay ?? 28
    const extra: CashEvent[] = [
      ...[0, 1, 2].map((m) => ({ date: dayInMonth(hire.start, m, payDay), label: "New hire", amount: -(hire.salary + hire.other), kind: "simulated" as const, certainty: "Simulated" as const })),
      { date: hire.start, label: "Equipment", amount: -hire.equipment, kind: "simulated", certainty: "Simulated" },
    ]
    const before = forecast(state, today, 90, "conservative")
    const after = forecast(state, today, 90, "conservative", { extra })
    return { before, after }
  }, [state, today, hire])

  const removeEmployee = async (e: Employee) => {
    if (!window.confirm(`Remove ${e.name} from payroll planning? Past payroll transactions stay in the ledger.`)) return
    const res = await deleteEmployeeFromStore(e.id)
    if (!res.ok) return toast(res.message)
    log({ actor, action: "Employee removed", detail: `${e.name} (${money(e.monthlySalary)}/month) removed from future payroll`, outcome: "warning" })
    toast(`${e.name} removed from future payroll`)
  }

  return (
    <div className="page">
      <div className="page-intro">
        <div>
          <Title>Payroll & Contractors</Title>
          <p>People costs and upcoming payments, before they hit your bank account.</p>
        </div>
        <div className="intro-actions">
          <span className="date">{fmtMonth(today)}</span>
          <Button icon={UserPlus} disabled={!can.edit} onClick={() => setAddingBill(true)}>
            Add contractor bill
          </Button>
          <Button variant="primary" icon={Plus} disabled={!can.edit} onClick={() => setEditing("new")}>
            Add employee
          </Button>
        </div>
      </div>
      <div className="demo-note">
        <ShieldCheck size={14} /> Payroll is tracked, not executed. Contractor payments need approval and a confirmed bank reference before they’re recorded.
      </div>
      <div className="metric-grid">
        <MetricCard label="Monthly Payroll" value={money(payroll)} detail={`${state.employees.filter((e) => e.status === "Active").length} active · ${state.employees.filter((e) => e.status === "Planned").length} planned`} />
        <MetricCard label="Contractor Obligations" value={money(unpaid.reduce((s, b) => s + b.amount, 0))} detail={`${unpaid.length} unpaid bill${unpaid.length === 1 ? "" : "s"}`} />
        <MetricCard label={`Due in ${window_} Days`} value={money(upcoming.reduce((s, e) => s - e.amount, 0))} detail="Payroll and contractor payments" />
        <MetricCard label="Paid This Month" value={money(paidThisMonth)} detail="Recorded payroll & contractor payments" />
      </div>
      <Card>
        <div className="invoice-toolbar">
          <Tabs options={["Employees", "Contractors"] as ("Employees" | "Contractors")[]} value={tab} onChange={setTab} counts={{ Contractors: unpaid.length }} />
          <span className="section-note">Payroll coverage: {(cashBalance(state, today) / (payroll || 1)).toFixed(1)} months of salaries in recorded cash</span>
        </div>
        <div className="table-scroll">
          <table>
            {tab === "Employees" ? (
              <>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Role</th>
                    <th>Monthly salary</th>
                    <th>Next pay date</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {state.employees.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <strong>{e.name}</strong>
                      </td>
                      <td className="muted">{e.role}</td>
                      <td>{money(e.monthlySalary)}</td>
                      <td>{e.status === "Planned" && e.startDate > today ? `Starts ${fmtDay(e.startDate)}` : fmtDay(nextPayDate(e))}</td>
                      <td>
                        <Badge tone={e.status === "Active" ? "blue" : "amber"}>{e.status}</Badge>
                      </td>
                      <td>
                        <div className="row-actions">
                          <Button variant="ghost" icon={Pencil} aria-label={`Edit ${e.name}`} disabled={!can.edit} onClick={() => setEditing(e)} />
                          <Button variant="ghost" icon={Trash2} aria-label={`Remove ${e.name}`} disabled={!can.edit} onClick={() => void removeEmployee(e)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            ) : (
              <>
                <thead>
                  <tr>
                    <th>Contractor</th>
                    <th>Project</th>
                    <th>Reference</th>
                    <th>Amount</th>
                    <th>Due</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {state.contractorBills.map((b) => {
                    const approval = state.approvals.find((a) => a.refId === b.id && (a.status === "Pending" || a.status === "Submitted"))
                    return (
                      <tr key={b.id}>
                        <td>
                          <strong>{b.vendor}</strong>
                        </td>
                        <td>{projectOf(state, b.projectId)?.name ?? "Shared"}</td>
                        <td className="muted">{b.reference}</td>
                        <td>{money(b.amount)}</td>
                        <td>{b.status === "Paid" ? `Paid ${b.paidDate ? fmtDay(b.paidDate) : ""}` : fmtDay(b.dueDate)}</td>
                        <td>
                          <Badge tone={b.status === "Paid" ? "green" : approval ? "amber" : "blue"}>{approval ? `${approval.status === "Pending" ? "Awaiting approval" : "Awaiting transfer"}` : b.status}</Badge>
                        </td>
                        <td>
                          {b.status !== "Paid" &&
                            (approval ? (
                              <Button variant="ghost" onClick={() => go("approvals")}>
                                {approval.id} <ArrowRight size={13} />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                disabled={!can.prepare || payingBillId === b.id}
                                loading={payingBillId === b.id}
                                onClick={async () => {
                                  if (payingBillId) return
                                  setPayingBillId(b.id)
                                  try {
                                    const res = await requestContractorPayment(b.id, state.settings.role === "Owner")
                                    toast(res.message)
                                  } finally {
                                    setPayingBillId(null)
                                  }
                                }}
                              >
                                {state.settings.role === "Owner" ? "Pay contractor" : "Request approval from Owner"}
                              </Button>
                            ))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </>
            )}
          </table>
        </div>
      </Card>
      <div className="people-grid">
        <Card>
          <CardHeader title="Upcoming People Obligations" action={<Segmented options={[7, 14, 30] as (7 | 14 | 30)[]} value={window_} onChange={setWindow} labels={{ 7: "7D", 14: "14D", 30: "30D" }} />} />
          <div className="obligation-timeline">
            {upcoming.map((e) => (
              <div key={e.label + e.date}>
                <span className={e.kind === "payroll" ? "warning" : ""} />
                <div>
                  <strong>{e.label}</strong>
                  <small>{fmtDay(e.date)} · {e.kind === "payroll" ? "Salaries" : "Contractor bill"}</small>
                </div>
                <b>{money(-e.amount)}</b>
                <Badge tone="blue">{e.certainty}</Badge>
              </div>
            ))}
            {upcoming.length === 0 && <div className="empty">Nothing due in the next {window_} days.</div>}
          </div>
          {riskyPay && (
            <div className="risk-inline">
              <AlertTriangle size={15} />
              <span>
                In the conservative scenario, cash after the {fmtDay(riskyPay.date)} payroll is below your {money(state.settings.safetyThreshold)} safety threshold. No payment has been initiated.
              </span>
            </div>
          )}
        </Card>
        <Card className="hire-panel">
          <CardHeader title="What Would a New Hire Cost?" action={<Calculator size={17} />} />
          <div className="compact-form-grid">
            <Field label={`Monthly salary (${state.settings.currency})`}>
              <Input type="number" min="0" step="1000" value={hire.salary} onChange={(e) => setHire({ ...hire, salary: Number(e.target.value) })} />
            </Field>
            <Field label="Start date">
              <Input type="date" min={today} value={hire.start} onChange={(e) => setHire({ ...hire, start: e.target.value })} />
            </Field>
            <Field label={`Equipment (${state.settings.currency})`}>
              <Input type="number" min="0" step="1000" value={hire.equipment} onChange={(e) => setHire({ ...hire, equipment: Number(e.target.value) })} />
            </Field>
            <Field label={`Other monthly costs (${state.settings.currency})`}>
              <Input type="number" min="0" step="500" value={hire.other} onChange={(e) => setHire({ ...hire, other: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="hire-results">
            <div>
              <span>Incremental monthly cost</span>
              <strong>{money(hire.salary + hire.other)}</strong>
            </div>
            <div>
              <span>First 3 months incl. equipment</span>
              <strong>{money((hire.salary + hire.other) * 3 + hire.equipment)}</strong>
            </div>
            <div>
              <span>Lowest cash · without hire</span>
              <strong>{money(hireResult.before.lowest)}</strong>
            </div>
            <div>
              <span>Lowest cash · with hire</span>
              <strong className={hireResult.after.lowest < state.settings.safetyThreshold ? "danger-text" : ""}>{money(hireResult.after.lowest)}</strong>
            </div>
          </div>
          <div className="panel-actions">
            <small>Conservative 90-day forecast, including expected client receipts. Salary assumed paid on payroll day.</small>
            <Button variant="primary" onClick={() => go(`simulator?type=hire&salary=${hire.salary}`)}>
              Full simulation <ArrowRight size={13} />
            </Button>
          </div>
        </Card>
      </div>
      {editing && <EmployeeForm record={editing === "new" ? undefined : editing} close={() => setEditing(null)} />}
      {addingBill && <BillForm close={() => setAddingBill(false)} />}
    </div>
  )
}

function EmployeeForm({ record, close }: { record?: Employee; close: () => void }) {
  const { state, today, addEmployee, patchEmployee, log, actor, toast } = useStore()
  const [d, setD] = useState({
    name: record?.name ?? "", role: record?.role ?? "", monthlySalary: record ? String(record.monthlySalary) : "",
    payDay: String(record?.payDay ?? state.employees[0]?.payDay ?? 28), startDate: record?.startDate ?? today, status: record?.status ?? ("Active" as Employee["status"]),
  })
  return (
    <FormModal
      eyebrow="PAYROLL PLANNING RECORD"
      title={record ? `Edit ${record.name}` : "Add employee"}
      submitLabel={record ? "Save changes" : "Add to payroll"}
      onClose={close}
      onSubmit={async () => {
        const salary = Number(d.monthlySalary)
        const payDay = Math.min(28, Math.max(1, Number(d.payDay)))
        if (!d.name.trim() || !d.role.trim() || !(salary > 0)) {
          const msg = "Enter a name, role and positive salary"
          toast(msg)
          throw new Error(msg)
        }
        const status: Employee["status"] = d.startDate > today ? "Planned" : d.status
        const payload = { name: d.name.trim(), role: d.role.trim(), monthlySalary: salary, payDay, startDate: d.startDate, status }
        const res = record
          ? await patchEmployee(record.id, payload)
          : await addEmployee(payload)
        if (!res.ok) {
          toast(res.message)
          throw new Error(res.message)
        }
        log({ actor, action: record ? "Employee updated" : "Employee added", detail: `${d.name} · ${money(salary)}/month from ${fmtDay(d.startDate)}`, outcome: "info" })
        toast(record ? "Changes saved — forecast updated" : `${d.name} added — forecast now includes the salary`)
        close()
      }}
    >
      <div className="form-grid">
        <Field label="Full name" full>
          <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} required />
        </Field>
        <Field label="Role">
          <Input value={d.role} onChange={(e) => setD({ ...d, role: e.target.value })} required />
        </Field>
        <Field label={`Monthly salary (${state.settings.currency})`}>
          <Input type="number" min="1" value={d.monthlySalary} onChange={(e) => setD({ ...d, monthlySalary: e.target.value })} required />
        </Field>
        <Field label="Start date" hint="A future date marks the hire as Planned.">
          <Input type="date" value={d.startDate} onChange={(e) => setD({ ...d, startDate: e.target.value })} />
        </Field>
        <Field label="Pay day (1–28)">
          <Input type="number" min="1" max="28" value={d.payDay} onChange={(e) => setD({ ...d, payDay: e.target.value })} />
        </Field>
      </div>
    </FormModal>
  )
}

function BillForm({ close }: { close: () => void }) {
  const { state, today, addContractorBill, log, actor, toast } = useStore()
  const [d, setD] = useState({ vendor: "", projectId: state.projects[0]?.id ?? "", reference: "", amount: "", dueDate: addDays(today, 14) })
  return (
    <FormModal
      eyebrow="CONTRACTOR INVOICE"
      title="Add contractor bill"
      submitLabel="Add obligation"
      onClose={close}
      onSubmit={async () => {
        const amount = Number(d.amount)
        if (!d.vendor.trim() || !(amount > 0)) {
          const msg = "Enter a contractor and positive amount"
          toast(msg)
          throw new Error(msg)
        }
        const res = await addContractorBill({
          vendor: d.vendor.trim(),
          projectId: d.projectId || undefined,
          reference: d.reference || "—",
          amount,
          dueDate: d.dueDate,
          status: "Scheduled",
        })
        if (!res.ok) {
          toast(res.message)
          throw new Error(res.message)
        }
        log({ actor, action: "Contractor bill added", detail: `${d.vendor.trim()} ${money(amount)} due ${fmtDay(d.dueDate)}`, outcome: "info" })
        toast("Bill added — included in forecast and project costs")
        close()
      }}
    >
      <div className="form-grid">
        <Field label="Contractor or business" full>
          <Input value={d.vendor} onChange={(e) => setD({ ...d, vendor: e.target.value })} required />
        </Field>
        <Field label="Project">
          <Select value={d.projectId} onChange={(e) => setD({ ...d, projectId: e.target.value })}>
            <option value="">Shared overhead</option>
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Invoice reference">
          <Input value={d.reference} onChange={(e) => setD({ ...d, reference: e.target.value })} />
        </Field>
        <Field label={`Amount (${state.settings.currency})`}>
          <Input type="number" min="1" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} required />
        </Field>
        <Field label="Due date">
          <Input type="date" value={d.dueDate} onChange={(e) => setD({ ...d, dueDate: e.target.value })} />
        </Field>
      </div>
    </FormModal>
  )
}
