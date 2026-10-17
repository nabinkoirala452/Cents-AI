/**
 * PayPal Sandbox adapter — frontend simulation.
 *
 * The UI talks only to this interface. When the backend is ready, each method
 * becomes a call to our server, which holds the PayPal credentials and calls
 * the Invoicing v2 API:
 *   createAndSend → POST /v2/invoicing/invoices + POST /v2/invoicing/invoices/{id}/send
 *   getStatus     → GET  /v2/invoicing/invoices/{id}
 *   remind        → POST /v2/invoicing/invoices/{id}/remind
 * Credentials never reach the browser.
 */
import type { Client, Invoice, PayPalLink, PayPalStatus } from "./types"

export const PAYPAL_MODE = "Sandbox (simulated in frontend)"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const segment = () => Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, "X")

export const paypalEligibility = (invoice: Invoice, client: Client): { ok: boolean; reason: string } => {
  if (invoice.channel !== "PayPal")
    return { ok: false, reason: "This invoice is set for bank transfer and must be recorded manually after payment." }
  if (!client.email) return { ok: false, reason: "The client has no billing email address." }
  if (invoice.lineItems.length === 0) return { ok: false, reason: "The invoice has no line items." }
  if (!["USD", "EUR", "GBP", "CAD"].includes(invoice.currency))
    return { ok: false, reason: `PayPal does not support ${invoice.currency} invoicing.` }
  return { ok: true, reason: "Eligible for PayPal invoicing in Sandbox." }
}

export const paypalSandbox = {
  async createAndSend(invoice: Invoice): Promise<PayPalLink> {
    await wait(700)
    const id = `INV2-${segment()}-${segment()}-${segment()}-${segment()}`
    const now = new Date().toISOString()
    void invoice
    return { invoiceId: id, status: "SENT", payerUrl: `https://www.sandbox.paypal.com/invoice/p/#${id}`, sentAt: now, lastCheckedAt: now }
  },

  async getStatus(link: PayPalLink): Promise<PayPalStatus> {
    await wait(600)
    if (link.status === "CANCELLED") return "CANCELLED"
    return link.payerPaid ? "PAID" : link.status === "DRAFT" ? "DRAFT" : "SENT"
  },

  async remind(link: PayPalLink): Promise<{ ok: boolean }> {
    await wait(500)
    return { ok: link.status === "SENT" }
  },
}
