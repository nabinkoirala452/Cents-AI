import { randomUUID } from "node:crypto"
import { RealPayPalGateway } from "./invoicing"
import { recordPayPalApiCall } from "./call-log"
import type { PayPalGateway, PayPalInvoice, PayPalInvoiceInput, PayPalCallResult, PayPalWebhookHeaders } from "./types"

type FailurePoint = "createDraftInvoice" | "sendInvoice" | "getInvoice" | "remindInvoice" | "searchInvoiceByNumber" | "verifyWebhookSignature"

export class FakePayPalGateway implements PayPalGateway {
  readonly invoices = new Map<string, PayPalInvoice>()
  readonly invoiceInputs = new Map<string, PayPalInvoiceInput>()
  readonly rawInvoices = new Map<string, Record<string, unknown>>()
  readonly calls: Array<{ method: FailurePoint; id?: string; invoiceNumber?: string; note?: string }> = []
  private readonly failures = new Map<FailurePoint, Error[]>()
  private webhookSignatureValid = false
  private readonly parser = new RealPayPalGateway(async () => {
    throw new Error("The fake gateway parser does not perform network requests")
  }, () => {})

  failNext(method: FailurePoint, error = new Error(`Injected ${method} failure`)): void {
    const queued = this.failures.get(method) ?? []
    queued.push(error)
    this.failures.set(method, queued)
  }

  setWebhookSignatureValid(valid: boolean): void {
    this.webhookSignatureValid = valid
  }

  markPaid(paypalInvoiceId: string, amount?: number, paymentDate = new Date().toISOString()): void {
    const invoice = this.invoices.get(paypalInvoiceId)
    if (!invoice) throw new Error(`Fake PayPal invoice ${paypalInvoiceId} does not exist`)
    const input = this.invoiceInputs.get(paypalInvoiceId)
    if (!input) throw new Error(`Fake PayPal invoice input ${paypalInvoiceId} is missing`)
    const total = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
    const paid = amount ?? total
    const raw = this.rawInvoices.get(paypalInvoiceId)
    if (!raw) throw new Error(`Fake PayPal invoice response ${paypalInvoiceId} is missing`)
    const payments = raw.payments as { transactions: unknown[] }
    payments.transactions.push({
      payment_id: `PAY-${randomUUID()}`,
      type: "PAYPAL",
      payment_date: paymentDate,
      amount: { currency_code: input.currency, value: paid.toFixed(2) },
    })
    invoice.status = paid >= total ? "PAID" : "PARTIALLY_PAID"
    raw.status = invoice.status
  }

  setInvoiceStatus(paypalInvoiceId: string, status: string): void {
    const invoice = this.invoices.get(paypalInvoiceId)
    if (!invoice) throw new Error(`Fake PayPal invoice ${paypalInvoiceId} does not exist`)
    invoice.status = status
    const raw = this.rawInvoices.get(paypalInvoiceId)
    if (raw) raw.status = status
  }

  setRawInvoice(paypalInvoiceId: string, response: Record<string, unknown>): void {
    this.rawInvoices.set(paypalInvoiceId, structuredClone(response))
    this.invoices.set(paypalInvoiceId, this.parser.parseInvoice(response))
  }

  async createDraftInvoice(input: PayPalInvoiceInput): Promise<PayPalInvoice> {
    this.record("createDraftInvoice", { invoiceNumber: input.invoiceNumber })
    this.maybeFail("createDraftInvoice")
    const existing = [...this.invoices.values()].find((invoice) => invoice.number === input.invoiceNumber)
    if (existing) throw new Error(`Invoice number ${input.invoiceNumber} already exists`)
    const id = `FAKE-${randomUUID()}`
    const rawInvoice: Record<string, unknown> = {
      id,
      status: "DRAFT",
      detail: {
        invoice_number: input.invoiceNumber,
        metadata: { recipient_view_url: `https://fake.paypal.test/invoice/p/#${id}` },
      },
      primary_recipients: [{ billing_info: { email_address: input.recipientEmail } }],
      amount: { currency_code: input.currency, value: input.items
        .reduce((sum, item) => sum + item.quantity * item.unitPrice, 0).toFixed(2) },
      payments: { transactions: [] },
    }
    const invoice = this.parser.parseInvoice(rawInvoice)
    this.invoiceInputs.set(id, structuredClone(input))
    this.rawInvoices.set(id, rawInvoice)
    this.invoices.set(id, invoice)
    return invoice
  }

  async sendInvoice(paypalInvoiceId: string): Promise<PayPalCallResult> {
    this.record("sendInvoice", { id: paypalInvoiceId })
    this.maybeFail("sendInvoice")
    const invoice = this.requireInvoice(paypalInvoiceId)
    invoice.status = "SENT"
    const raw = this.rawInvoices.get(paypalInvoiceId)
    if (raw) raw.status = "SENT"
    return {}
  }

  async getInvoice(paypalInvoiceId: string): Promise<PayPalInvoice> {
    this.record("getInvoice", { id: paypalInvoiceId })
    this.maybeFail("getInvoice")
    this.requireInvoice(paypalInvoiceId)
    const raw = this.rawInvoices.get(paypalInvoiceId)
    if (!raw) throw new Error(`Fake PayPal invoice response ${paypalInvoiceId} is missing`)
    const parsed = this.parser.parseInvoice(raw)
    this.invoices.set(paypalInvoiceId, parsed)
    return structuredClone(parsed)
  }

  async remindInvoice(paypalInvoiceId: string, _note?: string): Promise<PayPalCallResult> {
    this.record("remindInvoice", { id: paypalInvoiceId, note: _note })
    this.maybeFail("remindInvoice")
    this.requireInvoice(paypalInvoiceId)
    return {}
  }

  async searchInvoiceByNumber(invoiceNumber: string): Promise<PayPalInvoice | null> {
    this.record("searchInvoiceByNumber", { invoiceNumber })
    this.maybeFail("searchInvoiceByNumber")
    const invoice = [...this.invoices.values()].find((item) => item.number === invoiceNumber)
    return invoice
      ? {
          id: invoice.id,
          number: invoice.number,
          status: invoice.status,
          payments: [],
        }
      : null
  }

  async verifyWebhookSignature(_rawBody: string, _headers: PayPalWebhookHeaders): Promise<boolean> {
    this.record("verifyWebhookSignature", {})
    this.maybeFail("verifyWebhookSignature")
    return this.webhookSignatureValid
  }

  private requireInvoice(id: string): PayPalInvoice {
    const invoice = this.invoices.get(id)
    if (!invoice) throw new Error(`Fake PayPal invoice ${id} was not found`)
    return invoice
  }

  private record(method: FailurePoint, details: { id?: string; invoiceNumber?: string; note?: string }): void {
    this.calls.push({ method, ...details })
    const paths: Record<FailurePoint, string> = {
      createDraftInvoice: "/v2/invoicing/invoices",
      sendInvoice: `/v2/invoicing/invoices/${encodeURIComponent(details.id ?? "")}/send`,
      getInvoice: `/v2/invoicing/invoices/${encodeURIComponent(details.id ?? "")}`,
      remindInvoice: `/v2/invoicing/invoices/${encodeURIComponent(details.id ?? "")}/remind`,
      searchInvoiceByNumber: "/v2/invoicing/search-invoices",
      verifyWebhookSignature: "/v1/notifications/verify-webhook-signature",
    }
    recordPayPalApiCall({
      method: method === "verifyWebhookSignature" || method === "searchInvoiceByNumber" || method === "createDraftInvoice"
        ? "POST"
        : method === "getInvoice" ? "GET" : "POST",
      path: paths[method],
      status: 200,
      debug_id: null,
    })
  }

  private maybeFail(method: FailurePoint): void {
    const queued = this.failures.get(method)
    const error = queued?.shift()
    if (queued?.length === 0) this.failures.delete(method)
    if (error) throw error
  }
}
