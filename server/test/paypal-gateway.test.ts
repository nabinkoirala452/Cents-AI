import { describe, expect, it, vi } from "vitest"
import { FakePayPalGateway, RealPayPalGateway } from "../src/integrations/paypal"

vi.mock("../src/config", () => ({
  config: {
    paypalBaseUrl: "https://api-m.sandbox.paypal.com",
    paypalClientId: "test-client",
    paypalClientSecret: "test-secret",
    paypalWebhookId: "test-webhook-id",
  },
}))

const input = {
  invoiceNumber: "SMOKE-RECOVERY-1",
  currency: "USD" as const,
  invoiceDate: "2026-10-17",
  dueDate: "2026-11-16",
  recipientEmail: "payer@example.test",
  recipientName: "Sandbox Payer",
  items: [{ name: "Smoke test", quantity: 1, unitPrice: 1 }],
}

describe("real PayPal gateway", () => {
  it("refreshes and retries once after an API 401", async () => {
    let tokens = 0
    const apiAuthorization: string[] = []
    const fetcher: typeof fetch = async (url, init) => {
      const path = String(url)
      if (path.endsWith("/v1/oauth2/token")) {
        tokens += 1
        return new Response(JSON.stringify({ access_token: `token-${tokens}`, expires_in: 3600 }), { status: 200 })
      }
      apiAuthorization.push(new Headers(init?.headers).get("authorization") ?? "")
      if (apiAuthorization.length === 1) return new Response("{}", { status: 401 })
      return new Response(JSON.stringify({
        id: "INV2-REFRESHED",
        status: "SENT",
        detail: { invoice_number: input.invoiceNumber },
      }), { status: 200 })
    }
    const gateway = new RealPayPalGateway(fetcher, () => {})

    const invoice = await gateway.getInvoice("INV2-REFRESHED")

    expect(invoice.id).toBe("INV2-REFRESHED")
    expect(tokens).toBe(2)
    expect(apiAuthorization).toEqual(["Bearer token-1", "Bearer token-2"])
  })

  it("preserves the raw webhook event string in signature verification", async () => {
    let verifyRequestBody = ""
    const fetcher: typeof fetch = async (url, init) => {
      if (String(url).endsWith("/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), { status: 200 })
      }
      verifyRequestBody = String(init?.body)
      return new Response(JSON.stringify({ verification_status: "SUCCESS" }), { status: 200 })
    }
    const gateway = new RealPayPalGateway(fetcher, () => {})
    const rawBody = '{ "id": "evt-1", "event_type" : "INVOICING.INVOICE.PAID" }'

    await expect(gateway.verifyWebhookSignature(rawBody, {
      authAlgo: "SHA256withRSA",
      certUrl: "https://paypal.test/cert",
      transmissionId: "tx-1",
      transmissionSignature: "signature",
      transmissionTime: "2026-10-17T00:00:00Z",
    })).resolves.toBe(true)

    expect(verifyRequestBody).toContain(`"webhook_event":${rawBody}}`)
  })

  it("requests invoice representation and parses the complete create response", async () => {
    const calls: Array<{ path: string; headers: Headers }> = []
    const fetcher: typeof fetch = async (url, init) => {
      if (String(url).endsWith("/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), { status: 200 })
      }
      calls.push({ path: String(url), headers: new Headers(init?.headers) })
      return new Response(JSON.stringify({
        id: "INV2-REPRESENTATION",
        status: "DRAFT",
        detail: {
          invoice_number: input.invoiceNumber,
          metadata: { recipient_view_url: "https://paypal.test/payer/representation" },
        },
        primary_recipients: [{ billing_info: { email_address: input.recipientEmail } }],
        amount: { currency_code: "USD", value: "1.00" },
      }), { status: 201 })
    }
    const gateway = new RealPayPalGateway(fetcher, () => {})

    const invoice = await gateway.createDraftInvoice(input)

    expect(invoice).toMatchObject({
      id: "INV2-REPRESENTATION",
      number: input.invoiceNumber,
      total: 1,
      currency: "USD",
      recipientEmail: input.recipientEmail,
      payerUrl: "https://paypal.test/payer/representation",
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].headers.get("prefer")).toBe("return=representation")
  })

  it("takes the invoice ID from a self link before using search", async () => {
    const paths: string[] = []
    const fetcher: typeof fetch = async (url) => {
      const path = String(url)
      paths.push(path)
      if (path.endsWith("/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), { status: 200 })
      }
      return new Response(JSON.stringify({
        links: [{
          href: "https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-LINKED",
          rel: "self",
          method: "GET",
        }],
      }), { status: 201 })
    }
    const gateway = new RealPayPalGateway(fetcher, () => {})

    const invoice = await gateway.createDraftInvoice(input)

    expect(invoice.id).toBe("INV2-LINKED")
    expect(paths.some((path) => path.endsWith("/search-invoices"))).toBe(false)
  })

  it("parses PayPal transaction entries and ignores merchant-entered external payments", async () => {
    const fake = new FakePayPalGateway()
    fake.setRawInvoice("INV2-RAW", {
      id: "INV2-RAW",
      status: "PAID",
      detail: {
        invoice_number: input.invoiceNumber,
        metadata: { recipient_view_url: "https://paypal.test/payer/raw" },
      },
      primary_recipients: [{ billing_info: { email_address: input.recipientEmail } }],
      amount: { currency_code: "USD", value: "100.00" },
      payments: {
        paid_amount: { currency_code: "USD", value: "100.00" },
        transactions: [
          {
            payment_id: "PAYPAL-RECEIPT-1",
            type: "PAYPAL",
            payment_date: "2026-10-17",
            method: "PAYPAL",
            amount: { currency_code: "USD", value: "100.00" },
          },
          {
            payment_id: "EXTERNAL-MANUAL-1",
            type: "EXTERNAL",
            payment_date: "2026-10-17",
            method: "OTHER",
            amount: { currency_code: "USD", value: "100.00" },
          },
        ],
      },
    })

    const invoice = await fake.getInvoice("INV2-RAW")

    expect(invoice.payerUrl).toBe("https://paypal.test/payer/raw")
    expect(invoice.payments).toEqual([{
      id: "PAYPAL-RECEIPT-1",
      amount: 100,
      currency: "USD",
      occurredAt: "2026-10-17",
      status: "PAID",
    }])
  })
})
