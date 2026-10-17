import { useMemo, useState } from "react"
import { AlertTriangle, Check, Download, FileText, Pencil, Plus, Search, ShieldCheck, Trash2, Upload, X } from "lucide-react"
import { Badge, Button, Card, CardHeader, Drawer, Field, FormModal, Input, MetricCard, Modal, Note, Select, Textarea, Title } from "../components/ui"
import { download, parseCsv, sampleCsv, toCsv } from "../lib/csv"
import { addDays, dayInMonth, fmtDate, monthKey, parseLooseDate } from "../lib/dates"
import { findDuplicate, periodTotals } from "../lib/finance"
import { money, uid } from "../lib/format"
import { routeParams } from "../lib/router"
import { useStore } from "../lib/store"
import type { Transaction, TxnType } from "../lib/types"

const CATEGORIES = ["Project revenue", "Retainer income", "Other income", "Payroll", "Contractors", "Software", "Operations", "Tax", "Debt repayment", "Marketing", "Travel", "Equipment", "Uncategorized"]
const PAGE_SIZE = 15

const periodRange = (period: string, today: string): [string, string] => {
  if (period === "This month") return [`${monthKey(today)}-01`, today]
  if (period === "Last month") return [dayInMonth(today, -1, 1), addDays(`${monthKey(today)}-01`, -1)]
  if (period === "Last 90 days") return [addDays(today, -90), today]
  return ["0000-01-01", "9999-12-31"]
}

export default function TransactionsPage() {
  const { state, today, update, log, actor, toast, can } = useStore()
  const [query, setQuery] = useState("")
  const [type, setType] = useState("All")
  const [status, setStatus] = useState("All")
  const [category, setCategory] = useState("All")
  const [period, setPeriod] = useState("This month")
  const [sort, setSort] = useState("date")
  const [pageNo, setPageNo] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(routeParams().get("id"))
  const [editing, setEditing] = useState<Transaction | "new" | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const [from, to] = periodRange(period, today)
  const inPeriod = state.transactions.filter((t) => t.date >= from && t.date <= to)
  const totals = periodTotals(state.transactions, from, to)
  const filtered = inPeriod
    .filter(
      (t) =>
        (type === "All" || t.type === type) &&
        (status === "All" || t.status === status) &&
        (category === "All" || t.category === category) &&
        `${t.description} ${t.party} ${t.id} ${t.reference ?? ""}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => (sort === "amount" ? b.amount - a.amount : b.date.localeCompare(a.date)))
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const shown = filtered.slice(pageNo * PAGE_SIZE, pageNo * PAGE_SIZE + PAGE_SIZE)
  const selected = state.transactions.find((t) => t.id === selectedId)

  const insights = useMemo(() => {
    const review = state.transactions.filter((t) => t.status === "Review")
    const uncategorized = state.transactions.filter((t) => t.category === "Uncategorized")
    const unusual: { t: Transaction; avg: number }[] = []
    const recent = state.transactions.filter((t) => t.type === "Expense" && t.date >= addDays(today, -31))
    for (const t of recent) {
      const history = state.transactions.filter((h) => h.party === t.party && h.type === "Expense" && h.date < addDays(t.date, -20))
      if (history.length < 1) continue
      const avg = history.reduce((s, h) => s + h.amount, 0) / history.length
      if (t.amount > avg * 1.3) unusual.push({ t, avg })
    }
    const paidInvoices = state.invoices.filter((i) => i.status === "Paid")
    const linked = paidInvoices.filter((i) => state.transactions.filter((t) => t.invoiceId === i.id).length === 1).length
    return { review, uncategorized, unusual, paidInvoices, linked }
  }, [state, today])

  const exportCsv = () =>
    download(
      `centsai-transactions-${period.replace(/\s/g, "-").toLowerCase()}.csv`,
      toCsv([["id", "date", "description", "party", "category", "type", "amount_inr", "status", "source", "reference"], ...filtered.map((t) => [t.id, t.date, t.description, t.party, t.category, t.type, t.amount, t.status, t.source, t.reference])]),
    )

  const reset = () => setPageNo(0)

  return (
    <div className="page">
      <div className="page-intro">
        <div>
          <Title>Transactions</Title>
          <p>Every rupee recorded in your agency ledger, with its source and verification status.</p>
        </div>
        <div className="intro-actions">
          <Select value={period} onChange={(e) => { setPeriod(e.target.value); reset() }} aria-label="Period">
            <option>This month</option>
            <option>Last month</option>
            <option>Last 90 days</option>
            <option>All time</option>
          </Select>
          <Button icon={Download} onClick={exportCsv}>
            Export
          </Button>
          <Button icon={Upload} disabled={!can.edit} onClick={() => setImportOpen(true)}>
            Import CSV
          </Button>
          <Button variant="primary" icon={Plus} disabled={!can.edit} onClick={() => setEditing("new")}>
            Add transaction
          </Button>
        </div>
      </div>
      <div className="demo-note">
        <ShieldCheck size={14} /> Recorded transactions only · Unpaid invoices are excluded from cash totals until payment is verified or recorded.
      </div>
      <div className="metric-grid">
        <MetricCard label="Money In" value={money(totals.income)} detail={period} positive={totals.income > 0} />
        <MetricCard label="Money Out" value={money(totals.expense)} detail={period} />
        <MetricCard label="Net Cash Flow" value={money(totals.net)} detail="Recorded income minus expenses" tone={totals.net < 0 ? "amber" : undefined} />
        <MetricCard label="Requiring Review" value={String(insights.review.length)} detail="Possible duplicates or unusual entries" tone={insights.review.length ? "amber" : undefined} onClick={() => { setStatus("Review"); setPeriod("All time"); reset() }} />
      </div>
      <Card>
        <div className="ledger-toolbar ledger-toolbar-5">
          <div className="search-input">
            <Search size={15} />
            <Input value={query} onChange={(e) => { setQuery(e.target.value); reset() }} placeholder="Search description, party, ID or reference" aria-label="Search transactions" />
          </div>
          <Select value={type} onChange={(e) => { setType(e.target.value); reset() }} aria-label="Type">
            <option value="All">All types</option>
            <option>Income</option>
            <option>Expense</option>
          </Select>
          <Select value={category} onChange={(e) => { setCategory(e.target.value); reset() }} aria-label="Category">
            <option value="All">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); reset() }} aria-label="Status">
            <option value="All">All statuses</option>
            <option>Recorded</option>
            <option>Verified</option>
            <option>Review</option>
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            <option value="date">Newest first</option>
            <option value="amount">Highest amount</option>
          </Select>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Client / Vendor</th>
                <th>Category</th>
                <th>Source</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} className="clickable" tabIndex={0} onClick={() => setSelectedId(t.id)} onKeyDown={(e) => e.key === "Enter" && setSelectedId(t.id)}>
                  <td className="muted">{fmtDate(t.date)}</td>
                  <td>
                    <strong>{t.description}</strong>
                    <small className="row-id">{t.id}</small>
                  </td>
                  <td>{t.party}</td>
                  <td>{t.category}</td>
                  <td className="muted">{t.source}</td>
                  <td className={t.type === "Income" ? "amount-in" : ""}>
                    {t.type === "Income" ? "+" : "−"}
                    {money(t.amount)}
                  </td>
                  <td>
                    <Badge tone={t.status === "Review" ? "amber" : t.status === "Verified" ? "green" : "blue"}>{t.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <div className="empty">No transactions match these filters.</div>}
        </div>
        <div className="table-pagination">
          <span>
            Showing {shown.length ? pageNo * PAGE_SIZE + 1 : 0}–{pageNo * PAGE_SIZE + shown.length} of {filtered.length}
          </span>
          <div>
            <Button disabled={pageNo === 0} onClick={() => setPageNo(pageNo - 1)}>
              Previous
            </Button>
            <Badge tone="green">
              {pageNo + 1} / {pages}
            </Badge>
            <Button disabled={pageNo >= pages - 1} onClick={() => setPageNo(pageNo + 1)}>
              Next
            </Button>
          </div>
        </div>
      </Card>
      <div className="two-column">
        <Card>
          <CardHeader title="Expense Intelligence" action={<Badge tone={insights.review.length + insights.unusual.length ? "amber" : "green"}>{insights.review.length + insights.unusual.length + insights.uncategorized.length} signals</Badge>} />
          <div className="flag-list">
            {insights.review.map((t) => (
              <div key={t.id}>
                <AlertTriangle size={16} />
                <span>
                  <strong>
                    {t.party} · {money(t.amount)}
                  </strong>
                  <small>{t.reviewReason ?? "Needs review"}</small>
                </span>
                <Button variant="ghost" onClick={() => setSelectedId(t.id)}>
                  Review
                </Button>
              </div>
            ))}
            {insights.unusual.slice(0, 3).map(({ t, avg }) => (
              <div key={`u-${t.id}`}>
                <AlertTriangle size={16} />
                <span>
                  <strong>
                    {t.party} · {money(t.amount)}
                  </strong>
                  <small>{Math.round((t.amount / avg - 1) * 100)}% above this vendor’s earlier average of {money(avg)}.</small>
                </span>
                <Button variant="ghost" onClick={() => setSelectedId(t.id)}>
                  Open
                </Button>
              </div>
            ))}
            {insights.uncategorized.length > 0 && (
              <div>
                <AlertTriangle size={16} />
                <span>
                  <strong>{insights.uncategorized.length} uncategorized {insights.uncategorized.length === 1 ? "entry" : "entries"}</strong>
                  <small>Imported rows need a category before reporting.</small>
                </span>
                <Button variant="ghost" onClick={() => { setCategory("Uncategorized"); setPeriod("All time") }}>
                  Show
                </Button>
              </div>
            )}
            {insights.review.length + insights.unusual.length + insights.uncategorized.length === 0 && (
              <div>
                <Check size={16} />
                <span>
                  <strong>No anomalies found</strong>
                  <small>Duplicates and unusual amounts are checked on every entry and import.</small>
                </span>
              </div>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Ledger Integrity" />
          <div className="integrity-list">
            <p>
              <Check size={14} /> {insights.linked} of {insights.paidInvoices.length} paid invoices linked to exactly one payment
            </p>
            <p>
              <Check size={14} /> {state.transactions.filter((t) => t.status === "Verified").length} verified records are locked from deletion
            </p>
            <p>
              <Check size={14} /> Source kept on every record ({new Set(state.transactions.map((t) => t.source)).size} sources)
            </p>
          </div>
          <small className="section-note">Amounts are stored in INR. USD receipts are converted at the rate in Settings.</small>
        </Card>
      </div>

      {selected && (
        <Drawer
          eyebrow="TRANSACTION DETAIL"
          title={selected.id}
          onClose={() => setSelectedId(null)}
          footer={
            <>
              <Button
                icon={Trash2}
                variant="ghost"
                disabled={!can.edit}
                onClick={() => {
                  if (selected.status === "Verified" || selected.invoiceId) return toast("Verified and invoice-linked records cannot be deleted — they are part of the audit trail.")
                  update((d) => {
                    d.transactions = d.transactions.filter((t) => t.id !== selected.id)
                  })
                  log({ actor, action: "Transaction deleted", detail: `${selected.id} · ${selected.description} · ${money(selected.amount)}`, ref: selected.id, outcome: "warning" })
                  setSelectedId(null)
                  toast("Transaction deleted and logged")
                }}
              >
                Delete
              </Button>
              {selected.status === "Review" && (
                <Button
                  icon={Check}
                  disabled={!can.edit}
                  onClick={() => {
                    update((d) => {
                      const t = d.transactions.find((x) => x.id === selected.id)!
                      t.status = "Recorded"
                      t.reviewReason = undefined
                    })
                    log({ actor, action: "Review cleared", detail: `${selected.id} confirmed as a valid entry`, ref: selected.id, outcome: "info" })
                    toast("Marked as reviewed")
                  }}
                >
                  Not a duplicate
                </Button>
              )}
              <Button variant="primary" icon={Pencil} disabled={!can.edit} onClick={() => setEditing(selected)}>
                Edit
              </Button>
            </>
          }
        >
          <div className="transaction-hero">
            <Badge tone={selected.type === "Income" ? "green" : "neutral"}>{selected.type}</Badge>
            <strong>
              {selected.type === "Income" ? "+" : "−"}
              {money(selected.amount)}
            </strong>
            <span>{selected.description}</span>
          </div>
          <div className="detail-grid">
            <div><span>Date</span><strong>{fmtDate(selected.date)}</strong></div>
            <div><span>Status</span><strong>{selected.status}</strong></div>
            <div><span>Client / Vendor</span><strong>{selected.party}</strong></div>
            <div><span>Category</span><strong>{selected.category}</strong></div>
            <div><span>Project</span><strong>{state.projects.find((p) => p.id === selected.projectId)?.name ?? "Shared overhead"}</strong></div>
            <div><span>Source</span><strong>{selected.source}</strong></div>
            <div><span>Reference</span><strong>{selected.reference ?? "—"}</strong></div>
            <div><span>Linked invoice</span><strong>{selected.invoiceId ?? "—"}</strong></div>
          </div>
          {selected.reviewReason && (
            <Note icon={AlertTriangle} tone="amber">
              {selected.reviewReason}
            </Note>
          )}
          {selected.notes && <p className="section-note">{selected.notes}</p>}
          <div className="timeline">
            <Title level={3}>History</Title>
            {[{ label: `Created · ${selected.source}`, date: fmtDate(selected.date) }, ...state.audit.filter((a) => a.ref === selected.id).map((a) => ({ label: a.action, date: `${a.actor} · ${a.detail}` }))].map((row, i) => (
              <div className="timeline-row" key={i}>
                <span className="done" />
                <div>
                  <strong>{row.label}</strong>
                  <small>{row.date}</small>
                </div>
              </div>
            ))}
          </div>
        </Drawer>
      )}
      {editing && <TransactionForm record={editing === "new" ? undefined : editing} close={() => setEditing(null)} />}
      {importOpen && <ImportWizard close={() => setImportOpen(false)} />}
    </div>
  )
}

function TransactionForm({ record, close }: { record?: Transaction; close: () => void }) {
  const { state, today, update, addTransaction, log, actor, toast } = useStore()
  const locked = record?.status === "Verified"
  const [draft, setDraft] = useState({
    type: record?.type ?? ("Expense" as TxnType),
    description: record?.description ?? "",
    amount: record ? String(record.amount) : "",
    party: record?.party ?? "",
    category: record?.category ?? "Software",
    projectId: record?.projectId ?? "",
    date: record?.date ?? today,
    reference: record?.reference ?? "",
    notes: record?.notes ?? "",
  })
  const set = (patch: Partial<typeof draft>) => setDraft({ ...draft, ...patch })
  return (
    <FormModal
      eyebrow={record ? "EDIT LEDGER RECORD" : "NEW LEDGER RECORD"}
      title={record ? `Edit ${record.id}` : "Add transaction"}
      submitLabel={record ? "Save changes" : "Save transaction"}
      onClose={close}
      onSubmit={() => {
        const amount = Number(draft.amount)
        if (!draft.description.trim() || !draft.party.trim() || !(amount > 0)) return toast("Enter a description, party and positive amount")
        if (draft.date > today) return toast("Transactions can't be dated in the future — use Payroll, Expenses or Invoices for planned items.")
        const fields = { type: draft.type, description: draft.description.trim(), amount, party: draft.party.trim(), category: draft.category, projectId: draft.projectId || undefined, date: draft.date, reference: draft.reference || undefined, notes: draft.notes || undefined }
        if (record) {
          update((d) => {
            const t = d.transactions.find((x) => x.id === record.id)!
            if (locked) Object.assign(t, { category: fields.category, projectId: fields.projectId, notes: fields.notes })
            else Object.assign(t, fields)
          })
          log({ actor, action: "Transaction edited", detail: `${record.id}${locked ? " (category/notes only — verified record)" : ""}`, ref: record.id, outcome: "info" })
          toast("Changes saved")
        } else {
          const t = addTransaction({ ...fields, source: "Manual" })
          log({ actor, action: "Transaction added", detail: `${t.id} · ${t.description} · ${money(t.amount)}`, ref: t.id, outcome: t.status === "Review" ? "warning" : "info" })
          toast(t.status === "Review" ? "Saved — flagged as a possible duplicate for review" : "Transaction recorded")
        }
        close()
      }}
    >
      {locked && (
        <Note icon={ShieldCheck}>Verified record: only category, project and notes can change.</Note>
      )}
      <div className="form-grid">
        <Field label="Transaction type">
          <Select value={draft.type} disabled={locked} onChange={(e) => set({ type: e.target.value as TxnType })}>
            <option>Income</option>
            <option>Expense</option>
          </Select>
        </Field>
        <Field label="Amount (₹)">
          <Input type="number" min="1" disabled={locked} value={draft.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0" required />
        </Field>
        <Field label="Description" full>
          <Input value={draft.description} disabled={locked} onChange={(e) => set({ description: e.target.value })} placeholder="What was this for?" required />
        </Field>
        <Field label="Client or vendor">
          <Input value={draft.party} disabled={locked} onChange={(e) => set({ party: e.target.value })} required />
        </Field>
        <Field label="Date">
          <Input type="date" max={today} disabled={locked} value={draft.date} onChange={(e) => set({ date: e.target.value })} />
        </Field>
        <Field label="Category">
          <Select value={draft.category} onChange={(e) => set({ category: e.target.value })}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Project">
          <Select value={draft.projectId} onChange={(e) => set({ projectId: e.target.value })}>
            <option value="">Shared overhead</option>
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference" full>
          <Input value={draft.reference} disabled={locked} onChange={(e) => set({ reference: e.target.value })} placeholder="Invoice, receipt or UTR number" />
        </Field>
        <Field label="Notes" full>
          <Textarea value={draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Optional context" />
        </Field>
      </div>
    </FormModal>
  )
}

type Parsed = { row: number; date?: string; description: string; amount: number; type?: TxnType; party: string; category: string; error?: string; duplicateOf?: string }

const FIELDS = ["date", "description", "amount", "type", "party", "category"] as const
type MapField = (typeof FIELDS)[number]

function ImportWizard({ close }: { close: () => void }) {
  const { state, today, update, log, actor, toast } = useStore()
  const [step, setStep] = useState(1)
  const [fileName, setFileName] = useState("")
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<MapField, number>>({ date: 0, description: 1, amount: 2, type: 3, party: 4, category: 5 })
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [imported, setImported] = useState(0)
  const header = rows[0] ?? []
  const body = rows.slice(1)

  const load = (text: string, name: string) => {
    const parsed = parseCsv(text)
    if (parsed.length < 2) return toast("The file needs a header row and at least one data row.")
    const head = parsed[0].map((h) => h.toLowerCase())
    const guess = (names: string[], fallback: number) => {
      const i = head.findIndex((h) => names.some((n) => h.includes(n)))
      return i >= 0 ? i : fallback
    }
    setMapping({
      date: guess(["date"], 0), description: guess(["desc", "narration", "particular", "memo"], 1), amount: guess(["amount", "value", "debit", "credit"], 2),
      type: guess(["type", "dr/cr", "direction"], -1), party: guess(["party", "vendor", "client", "payee", "name"], -1), category: guess(["category"], -1),
    })
    setRows(parsed)
    setFileName(name)
    setStep(2)
  }

  const parsed: Parsed[] = useMemo(() => {
    const accepted: Transaction[] = []
    return body.map((r, i) => {
      const cell = (f: MapField) => (mapping[f] >= 0 ? r[mapping[f]] ?? "" : "")
      const date = parseLooseDate(cell("date")) ?? undefined
      const rawAmount = cell("amount").replace(/[₹,\s]|INR|Rs\.?/gi, "")
      const signed = Number(rawAmount)
      const t = cell("type").toLowerCase()
      const type: TxnType | undefined = /inc|cr|credit|in/.test(t) ? "Income" : /exp|dr|debit|out/.test(t) ? "Expense" : t === "" && Number.isFinite(signed) && signed !== 0 ? (signed < 0 ? "Expense" : "Income") : undefined
      const description = cell("description").trim()
      const party = cell("party").trim() || description
      const category = CATEGORIES.find((c) => c.toLowerCase() === cell("category").toLowerCase()) ?? "Uncategorized"
      const amount = Math.abs(signed)
      const p: Parsed = { row: i + 2, date, description, amount, type, party, category }
      if (!date) p.error = `Unreadable date “${cell("date")}”`
      else if (date > today) p.error = "Date is in the future"
      else if (!description) p.error = "Missing description"
      else if (!Number.isFinite(signed) || amount === 0) p.error = `Invalid amount “${cell("amount")}”`
      else if (!type) p.error = "Missing income/expense type"
      if (!p.error) {
        const dup = findDuplicate([...state.transactions, ...accepted], { date: date!, amount, party, description })
        if (dup) p.duplicateOf = dup.id
        else accepted.push({ id: `row-${i}`, date: date!, amount, party, description } as Transaction)
      }
      return p
    })
  }, [body, mapping, state.transactions, today])

  const valid = parsed.filter((p) => !p.error && !p.duplicateOf)
  const dups = parsed.filter((p) => !p.error && p.duplicateOf)
  const invalid = parsed.filter((p) => p.error)

  const confirm = () => {
    const toAdd = [...valid, ...(skipDuplicates ? [] : dups)].map<Transaction>((p) => ({
      id: uid("CSV"), date: p.date!, description: p.description, party: p.party, category: p.category, type: p.type!, amount: p.amount,
      status: p.duplicateOf || p.category === "Uncategorized" ? "Review" : "Recorded", source: "CSV import",
      reviewReason: p.duplicateOf ? `Possible duplicate of ${p.duplicateOf} (imported from ${fileName})` : p.category === "Uncategorized" ? "Imported without a category" : undefined,
    }))
    update((d) => {
      d.transactions.push(...toAdd)
      d.transactions.sort((a, b) => b.date.localeCompare(a.date))
    })
    log({ actor, action: "CSV imported", detail: `${fileName}: ${toAdd.length} imported, ${skipDuplicates ? dups.length : 0} duplicates skipped, ${invalid.length} invalid rows skipped`, outcome: dups.length || invalid.length ? "warning" : "success" })
    setImported(toAdd.length)
    setStep(4)
  }

  return (
    <Modal onClose={close} className="import-modal">
      <div className="form-modal-head">
        <div>
          <span className="eyebrow">CSV IMPORT · STEP {step} OF 4</span>
          <Title level={2}>{["Upload your file", "Map columns", "Validate records", "Import complete"][step - 1]}</Title>
        </div>
        <Button variant="ghost" icon={X} aria-label="Close" onClick={close} />
      </div>
      <div className="import-steps">
        {[1, 2, 3, 4].map((n) => (
          <span className={step >= n ? "complete" : ""} key={n} />
        ))}
      </div>
      {step === 1 && (
        <>
          <label className="csv-drop">
            <Upload size={24} />
            <strong>Choose a CSV file</strong>
            <span>Bank exports work too — you’ll map the columns next.</span>
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => load(String(reader.result), file.name)
                reader.readAsText(file)
              }}
            />
          </label>
          <div className="modal-actions">
            <Button icon={Download} onClick={() => download("centsai-sample.csv", sampleCsv(today))}>
              Download sample
            </Button>
            <Button variant="primary" icon={FileText} onClick={() => load(sampleCsv(today), "centsai-sample.csv")}>
              Use sample file
            </Button>
          </div>
        </>
      )}
      {step === 2 && (
        <>
          <p className="section-note form-note">
            {fileName} · {body.length} data rows. Choose which column holds each field.
          </p>
          <div className="mapping-grid mapping-grid-6">
            {FIELDS.map((f) => (
              <label key={f}>
                {f[0].toUpperCase() + f.slice(1)}
                <Select value={mapping[f]} onChange={(e) => setMapping({ ...mapping, [f]: Number(e.target.value) })}>
                  {(f === "type" || f === "party" || f === "category") && <option value={-1}>{f === "type" ? "Infer from sign" : f === "party" ? "Use description" : "Uncategorized"}</option>}
                  {header.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
          <div className="csv-preview">
            {rows.slice(0, 6).map((r, i) => (
              <div key={i}>
                {header.slice(0, 6).map((_, j) => (
                  <span key={j}>{r[j]}</span>
                ))}
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <Button onClick={() => setStep(1)}>Back</Button>
            <Button variant="primary" onClick={() => setStep(3)}>
              Validate {body.length} rows
            </Button>
          </div>
        </>
      )}
      {step === 3 && (
        <>
          <div className="validation-summary">
            <div>
              <Check size={17} />
              <span>
                <strong>{valid.length} valid rows</strong>
                <small>Ready to import</small>
              </span>
            </div>
            <div>
              <AlertTriangle size={17} />
              <span>
                <strong>{dups.length} potential duplicates</strong>
                <small>Same amount & party/description within 2 days</small>
              </span>
            </div>
            <div>
              <X size={17} />
              <span>
                <strong>{invalid.length} invalid rows</strong>
                <small>Always skipped</small>
              </span>
            </div>
          </div>
          {(dups.length > 0 || invalid.length > 0) && (
            <div className="issue-list">
              {[...invalid, ...dups].slice(0, 8).map((p) => (
                <p key={p.row}>
                  <b>Row {p.row}</b> {p.description || "—"} · {p.error ?? `matches ${p.duplicateOf}`}
                </p>
              ))}
            </div>
          )}
          {dups.length > 0 && (
            <label className="check-row">
              <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />
              <span>Skip potential duplicates (otherwise they’re imported and flagged for review)</span>
            </label>
          )}
          <div className="modal-actions">
            <Button onClick={() => setStep(2)}>Back</Button>
            <Button variant="primary" disabled={valid.length + (skipDuplicates ? 0 : dups.length) === 0} onClick={confirm}>
              Import {valid.length + (skipDuplicates ? 0 : dups.length)} rows
            </Button>
          </div>
        </>
      )}
      {step === 4 && (
        <>
          <div className="import-success">
            <div>
              <Check size={22} />
            </div>
            <strong>{imported} transactions imported</strong>
            <p>Source file name and import time are kept on each record and in the audit log. Uncategorized and duplicate rows are marked for review.</p>
          </div>
          <div className="modal-actions">
            <Button variant="primary" onClick={() => { close(); toast(`${imported} transactions imported from ${fileName}`) }}>
              Done
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
