import { addDays, dayInMonth, parseISO, todayISO } from "./dates"
import { emiFor } from "./finance"
import type {
  Approval,
  AuditEvent,
  ContractorBill,
  Invoice,
  Loan,
  PayPalLink,
  PayPalStatus,
  RecurringCost,
  State,
  Transaction,
} from "./types"

export const STATE_VERSION = 9

export const NOTIFICATION_KEYS = [
  "Overdue invoice alerts",
  "Upcoming invoice due dates",
  "Cash-flow threshold warnings",
  "Payroll and contractor reminders",
  "Upcoming EMI reminders",
  "Unusual expense alerts",
  "Daily AI Finance Briefing",
  "Weekly financial summaries",
]

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

export function emptyState(): State {
  return {
    version: STATE_VERSION,
    seededOn: todayISO(),
    settings: {
      agencyName: "",
      agencyType: "",
      teamSize: "",
      location: "",
      website: "",
      ownerName: "",
      ownerEmail: "",
      currency: "USD",
      safetyThreshold: 0,
      defaultHorizon: 30,
      planningScenario: "expected",
      managerApprovalLimit: 0,
      role: "Viewer",
      openingBalance: 0,
      openingDate: todayISO(),
      notifications: {},
      team: [],
      readiness: [],
    },
    clients: [],
    projects: [],
    invoices: [],
    transactions: [],
    employees: [],
    contractorBills: [],
    recurring: [],
    loans: [],
    offers: [],
    approvals: [],
    audit: [],
    scenarios: [],
    dismissedInsights: [],
    chat: [],
  }
}

/** Demonstration workspace. Every date is relative to today so the demo never goes stale. */
export function createSeed(): State {
  const T = todayISO()
  const d = (n: number) => addDays(T, n)
  const openingDate = d(-60)
  const payDay = Math.min(28, parseISO(d(4)).getDate())
  const emiDay = Math.min(28, parseISO(d(11)).getDate())

  const clients = [
    { id: "c-acme", name: "Acme Technologies", email: "ap@acme.example", country: "United States", currency: "USD" as const, avgDelayDays: 18 },
    { id: "c-pixel", name: "PixelCraft Studio", email: "finance@pixelcraft.example", country: "United Kingdom", currency: "USD" as const, avgDelayDays: 8 },
    { id: "c-north", name: "Northstar Consulting", email: "accounts@northstar.example", country: "United States", currency: "USD" as const, avgDelayDays: 2 },
    { id: "c-spring", name: "Spring & Co.", email: "billing@springco.example", country: "United States", currency: "USD" as const, avgDelayDays: 0 },
    { id: "c-horizon", name: "Horizon Labs", email: "billing@horizonlabs.example", country: "United States", currency: "USD" as const, avgDelayDays: 5 },
    { id: "c-grey", name: "Greyspace", email: "hello@greyspace.example", country: "Canada", currency: "USD" as const, avgDelayDays: 10 },
  ]

  const employees = [
    { id: "e-ananya", name: "Ananya Sharma", role: "Software Engineer", monthlySalary: 6250 },
    { id: "e-rahul", name: "Rahul Mehta", role: "Backend Developer", monthlySalary: 6900 },
    { id: "e-priya", name: "Priya Nair", role: "Product Designer", monthlySalary: 5000 },
    { id: "e-arjun", name: "Arjun Das", role: "QA Engineer", monthlySalary: 4400 },
    { id: "e-kavya", name: "Kavya Iyer", role: "SEO Specialist", monthlySalary: 3750 },
    { id: "e-rohan", name: "Rohan Gupta", role: "Project Manager", monthlySalary: 6250 },
  ].map((e) => ({ ...e, payDay, status: "Active" as const, startDate: d(-400) }))

  const projects = [
    {
      id: "p-orion", name: "Project Orion", clientId: "c-acme", billing: "Milestone" as const,
      contractValue: 63900, budgetCost: 12500, status: "Active" as const,
      plannedBillings: [{ date: d(12), amount: 15000, label: "Phase 2 kickoff" }, { date: d(45), amount: 15000, label: "Phase 2 delivery" }, { date: d(75), amount: 15000, label: "Phase 3" }],
      timeEntries: [{ employeeId: "e-ananya", hours: 120 }, { employeeId: "e-rahul", hours: 90 }, { employeeId: "e-rohan", hours: 30 }],
      unassignedHours: 14,
    },
    {
      id: "p-web", name: "Website Revamp", clientId: "c-pixel", billing: "Milestone" as const,
      contractValue: 23840, budgetCost: 5600, status: "Active" as const,
      plannedBillings: [{ date: d(25), amount: 7500, label: "Launch milestone" }, { date: d(70), amount: 5000, label: "Care plan setup" }],
      timeEntries: [{ employeeId: "e-priya", hours: 80 }, { employeeId: "e-arjun", hours: 40 }],
      unassignedHours: 0,
    },
    {
      id: "p-seo", name: "SEO Retainer", clientId: "c-spring", billing: "Retainer" as const,
      contractValue: 56250, budgetCost: 17500, status: "Active" as const,
      timeEntries: [{ employeeId: "e-kavya", hours: 140 }],
      unassignedHours: 0,
      retainer: { amount: 9380, dayOfMonth: Math.min(28, parseISO(d(2)).getDate()) },
    },
    {
      id: "p-erp", name: "ERP Integration", clientId: "c-north", billing: "Fixed" as const,
      contractValue: 50000, budgetCost: 8750, status: "Active" as const,
      plannedBillings: [{ date: d(20), amount: 10000, label: "Milestone 3" }, { date: d(50), amount: 10000, label: "Go-live" }, { date: d(80), amount: 10000, label: "Hypercare" }],
      timeEntries: [{ employeeId: "e-rahul", hours: 60 }, { employeeId: "e-ananya", hours: 40 }, { employeeId: "e-arjun", hours: 30 }],
      unassignedHours: 0,
    },
    {
      id: "p-mvp", name: "Mobile MVP", clientId: "c-horizon", billing: "Milestone" as const,
      contractValue: 58600, budgetCost: 18750, status: "Active" as const,
      plannedBillings: [{ date: d(55), amount: 12500, label: "Milestone 3" }, { date: d(85), amount: 12500, label: "Milestone 4" }],
      timeEntries: [{ employeeId: "e-ananya", hours: 50 }, { employeeId: "e-priya", hours: 45 }, { employeeId: "e-rahul", hours: 25 }, { employeeId: "e-rohan", hours: 20 }],
      unassignedHours: 6,
    },
  ]

  const inv = (
    id: string, clientId: string, projectId: string | undefined, kind: Invoice["kind"],
    issueDate: string, dueDate: string, currency: Invoice["currency"], description: string, unitPrice: number,
    status: Invoice["status"], extra: Partial<Invoice> = {},
  ): Invoice => ({
    id, clientId, projectId, kind, issueDate, dueDate, currency,
    lineItems: [{ description, quantity: 1, unitPrice }],
    status, channel: "PayPal", reminders: [], ...extra,
  })

  const pp = (id: string, status: PayPalStatus, sentAt: string): PayPalLink => ({
    invoiceId: id, status, payerUrl: `https://www.sandbox.paypal.com/invoice/p/#${id}`, sentAt: new Date(`${sentAt}T10:30:00`).toISOString(), lastCheckedAt: new Date(`${sentAt}T10:32:00`).toISOString(),
  })

  const invoices: Invoice[] = [
    inv("INV-1030", "c-spring", "p-seo", "Retainer", d(-68), d(-58), "USD", "SEO retainer · monthly", 9380, "Paid", { paidDate: d(-58), channel: "Bank transfer" }),
    inv("INV-1033", "c-grey", undefined, "Project", d(-55), d(-40), "USD", "Brand refresh workshop", 6000, "Paid", { paidDate: d(-40) }),
    inv("INV-1036", "c-horizon", "p-mvp", "Milestone", d(-58), d(-45), "USD", "Discovery sprint", 9450, "Paid", { paidDate: d(-45), paypal: { ...pp("INV2-H7QK-2LMB-9XRA-4TCE", "PAID", d(-58)), payerPaid: true } }),
    inv("INV-1038", "c-north", "p-erp", "Milestone", d(-62), d(-50), "USD", "ERP discovery & solution design", 5000, "Paid", { paidDate: d(-50) }),
    inv("INV-1039", "c-spring", "p-seo", "Retainer", d(-38), d(-28), "USD", "SEO retainer · monthly", 9380, "Paid", { paidDate: d(-29), channel: "Bank transfer" }),
    inv("INV-1041", "c-pixel", "p-web", "Milestone", d(-30), d(-16), "USD", "Website revamp · design milestone", 7560, "Paid", { paidDate: d(-12), paypal: { ...pp("INV2-P3WD-8KZQ-1MNE-7YUA", "PAID", d(-30)), payerPaid: true } }),
    inv("INV-1042", "c-acme", "p-orion", "Milestone", d(-20), d(-5), "USD", "Project Orion · build milestone 2", 6830, "Sent", {
      paypal: pp("INV2-A9LX-4RTE-6QPC-2VNB", "SENT", d(-20)),
      reminders: [{ date: d(-2), channel: "PayPal reminder", note: "Friendly reminder sent after owner approval" }],
    }),
    inv("INV-1044", "c-north", "p-erp", "Milestone", d(-25), d(-10), "USD", "ERP integration · milestone 1", 7500, "Paid", { paidDate: d(-9) }),
    inv("INV-1046", "c-spring", "p-seo", "Retainer", d(-8), d(2), "USD", "SEO retainer · monthly", 9380, "Sent", { channel: "Bank transfer" }),
    inv("INV-1048", "c-pixel", "p-web", "Milestone", d(-16), d(-2), "USD", "Website revamp · build milestone", 3780, "Sent", { paypal: pp("INV2-P8RT-2CXN-5LWQ-3EHJ", "SENT", d(-16)) }),
    inv("INV-1051", "c-north", "p-erp", "Milestone", d(-12), d(3), "USD", "ERP integration · milestone 2", 7500, "Sent"),
    inv("INV-1053", "c-acme", "p-orion", "Milestone", d(-50), d(-35), "USD", "Project Orion · build milestone 1", 12080, "Paid", { paidDate: d(-30), paypal: { ...pp("INV2-A2MC-7HQE-3XKD-8RWP", "PAID", d(-50)), payerPaid: true } }),
    inv("INV-1056", "c-horizon", "p-mvp", "Milestone", d(-2), d(12), "USD", "Mobile MVP · milestone 1", 12080, "Sent", { paypal: pp("INV2-H4ZN-9WQC-5TBA-1LKE", "SENT", d(-2)) }),
    inv("INV-1058", "c-grey", undefined, "Project", d(1), d(16), "USD", "Brand guidelines refresh", 6000, "Draft"),
    inv("INV-1059", "c-horizon", "p-mvp", "Milestone", d(20), d(34), "USD", "Mobile MVP · milestone 2", 12080, "Draft"),
  ]

  const contractorBills: ContractorBill[] = [
    { id: "CB-221", vendor: "Studio North", projectId: "p-orion", reference: "SN-2026-118", amount: 4380, dueDate: d(6), status: "Pending" },
    { id: "CB-218", vendor: "Maya Content Co.", projectId: "p-seo", reference: "MCC-0921", amount: 2250, dueDate: d(9), status: "Scheduled" },
    { id: "CB-214", vendor: "DevOps Works", projectId: "p-orion", reference: "DW-447", amount: 2750, dueDate: d(-5), status: "Paid", paidDate: d(-5) },
    { id: "CB-210", vendor: "Maya Content Co.", projectId: "p-seo", reference: "MCC-0887", amount: 2250, dueDate: d(-27), status: "Paid", paidDate: d(-27) },
  ]

  const recurring: RecurringCost[] = [
    { id: "RC-rent", vendor: "Civic Workspaces · office rent", category: "Rent", kind: "Fixed cost", amount: 4400, cycle: "Monthly", nextDate: d(14), startedOn: d(-700), status: "Active" },
    { id: "RC-gst", vendor: "Payroll tax deposit", category: "Tax", kind: "Fixed cost", amount: 3500, cycle: "Monthly", nextDate: d(3), startedOn: d(-700), status: "Active" },
    { id: "RC-power", vendor: "Electricity & broadband", category: "Utilities", kind: "Fixed cost", amount: 800, cycle: "Monthly", nextDate: d(8), startedOn: d(-700), status: "Active" },
    { id: "RC-aws", vendor: "AWS", category: "Software", kind: "Subscription", amount: 1550, previousAmount: 1150, cycle: "Monthly", nextDate: d(15), startedOn: d(-500), status: "Active" },
    { id: "RC-figma", vendor: "Figma", category: "Software", kind: "Subscription", amount: 1000, previousAmount: 650, cycle: "Monthly", nextDate: d(4), startedOn: d(-500), status: "Review" },
    { id: "RC-gws", vendor: "Google Workspace", category: "Software", kind: "Subscription", amount: 850, previousAmount: 850, cycle: "Monthly", nextDate: d(8), startedOn: d(-700), status: "Active" },
    { id: "RC-notion", vendor: "Notion", category: "Software", kind: "Subscription", amount: 550, previousAmount: 550, cycle: "Monthly", nextDate: d(18), startedOn: d(-400), status: "Active" },
    { id: "RC-ai", vendor: "AI Workspace", category: "Software", kind: "Subscription", amount: 800, cycle: "Monthly", nextDate: d(10), startedOn: d(-20), status: "Review" },
    { id: "RC-cf", vendor: "Cloudflare", category: "Software", kind: "Subscription", amount: 500, previousAmount: 500, cycle: "Monthly", nextDate: d(13), startedOn: d(-300), status: "Active" },
    { id: "RC-atlassian", vendor: "Atlassian (annual)", category: "Software", kind: "Subscription", amount: 5250, previousAmount: 4750, cycle: "Annual", nextDate: d(16), startedOn: d(-700), status: "Active" },
    { id: "RC-adobe", vendor: "Adobe Creative Cloud", category: "Software", kind: "Subscription", amount: 750, previousAmount: 750, cycle: "Monthly", nextDate: d(22), startedOn: d(-300), status: "Active" },
  ]

  const loans: Loan[] = [
    { id: "LN-1", name: "Working Capital Loan", lender: "Pioneer Business Finance", principal: 62500, rate: 12, tenureMonths: 36, startDate: dayInMonth(T, -14, emiDay), emiDay, prepaymentFeePct: 2 },
    { id: "LN-2", name: "Equipment Finance", lender: "Northbridge Capital", principal: 15000, rate: 14, tenureMonths: 24, startDate: dayInMonth(T, -6, emiDay), emiDay },
  ]

  const tx: Transaction[] = []
  let n = 2000
  const add = (t: Omit<Transaction, "id">) => {
    if (t.date >= openingDate && t.date <= T) tx.push({ id: `TXN-${++n}`, ...t })
  }

  for (const i of invoices.filter((x) => x.status === "Paid" && x.paidDate)) {
    const total = i.lineItems.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
    const client = clients.find((c) => c.id === i.clientId)!
    add({
      date: i.paidDate!, description: `Payment · ${i.id}`, party: client.name,
      category: i.kind === "Retainer" ? "Retainer income" : "Project revenue", projectId: i.projectId,
      type: "Income", amount: total, status: "Verified",
      source: i.paypal ? "PayPal" : "Invoice payment", invoiceId: i.id,
      reference: i.paypal ? i.paypal.invoiceId : `ACH-${i.id.slice(4)}`,
    })
  }

  const payroll = employees.reduce((s, e) => s + e.monthlySalary, 0)
  for (let m = -3; m <= 0; m++) {
    add({ date: dayInMonth(T, m, payDay), description: "Monthly salaries", party: `Team payroll (${employees.length})`, category: "Payroll", type: "Expense", amount: payroll, status: "Verified", source: "Recurring" })
    for (const loan of loans) {
      const date = dayInMonth(T, m, loan.emiDay)
      if (date > loan.startDate) add({ date, description: `Loan EMI · ${loan.name}`, party: loan.lender, category: "Debt repayment", type: "Expense", amount: Math.round(emiFor(loan.principal, loan.rate, loan.tenureMonths)), status: "Verified", source: "Recurring" })
    }
  }

  for (const r of recurring.filter((x) => x.cycle === "Monthly")) {
    for (let k = 1; k <= 3; k++) {
      const date = dayInMonth(r.nextDate, -k, parseISO(r.nextDate).getDate())
      if (date < r.startedOn) continue
      const sameMonth = date.slice(0, 7) === T.slice(0, 7)
      add({
        date, description: r.kind === "Subscription" ? `${r.vendor} subscription` : r.vendor, party: r.vendor.split(" · ")[0],
        category: r.category === "Software" ? "Software" : r.category === "Rent" || r.category === "Utilities" ? "Operations" : r.category,
        type: "Expense", amount: sameMonth || !r.previousAmount ? r.amount : r.previousAmount, status: "Recorded", source: "Recurring",
      })
    }
  }

  for (const b of contractorBills.filter((x) => x.status === "Paid")) {
    add({ date: b.paidDate!, description: `Contractor invoice ${b.reference}`, party: b.vendor, category: "Contractors", projectId: b.projectId, type: "Expense", amount: b.amount, status: "Verified", source: "Manual", reference: b.reference })
  }

  const cfDate = dayInMonth(d(13), -1, parseISO(d(13)).getDate())
  add({ date: addDays(cfDate, 1), description: "Cloudflare subscription", party: "Cloudflare", category: "Software", type: "Expense", amount: 4100, status: "Review", source: "CSV import", reviewReason: "Same vendor and amount recorded a day apart" })
  add({ date: d(-14), description: "Client meeting travel · Austin", party: "Southwest Airlines", category: "Travel", type: "Expense", amount: 1050, status: "Recorded", source: "Manual" })
  add({ date: d(-22), description: "LinkedIn campaign", party: "LinkedIn", category: "Marketing", type: "Expense", amount: 1500, status: "Recorded", source: "CSV import" })
  add({ date: d(-35), description: "Laptop accessories", party: "Dell", category: "Equipment", type: "Expense", amount: 850, status: "Recorded", source: "Manual" })
  add({ date: d(-6), description: "Analytics workshop fee", party: "Northstar Consulting", category: "Other income", type: "Income", amount: 1880, status: "Recorded", source: "Manual", projectId: "p-erp" })

  tx.sort((a, b) => b.date.localeCompare(a.date))
  const net = tx.reduce((s, t) => s + (t.type === "Income" ? t.amount : -t.amount), 0)
  const openingBalance = 81250 - net

  const approvals: Approval[] = [
    {
      id: "AP-3104", kind: "send_reminder", title: "Send payment reminder · INV-1042", recipient: "Acme Technologies",
      amount: 6830, currency: "USD", refId: "INV-1042", preparedBy: "CentsAI agent",
      requestedAt: minutesAgo(12), status: "Pending", idempotencyKey: "rem-INV-1042-001",
      steps: ["Send a PayPal reminder for INV2-A9LX-4RTE-6QPC-2VNB", "Log the reminder on the invoice timeline", "Keep the receipt marked uncertain in the forecast"],
      draft: "Hi Acme Technologies team,\n\nA quick reminder that invoice INV-1042 for $6,830 (Project Orion · build milestone 2) was due 5 days ago. You can pay securely through the PayPal link on the invoice.\n\nIf payment is already on its way, please ignore this note — and thank you!\n\nBest regards,\nAlex Kumar\nMeridian Digital Studio",
    },
    {
      id: "AP-3103", kind: "record_contractor_payment", title: "Pay contractor invoice · SN-2026-118", recipient: "Studio North",
      amount: 4380, currency: "USD", refId: "CB-221", preparedBy: "Neha Shah",
      requestedAt: minutesAgo(64), status: "Pending", idempotencyKey: "pay-CB-221-001",
      steps: ["Owner transfers $4,380 from the agency bank account", "Confirm the transfer reference in CentsAI", "Ledger records the expense only after confirmation"],
    },
    {
      id: "AP-3101", kind: "paypal_send_invoice", title: "Send PayPal invoice · INV-1056", recipient: "Horizon Labs",
      amount: 12080, currency: "USD", refId: "INV-1056", preparedBy: "Alex Kumar",
      requestedAt: minutesAgo(60 * 49), status: "Verified", idempotencyKey: "send-INV-1056-001",
      steps: ["Create the invoice in PayPal Sandbox", "Send it to billing@horizonlabs.example", "Verify PayPal reports status SENT"],
      decidedBy: "Alex Kumar", decidedAt: minutesAgo(60 * 48), result: "PayPal status SENT · INV2-H4ZN-9WQC-5TBA-1LKE",
    },
  ]

  const audit: AuditEvent[] = [
    { id: "AU-9", at: minutesAgo(12), actor: "CentsAI agent", action: "Approval requested", detail: "Prepared a payment reminder for INV-1042 (5 days overdue).", ref: "AP-3104", outcome: "info" },
    { id: "AU-8", at: minutesAgo(64), actor: "Neha Shah", action: "Approval requested", detail: "Contractor payment $4,380 to Studio North.", ref: "AP-3103", outcome: "info" },
    { id: "AU-7", at: minutesAgo(60 * 48), actor: "PayPal Sandbox", action: "Status verified", detail: "INV-1056 confirmed as SENT via GET /v2/invoicing/invoices.", ref: "INV-1056", outcome: "success" },
    { id: "AU-6", at: minutesAgo(60 * 48 + 2), actor: "Alex Kumar", action: "Approved & submitted", detail: "Send PayPal invoice INV-1056 ($12,080) to Horizon Labs.", ref: "AP-3101", outcome: "success" },
    { id: "AU-5", at: minutesAgo(60 * 24 * 2 + 300), actor: "Alex Kumar", action: "Reminder sent", detail: "PayPal reminder for INV-1042 after approval.", ref: "INV-1042", outcome: "success" },
    { id: "AU-4", at: minutesAgo(60 * 24 * 12), actor: "PayPal Sandbox", action: "Payment verified", detail: "INV-1041 reported PAID; ledger entry created.", ref: "INV-1041", outcome: "success" },
    { id: "AU-3", at: minutesAgo(60 * 24 * 17), actor: "Alex Kumar", action: "CSV imported", detail: "Bank export · 1 row flagged as a possible duplicate.", outcome: "warning" },
    { id: "AU-2", at: minutesAgo(60 * 24 * 30), actor: "PayPal Sandbox", action: "Payment verified", detail: "INV-1053 reported PAID; ledger entry created.", ref: "INV-1053", outcome: "success" },
  ]

  return {
    version: STATE_VERSION,
    seededOn: T,
    settings: {
      agencyName: "Meridian Digital Studio", agencyType: "Software agency", teamSize: "6–10",
      location: "Austin, TX, USA", website: "https://meridian.example",
      ownerName: "Alex Kumar", ownerEmail: "alex@meridian.example",
      currency: "USD", safetyThreshold: 12500, defaultHorizon: 90,
      planningScenario: "expected", managerApprovalLimit: 6000, role: "Owner",
      openingBalance, openingDate,
      notifications: Object.fromEntries(NOTIFICATION_KEYS.map((k, i) => [k, i < 7])),
      team: [
        { name: "Alex Kumar", email: "alex@meridian.example", role: "Owner" },
        { name: "Neha Shah", email: "neha@meridian.example", role: "Finance Manager" },
        { name: "Mina Rao", email: "mina@meridian.example", role: "Viewer" },
      ],
      readiness: [true, true, true, true, false],
    },
    clients, projects, invoices, transactions: tx, employees, contractorBills, recurring, loans,
    offers: [
      { id: "OF-A", name: "Term loan · Lender A", principal: 62500, rate: 12, months: 36, fees: 1560 },
      { id: "OF-B", name: "Working capital · Lender B", principal: 62500, rate: 10.8, months: 24, fees: 3000 },
      { id: "OF-C", name: "Invoice financing · Lender C", principal: 10630, rate: 18, months: 3, fees: 190 },
    ],
    approvals, audit, scenarios: [], dismissedInsights: [], chat: [],
  }
}
