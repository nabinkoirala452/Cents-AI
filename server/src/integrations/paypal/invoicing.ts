import type { Currency } from "@prisma/client"
import { config } from "../../config"
import type {
  PayPalCallResult,
  PayPalGateway,
  PayPalInvoice,
  PayPalInvoiceInput,
  PayPalPayment,
  PayPalWebhookHeaders,
} from "./types"
import { recordPayPalApiCall } from "./call-log"

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly debugId?: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = "PayPalError"
  }
}

type PayPalLogger = (call: { method: string; path: string; status: number | null; debug_id: string | null }) => void

type TokenResponse = { access_token: string; expires_in: number }
type PayPalResponse = Record<string, unknown>
export type PayPalApiCall = { method: string; path: string; status: number | null; debug_id: string | null }

export class RealPayPalGateway implements PayPalGateway {
  private accessToken: string | undefined
  private tokenExpiresAt = 0
  private tokenRequest: Promise<string> | undefined

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly logger: PayPalLogger = recordPayPalApiCall,
  ) {}

  async createDraftInvoice(input: PayPalInvoiceInput): Promise<PayPalInvoice> {
    const body = {
      detail: {
        invoice_number: input.invoiceNumber,
        currency_code: input.currency,
        invoice_date: input.invoiceDate,
        payment_term: { due_date: input.dueDate },
        ...(input.note ? { note: input.note } : {}),
      },
      primary_recipients: [{
        billing_info: {
          email_address: input.recipientEmail,
          name: { full_name: input.recipientName },
        },
      }],
      items: input.items.map((item) => ({
        name: item.name,
        quantity: String(item.quantity),
        unit_amount: { currency_code: input.currency, value: item.unitPrice.toFixed(2) },
      })),
    }
    const response = await this.request("POST", "/v2/invoicing/invoices", body, false, {
      Prefer: "return=representation",
    })
    const created = this.parseInvoice(response)
    if (created.id) return created

    const linkId = this.invoiceIdFromSelfLink(response)
    if (linkId) return { ...created, id: linkId }

    const recovered = await this.searchInvoiceByNumber(input.invoiceNumber)
    if (recovered?.id) return recovered
    throw new PayPalError("PayPal created an invoice without returning an id, and the invoice could not be found")
  }

  async sendInvoice(paypalInvoiceId: string): Promise<PayPalCallResult> {
    const response = await this.request(
      "POST",
      `/v2/invoicing/invoices/${encodeURIComponent(paypalInvoiceId)}/send`,
      {},
    )
    return { ...(this.debugId(response) ? { debugId: this.debugId(response) } : {}) }
  }

  async getInvoice(paypalInvoiceId: string): Promise<PayPalInvoice> {
    return this.parseInvoice(await this.request(
      "GET",
      `/v2/invoicing/invoices/${encodeURIComponent(paypalInvoiceId)}`,
      undefined,
      true,
    ))
  }

  async remindInvoice(paypalInvoiceId: string, note?: string): Promise<PayPalCallResult> {
    const response = await this.request(
      "POST",
      `/v2/invoicing/invoices/${encodeURIComponent(paypalInvoiceId)}/remind`,
      note ? { subject: "Payment reminder", note } : {},
      true,
    )
    return { ...(this.debugId(response) ? { debugId: this.debugId(response) } : {}) }
  }

  async searchInvoiceByNumber(invoiceNumber: string): Promise<PayPalInvoice | null> {
    const response = await this.request("POST", "/v2/invoicing/search-invoices", {
      fields: ["detail", "amount", "primary_recipients"],
      page: 1,
      page_size: 20,
      total_required: true,
      invoice_number: invoiceNumber,
    })
    const items = Array.isArray(response.items) ? response.items : []
    const found = items.find((item) => {
      if (!item || typeof item !== "object") return false
      const detail = (item as PayPalResponse).detail
      return !!detail && typeof detail === "object"
        && (detail as PayPalResponse).invoice_number === invoiceNumber
    })
    return found && typeof found === "object" ? this.parseInvoice(found as PayPalResponse) : null
  }

  async verifyWebhookSignature(rawBody: string, headers: PayPalWebhookHeaders): Promise<boolean> {
    if (!config.paypalWebhookId) throw new Error("PAYPAL_WEBHOOK_ID is required to verify PayPal webhooks")
    const requestBody = `{"auth_algo":${JSON.stringify(headers.authAlgo ?? "")},"cert_url":${JSON.stringify(headers.certUrl ?? "")},"transmission_id":${JSON.stringify(headers.transmissionId ?? "")},"transmission_sig":${JSON.stringify(headers.transmissionSignature ?? "")},"transmission_time":${JSON.stringify(headers.transmissionTime ?? "")},"webhook_id":${JSON.stringify(config.paypalWebhookId)},"webhook_event":${rawBody}}`
    const response = await this.request(
      "POST",
      "/v1/notifications/verify-webhook-signature",
      requestBody,
      false,
      {},
      true,
    )
    return response.verification_status === "SUCCESS"
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    retryable = false,
    additionalHeaders: Record<string, string> = {},
    rawBody = false,
  ): Promise<PayPalResponse> {
    let retryCount = 0
    let unauthorizedRetried = false
    while (true) {
      try {
        const token = await this.getAccessToken()
        const response = await this.fetcher(`${config.paypalBaseUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/json",
            ...(body === undefined || rawBody ? {} : { "content-type": "application/json" }),
            ...(rawBody ? { "content-type": "application/json" } : {}),
            ...additionalHeaders,
          },
          ...(body === undefined ? {} : { body: rawBody ? String(body) : JSON.stringify(body) }),
        })
        const debugId = response.headers.get("paypal-debug-id")
        this.logger({ method, path, status: response.status, debug_id: debugId })
        const text = await response.text()
        const payload = this.parseResponse(text)
        if (!response.ok) {
          const error = new PayPalError(
            `PayPal ${method} ${path} failed with HTTP ${response.status}`,
            debugId ?? this.debugId(payload),
            response.status,
          )
          if (response.status === 401 && !unauthorizedRetried) {
            this.accessToken = undefined
            this.tokenExpiresAt = 0
            unauthorizedRetried = true
            continue
          }
          if (retryable && (response.status === 429 || response.status >= 500) && retryCount < 2) {
            await this.backoff(retryCount)
            retryCount += 1
            continue
          }
          throw error
        }
        return payload
      } catch (error) {
        if (error instanceof PayPalError) throw error
        this.logger({ method, path, status: null, debug_id: null })
        if (!retryable || retryCount >= 2) {
          throw new PayPalError(`PayPal ${method} ${path} failed due to a network error`)
        }
        await this.backoff(retryCount)
        retryCount += 1
      }
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) return this.accessToken
    if (this.tokenRequest) return this.tokenRequest
    this.tokenRequest = this.fetchAccessToken()
    try {
      return await this.tokenRequest
    } finally {
      this.tokenRequest = undefined
    }
  }

  private async fetchAccessToken(): Promise<string> {
    const clientId = config.paypalClientId
    const clientSecret = config.paypalClientSecret
    if (!clientId || !clientSecret) throw new Error("PayPal client credentials are not configured")
    const path = "/v1/oauth2/token"
    let response: Response
    try {
      response = await this.fetcher(`${config.paypalBaseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: "grant_type=client_credentials",
      })
    } catch {
      this.logger({ method: "POST", path, status: null, debug_id: null })
      throw new PayPalError("PayPal OAuth request failed due to a network error")
    }
    const debugId = response.headers.get("paypal-debug-id")
    this.logger({ method: "POST", path, status: response.status, debug_id: debugId })
    const payload = this.parseResponse(await response.text())
    if (!response.ok) {
      throw new PayPalError(`PayPal OAuth failed with HTTP ${response.status}`, debugId ?? undefined, response.status)
    }
    const token = payload as TokenResponse
    if (typeof token.access_token !== "string" || !Number.isFinite(token.expires_in)) {
      throw new PayPalError("PayPal OAuth response was invalid", debugId ?? undefined, response.status)
    }
    this.accessToken = token.access_token
    this.tokenExpiresAt = Date.now() + token.expires_in * 1000
    return token.access_token
  }

  private async backoff(attempt: number): Promise<void> {
    const base = 150 * (2 ** attempt)
    await new Promise((resolve) => setTimeout(resolve, base + Math.floor(Math.random() * base)))
  }

  parseInvoice(value: PayPalResponse): PayPalInvoice {
    const detail = typeof value.detail === "object" && value.detail !== null
      ? value.detail as PayPalResponse
      : {}
    const metadata = typeof detail.metadata === "object" && detail.metadata !== null
      ? detail.metadata as PayPalResponse
      : {}
    const recipients = Array.isArray(value.primary_recipients) ? value.primary_recipients : []
    const recipient = recipients.find((item) => !!item && typeof item === "object") as PayPalResponse | undefined
    const billing = recipient?.billing_info && typeof recipient.billing_info === "object"
      ? recipient.billing_info as PayPalResponse
      : {}
    const amount = value.amount && typeof value.amount === "object"
      ? value.amount as PayPalResponse
      : {}
    const currency = amount.currency_code
    const total = typeof amount.value === "string" || typeof amount.value === "number"
      ? Number(amount.value)
      : undefined
    const links = Array.isArray(value.links) ? value.links : []
    const payerUrl = links.find((link) =>
      !!link && typeof link === "object" && (link as PayPalResponse).rel === "payer-view",
    )
    const paymentsContainer = value.payments
    const rawPayments = paymentsContainer && typeof paymentsContainer === "object"
        && Array.isArray((paymentsContainer as PayPalResponse).transactions)
        ? (paymentsContainer as PayPalResponse).transactions as unknown[]
        : Array.isArray(value.payment_records) ? value.payment_records : []
    return {
      id: String(value.id ?? ""),
      number: String(detail.invoice_number ?? ""),
      status: String(value.status ?? ""),
      ...(typeof total === "number" && Number.isFinite(total) ? { total } : {}),
      ...(typeof currency === "string" && ["USD", "EUR", "GBP", "CAD"].includes(currency)
        ? { currency: currency as Currency }
        : {}),
      ...(typeof billing.email_address === "string" ? { recipientEmail: billing.email_address } : {}),
      ...(typeof metadata.recipient_view_url === "string"
        ? { payerUrl: metadata.recipient_view_url }
        : payerUrl && typeof payerUrl === "object" && typeof (payerUrl as PayPalResponse).href === "string"
          ? { payerUrl: (payerUrl as PayPalResponse).href as string }
        : {}),
      ...(this.debugId(value) ? { debugId: this.debugId(value) } : {}),
      payments: rawPayments.map((payment) => this.parsePayment(payment)).filter((payment): payment is PayPalPayment => payment !== null),
    }
  }

  private parsePayment(value: unknown): PayPalPayment | null {
    if (!value || typeof value !== "object") return null
    const payment = value as PayPalResponse
    if (payment.type !== "PAYPAL") return null
    const amount = payment.amount as PayPalResponse | undefined
    const id = payment.payment_id
    const numericAmount = typeof amount?.value === "string" || typeof amount?.value === "number"
      ? Number(amount.value)
      : NaN
    const currency = amount?.currency_code
    const occurredAt = payment.payment_date
    if (
      typeof id !== "string"
      || !Number.isFinite(numericAmount)
      || numericAmount <= 0
      || typeof currency !== "string"
      || !["USD", "EUR", "GBP", "CAD"].includes(currency)
      || typeof occurredAt !== "string"
    ) return null
    return {
      id,
      amount: numericAmount,
      currency: currency as Currency,
      occurredAt,
      status: "PAID",
    }
  }

  private invoiceIdFromSelfLink(value: PayPalResponse): string | undefined {
    if (!Array.isArray(value.links)) return undefined
    const self = value.links.find((item) =>
      !!item && typeof item === "object" && (item as PayPalResponse).rel === "self",
    ) as PayPalResponse | undefined
    if (typeof self?.href !== "string") return undefined
    const lastSegment = new URL(self.href).pathname.split("/").filter(Boolean).at(-1)
    return lastSegment ? decodeURIComponent(lastSegment) : undefined
  }

  private debugId(value: unknown): string | undefined {
    if (!value || typeof value !== "object") return undefined
    const response = value as PayPalResponse
    return typeof response.debug_id === "string" ? response.debug_id : undefined
  }

  private parseResponse(text: string): PayPalResponse {
    if (!text) return {}
    try {
      const value: unknown = JSON.parse(text)
      return value && typeof value === "object" ? value as PayPalResponse : {}
    } catch {
      return {}
    }
  }
}
