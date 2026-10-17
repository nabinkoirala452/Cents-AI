import { config } from "../src/config"
import Fastify from "fastify"
import { RealPayPalGateway } from "../src/integrations/paypal"
import { withPayPalCallLog } from "../src/integrations/paypal/call-log"

if (config.paypalEnv !== "sandbox") {
  throw new Error("Refusing to run PayPal smoke test unless PAYPAL_ENV=sandbox.")
}
if (!config.paypalSandboxPayerEmail) {
  throw new Error("PAYPAL_SANDBOX_PAYER_EMAIL is required for the sandbox smoke invoice recipient.")
}

const gateway = new RealPayPalGateway()
const loggerApp = Fastify({ logger: true })
const now = new Date()
const invoiceNumber = `SMOKE-${now.getTime()}`
const invoiceDate = now.toISOString().slice(0, 10)
const dueDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

try {
  const calls = []
  const sent = await withPayPalCallLog(loggerApp.log, calls, async () => {
    const created = await gateway.createDraftInvoice({
      invoiceNumber,
      currency: "USD",
      invoiceDate,
      dueDate,
      note: "CentsAI sandbox smoke test invoice. No real funds are requested.",
      recipientEmail: config.paypalSandboxPayerEmail!,
      recipientName: "CentsAI Sandbox Smoke Test",
      items: [{ name: "Sandbox smoke test", quantity: 1, unitPrice: 1 }],
    })
    if (!created.id) throw new Error("PayPal did not return an invoice id for the smoke invoice.")
    await gateway.sendInvoice(created.id)
    return gateway.getInvoice(created.id)
  })

  loggerApp.log.info(`invoice_number: ${invoiceNumber}`)
  loggerApp.log.info(`status: ${sent.status}`)
  loggerApp.log.info(`payer_url: ${sent.payerUrl ?? "(not provided)"}`)
} finally {
  await loggerApp.close()
}
