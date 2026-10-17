import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { requireContext } from "../../plugins/auth"
import { currentDate } from "./service"
import {
  addProjectTimeEntry,
  createClient,
  createContractorBill,
  createEmployee,
  createInvoice,
  createLoan,
  createOffer,
  createProject,
  createRecurringCost,
  createScenario,
  createTransaction,
  deleteEmployee,
  deleteInvoice,
  deleteOffer,
  deleteScenario,
  deleteTransaction,
  importTransactions,
  issueBankTransferInvoice,
  patchClient,
  patchContractorBill,
  patchEmployee,
  patchInvoice,
  patchLoan,
  patchProject,
  patchRecurringCost,
  patchTransaction,
  readComputedState,
  resetDemoWorkspace,
  reviewRecurringCost,
} from "./service"
import {
  buildBriefing,
  forecastAll,
  monthToDate,
} from "../../../../src/lib/finance"

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}, "Expected a valid ISO calendar date")
const amountHasCentsPrecision = (value: number) =>
  Math.abs(value * 100 - Math.round(value * 100)) < 0.000001
const positiveMoney = z.number().finite().positive().max(999_999_999_999.99).refine(amountHasCentsPrecision)
const nonnegativeMoney = z.number().finite().nonnegative().max(999_999_999_999.99).refine(amountHasCentsPrecision)
const string = (max = 500) => z.string().trim().min(1).max(max)
const optionalString = (max = 500) => z.string().trim().max(max).optional()
const projectId = string(100).optional()
const lineItems = z.array(z.object({
  description: string(300),
  quantity: z.number().finite().positive().max(1_000_000),
  unitPrice: nonnegativeMoney,
}).strict()).min(1).max(100)
const retainer = z.object({
  amount: positiveMoney,
  dayOfMonth: z.number().int().min(1).max(31),
}).strict()
const plannedBillings = z.array(z.object({
  date: isoDate,
  amount: positiveMoney,
  label: string(200),
}).strict()).max(100)

const transactionCreate = z.object({
  date: isoDate,
  description: string(500),
  party: string(200),
  category: string(100),
  projectId,
  type: z.enum(["Income", "Expense"]),
  amount: positiveMoney,
  reference: optionalString(200),
  notes: optionalString(2000),
}).strict()

const transactionPatch = transactionCreate.partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  "At least one transaction field is required",
)

const importBody = z.object({
  fileName: string(255),
  rows: z.array(z.unknown()).max(5000),
}).strict()

const clientCreate = z.object({
  name: string(200),
  email: z.string().trim().email().max(320),
  country: string(100),
  currency: z.enum(["USD", "EUR", "GBP", "CAD"]).optional(),
  avgDelayDays: z.number().int().min(0).max(3650),
}).strict()
const clientPatch = clientCreate.partial().strict().refine((value) => Object.keys(value).length > 0)

const projectFields = {
  name: string(200),
  clientId: string(100),
  billing: z.enum(["Fixed", "Milestone", "Retainer"]),
  contractValue: nonnegativeMoney,
  budgetCost: nonnegativeMoney,
  status: z.enum(["Active", "Completed"]),
  timeEntries: z.array(z.object({
    employeeId: string(100),
    hours: z.number().finite().nonnegative().max(1_000_000),
  }).strict()).max(1000),
  unassignedHours: z.number().finite().nonnegative().max(1_000_000),
  retainer: retainer.optional(),
  plannedBillings: plannedBillings.optional(),
}
const projectCreate = z.object(projectFields).strict()
const projectPatch = z.object(projectFields).partial().strict().refine((value) => Object.keys(value).length > 0)
const timeEntryBody = z.object({
  employeeId: string(100),
  hours: z.number().finite().positive().max(1_000_000),
}).strict()

const invoiceCreate = z.object({
  clientId: string(100),
  projectId,
  kind: z.enum(["Milestone", "Retainer", "Project"]),
  issueDate: isoDate,
  dueDate: isoDate,
  lineItems,
  channel: z.enum(["PayPal", "Bank transfer"]).optional(),
  notes: optionalString(2000),
}).strict().refine((value) => value.dueDate >= value.issueDate, {
  message: "dueDate must be on or after issueDate",
  path: ["dueDate"],
})
const invoicePatch = z.object({
  clientId: string(100).optional(),
  projectId,
  kind: z.enum(["Milestone", "Retainer", "Project"]).optional(),
  issueDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  lineItems: lineItems.optional(),
  channel: z.enum(["PayPal", "Bank transfer"]).optional(),
  expectedDelayOverride: z.number().int().nonnegative().max(3650).optional(),
  notes: optionalString(2000),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one invoice field is required")

const employeeCreate = z.object({
  name: string(200),
  role: string(200),
  monthlySalary: nonnegativeMoney,
  payDay: z.number().int().min(1).max(31),
  status: z.enum(["Active", "Planned"]),
  startDate: isoDate,
}).strict()
const employeePatch = employeeCreate.partial().strict().refine((value) => Object.keys(value).length > 0)

const contractorBillCreate = z.object({
  vendor: string(200),
  projectId,
  reference: string(200),
  amount: positiveMoney,
  dueDate: isoDate,
  status: z.enum(["Scheduled", "Pending", "Paid"]),
  paidDate: isoDate.optional(),
}).strict()
const contractorBillPatch = contractorBillCreate.partial().strict().refine((value) => Object.keys(value).length > 0)

const recurringFields = {
  vendor: string(200),
  category: z.enum(["Software", "Rent", "Tax", "Utilities", "Marketing"]),
  kind: z.enum(["Subscription", "Fixed cost"]),
  amount: positiveMoney,
  previousAmount: nonnegativeMoney.optional(),
  cycle: z.enum(["Monthly", "Annual"]),
  nextDate: isoDate,
  startedOn: isoDate,
  status: z.enum(["Active", "Review", "Cancelled"]),
  reviewed: z.boolean().optional(),
}
const recurringCreate = z.object(recurringFields).strict()
const recurringPatch = z.object(recurringFields).partial().strict().refine((value) => Object.keys(value).length > 0)

const loanFields = {
  name: string(200),
  lender: string(200),
  principal: positiveMoney,
  rate: z.number().finite().min(0).max(100),
  tenureMonths: z.number().int().min(1).max(1200),
  startDate: isoDate,
  emiDay: z.number().int().min(1).max(31),
  prepaymentFeePct: z.number().finite().min(0).max(100).optional(),
}
const loanCreate = z.object(loanFields).strict()
const loanPatch = z.object(loanFields).partial().strict().refine((value) => Object.keys(value).length > 0)

const offerCreate = z.object({
  name: string(200),
  principal: positiveMoney,
  rate: z.number().finite().min(0).max(100),
  months: z.number().int().min(1).max(1200),
  fees: nonnegativeMoney,
}).strict()
const scenarioCreate = z.object({
  name: string(200),
  type: string(100),
  inputs: z.record(z.union([z.string().max(1000), z.number().finite()])),
}).strict()
const idParams = z.object({ id: string(100) }).strict()
const noBody = z.union([z.object({}).strict(), z.null()]).optional()
const horizonQuery = z.object({
  horizon: z.coerce.number().int().refine((value) => [7, 30, 90, 120].includes(value)).optional(),
}).strict()
const forecastQuery = horizonQuery.extend({
  scenario: z.enum(["expected", "conservative", "optimistic"]).optional(),
})

function routeId(params: unknown) {
  return idParams.parse(params).id
}

export function registerRecordRoutes(app: FastifyInstance): void {
  app.post("/api/v1/transactions", { schema: { body: transactionCreate } }, async (request) =>
    createTransaction(requireContext(request), transactionCreate.parse(request.body)),
  )
  app.patch("/api/v1/transactions/:id", {
    schema: { params: idParams, body: transactionPatch },
  }, async (request) =>
    patchTransaction(
      requireContext(request),
      routeId(request.params),
      transactionPatch.parse(request.body),
    ),
  )
  app.delete("/api/v1/transactions/:id", { schema: { params: idParams, body: noBody } }, async (request) =>
    deleteTransaction(requireContext(request), routeId(request.params)),
  )
  app.post("/api/v1/transactions/import", {
    schema: {
      body: importBody,
      querystring: z.object({ skipDuplicates: z.enum(["true", "false"]).default("true") }).strict(),
    },
  }, async (request) => {
    const body = importBody.parse(request.body)
    const query = z.object({ skipDuplicates: z.enum(["true", "false"]).default("true") }).strict().parse(request.query)
    return importTransactions(requireContext(request), body.fileName, body.rows, query.skipDuplicates === "true")
  })

  app.post("/api/v1/clients", { schema: { body: clientCreate } }, async (request) =>
    createClient(requireContext(request), clientCreate.parse(request.body)),
  )
  app.patch("/api/v1/clients/:id", { schema: { params: idParams, body: clientPatch } }, async (request) =>
    patchClient(requireContext(request), routeId(request.params), clientPatch.parse(request.body)),
  )

  app.post("/api/v1/projects", { schema: { body: projectCreate } }, async (request) =>
    createProject(requireContext(request), projectCreate.parse(request.body)),
  )
  app.patch("/api/v1/projects/:id", { schema: { params: idParams, body: projectPatch } }, async (request) =>
    patchProject(requireContext(request), routeId(request.params), projectPatch.parse(request.body)),
  )
  app.post("/api/v1/projects/:id/time-entries", {
    schema: { params: idParams, body: timeEntryBody },
  }, async (request) =>
    addProjectTimeEntry(requireContext(request), routeId(request.params), timeEntryBody.parse(request.body)),
  )

  app.post("/api/v1/invoices", { schema: { body: invoiceCreate } }, async (request) =>
    createInvoice(requireContext(request), invoiceCreate.parse(request.body)),
  )
  app.patch("/api/v1/invoices/:id", { schema: { params: idParams, body: invoicePatch } }, async (request) =>
    patchInvoice(requireContext(request), routeId(request.params), invoicePatch.parse(request.body)),
  )
  app.delete("/api/v1/invoices/:id", { schema: { params: idParams, body: noBody } }, async (request) =>
    deleteInvoice(requireContext(request), routeId(request.params)),
  )
  app.post("/api/v1/invoices/:id/issue", {
    schema: { params: idParams, body: noBody },
  }, async (request) =>
    issueBankTransferInvoice(requireContext(request), routeId(request.params)),
  )

  app.post("/api/v1/employees", { schema: { body: employeeCreate } }, async (request) =>
    createEmployee(requireContext(request), employeeCreate.parse(request.body)),
  )
  app.patch("/api/v1/employees/:id", { schema: { params: idParams, body: employeePatch } }, async (request) =>
    patchEmployee(requireContext(request), routeId(request.params), employeePatch.parse(request.body)),
  )
  app.delete("/api/v1/employees/:id", { schema: { params: idParams, body: noBody } }, async (request) =>
    deleteEmployee(requireContext(request), routeId(request.params)),
  )

  app.post("/api/v1/contractor-bills", { schema: { body: contractorBillCreate } }, async (request) =>
    createContractorBill(requireContext(request), contractorBillCreate.parse(request.body)),
  )
  app.patch("/api/v1/contractor-bills/:id", { schema: { params: idParams, body: contractorBillPatch } }, async (request) =>
    patchContractorBill(requireContext(request), routeId(request.params), contractorBillPatch.parse(request.body)),
  )

  app.post("/api/v1/recurring-costs", { schema: { body: recurringCreate } }, async (request) =>
    createRecurringCost(requireContext(request), recurringCreate.parse(request.body)),
  )
  app.patch("/api/v1/recurring-costs/:id", { schema: { params: idParams, body: recurringPatch } }, async (request) =>
    patchRecurringCost(requireContext(request), routeId(request.params), recurringPatch.parse(request.body)),
  )
  app.post("/api/v1/recurring-costs/:id/review", {
    schema: { params: idParams, body: noBody },
  }, async (request) =>
    reviewRecurringCost(requireContext(request), routeId(request.params)),
  )

  app.post("/api/v1/loans", { schema: { body: loanCreate } }, async (request) =>
    createLoan(requireContext(request), loanCreate.parse(request.body)),
  )
  app.patch("/api/v1/loans/:id", { schema: { params: idParams, body: loanPatch } }, async (request) =>
    patchLoan(requireContext(request), routeId(request.params), loanPatch.parse(request.body)),
  )

  app.post("/api/v1/financing/offers", { schema: { body: offerCreate } }, async (request) =>
    createOffer(requireContext(request), offerCreate.parse(request.body)),
  )
  app.delete("/api/v1/financing/offers/:id", { schema: { params: idParams, body: noBody } }, async (request) =>
    deleteOffer(requireContext(request), routeId(request.params)),
  )

  app.post("/api/v1/scenarios", { schema: { body: scenarioCreate } }, async (request) =>
    createScenario(requireContext(request), scenarioCreate.parse(request.body)),
  )
  app.delete("/api/v1/scenarios/:id", { schema: { params: idParams, body: noBody } }, async (request) =>
    deleteScenario(requireContext(request), routeId(request.params)),
  )

  app.get("/api/v1/cashflow/forecast", { schema: { querystring: forecastQuery } }, async (request) => {
    const ctx = requireContext(request)
    const state = await readComputedState(ctx)
    const query = forecastQuery.parse(request.query)
    const forecast = forecastAll(state, await currentDate(ctx), query.horizon ?? state.settings.defaultHorizon)
    return query.scenario ? forecast[query.scenario] : forecast
  })
  app.get("/api/v1/dashboard/summary", { schema: { querystring: horizonQuery } }, async (request) => {
    const ctx = requireContext(request)
    const state = await readComputedState(ctx)
    const query = horizonQuery.parse(request.query)
    const today = await currentDate(ctx)
    const briefing = buildBriefing(state, today, query.horizon ?? state.settings.defaultHorizon)
    return {
      cash: briefing.cash,
      monthToDate: monthToDate(state, today),
      receivables: briefing.rec,
      forecast: briefing.all,
      priorities: briefing.priorities,
    }
  })
  app.get("/api/v1/briefing", { schema: { querystring: horizonQuery } }, async (request) => {
    const ctx = requireContext(request)
    const state = await readComputedState(ctx)
    const query = horizonQuery.parse(request.query)
    return buildBriefing(state, await currentDate(ctx), query.horizon ?? state.settings.defaultHorizon)
  })

  app.post("/api/v1/admin/reset-demo", { schema: { body: noBody } }, async (request) =>
    resetDemoWorkspace(requireContext(request)),
  )
}
