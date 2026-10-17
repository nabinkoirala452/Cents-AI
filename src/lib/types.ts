export type Currency = "USD" | "EUR" | "GBP" | "CAD"
export type Role = "Owner" | "Finance Manager" | "Viewer"
export type Scenario = "expected" | "optimistic" | "conservative"

export type Client = {
  id: string
  name: string
  email: string
  country: string
  currency: Currency
  /** Average days a client pays after the due date, from payment history. */
  avgDelayDays: number
}

export type LineItem = { description: string; quantity: number; unitPrice: number }

export type PayPalStatus = "DRAFT" | "SENT" | "PAID" | "CANCELLED"

export type PayPalLink = {
  invoiceId: string
  status: PayPalStatus
  payerUrl: string
  sentAt?: string
  lastCheckedAt?: string
  /** Sandbox-only helper: the payer completed payment in the sandbox. */
  payerPaid?: boolean
}

export type Reminder = { date: string; channel: string; note: string }

export type Invoice = {
  id: string
  clientId: string
  projectId?: string
  kind: "Milestone" | "Retainer" | "Project"
  issueDate: string
  dueDate: string
  currency: Currency
  lineItems: LineItem[]
  status: "Draft" | "Sent" | "Paid" | "Cancelled"
  channel: "PayPal" | "Bank transfer"
  paidDate?: string
  paypal?: PayPalLink
  reminders: Reminder[]
  /** Owner override for the forecast: expected days late after the due date. */
  expectedDelayOverride?: number
  notes?: string
}

export type TxnType = "Income" | "Expense"
export type TxnStatus = "Recorded" | "Verified" | "Review"

export type Transaction = {
  id: string
  date: string
  description: string
  party: string
  category: string
  projectId?: string
  type: TxnType
  /** Always stored in the workspace currency. */
  amount: number
  status: TxnStatus
  source: "Manual" | "CSV import" | "Invoice payment" | "PayPal" | "Recurring"
  invoiceId?: string
  reference?: string
  notes?: string
  reviewReason?: string
}

export type Employee = {
  id: string
  name: string
  role: string
  monthlySalary: number
  payDay: number
  status: "Active" | "Planned"
  startDate: string
}

export type ContractorBill = {
  id: string
  vendor: string
  projectId?: string
  reference: string
  amount: number
  dueDate: string
  status: "Scheduled" | "Pending" | "Paid"
  paidDate?: string
}

export type RecurringCost = {
  id: string
  vendor: string
  category: "Software" | "Rent" | "Tax" | "Utilities" | "Marketing"
  kind: "Subscription" | "Fixed cost"
  amount: number
  previousAmount?: number
  cycle: "Monthly" | "Annual"
  nextDate: string
  startedOn: string
  status: "Active" | "Review" | "Cancelled"
  reviewed?: boolean
}

export type Loan = {
  id: string
  name: string
  lender: string
  principal: number
  rate: number
  tenureMonths: number
  startDate: string
  emiDay: number
  prepaymentFeePct?: number
}

export type LoanOffer = {
  id: string
  name: string
  principal: number
  rate: number
  months: number
  fees: number
}

export type Project = {
  id: string
  name: string
  clientId: string
  billing: "Fixed" | "Milestone" | "Retainer"
  contractValue: number
  budgetCost: number
  status: "Active" | "Completed"
  timeEntries: { employeeId: string; hours: number }[]
  unassignedHours: number
  retainer?: { amount: number; dayOfMonth: number }
  /** Milestones the owner plans to invoice, by planned invoice date. */
  plannedBillings?: { date: string; amount: number; label: string }[]
}

export type ApprovalKind =
  | "paypal_send_invoice"
  | "send_reminder"
  | "record_contractor_payment"
  | "cancel_subscription"

export type ApprovalStatus = "Pending" | "Rejected" | "Submitted" | "Verified" | "Failed" | "Stale"

export type Approval = {
  id: string
  kind: ApprovalKind
  title: string
  recipient: string
  amount: number
  currency: Currency
  refId: string
  preparedBy: string
  requestedAt: string
  status: ApprovalStatus
  idempotencyKey: string
  steps: string[]
  draft?: string
  decidedBy?: string
  decidedAt?: string
  note?: string
  result?: string
}

export type AuditEvent = {
  id: string
  at: string
  actor: string
  action: string
  detail: string
  ref?: string
  outcome: "info" | "success" | "warning" | "error"
}

export type TeamMember = { name: string; email: string; role: Role }

export type Settings = {
  agencyName: string
  agencyType: string
  teamSize: string
  location: string
  website: string
  ownerName: string
  ownerEmail: string
  currency: Currency
  safetyThreshold: number
  defaultHorizon: 7 | 30 | 90
  planningScenario: Scenario
  managerApprovalLimit: number
  role: Role
  openingBalance: number
  openingDate: string
  notifications: Record<string, boolean>
  team: TeamMember[]
  readiness: boolean[]
}

export type SavedScenario = {
  id: string
  name: string
  createdAt: string
  type: string
  inputs: Record<string, string | number>
}

export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  answer?: import("./copilot").CopilotAnswer
}

export type State = {
  version: number
  seededOn: string
  settings: Settings
  clients: Client[]
  projects: Project[]
  invoices: Invoice[]
  transactions: Transaction[]
  employees: Employee[]
  contractorBills: ContractorBill[]
  recurring: RecurringCost[]
  loans: Loan[]
  offers: LoanOffer[]
  approvals: Approval[]
  audit: AuditEvent[]
  scenarios: SavedScenario[]
  dismissedInsights: string[]
  chat: ChatMessage[]
}
