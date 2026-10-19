// Audit (default) or repair (--repair) PayPal links stored on invoices.
// Audit is read-only: it GETs every stored PayPal invoice id from the sandbox and reports the ones PayPal does not know.
// --repair creates and sends a real sandbox invoice for each unknown one and stores the real id and payer link.
// Paid invoices are repaired too, but only as a link: their status and paid date in CentsAI are left alone.
import { config } from "../src/config"
import { prisma } from "../src/db"
import { RealPayPalGateway } from "../src/integrations/paypal"

if (config.paypalEnv !== "sandbox") throw new Error("Refusing to run unless PAYPAL_ENV=sandbox.")
if (!config.paypalSandboxPayerEmail) throw new Error("PAYPAL_SANDBOX_PAYER_EMAIL is required.")

const repair = process.argv.includes("--repair")
const gateway = new RealPayPalGateway()

const invoices = await prisma.invoice.findMany({
  where: { paypalInvoiceId: { not: null } },
  include: { client: true },
  orderBy: [{ workspaceId: "asc" }, { id: "asc" }],
})

type Row = { id: string; workspaceId: string; paypalId: string; status: string; real: boolean; payerUrl: string | null }
const rows: Row[] = []
for (const invoice of invoices) {
  let real = false
  let payerUrl: string | null = null
  try {
    const found = await gateway.getInvoice(invoice.paypalInvoiceId!)
    real = true
    payerUrl = found.payerUrl ?? null
  } catch {
    real = false
  }
  rows.push({ id: invoice.id, workspaceId: invoice.workspaceId, paypalId: invoice.paypalInvoiceId!, status: invoice.status, real, payerUrl })
}
console.table(rows.map((r) => ({ invoice: r.id, status: r.status, paypalId: r.paypalId, existsInPayPal: r.real, storedUrlMatches: r.real && r.payerUrl !== null })))

if (repair) {
  for (const row of rows.filter((r) => !r.real)) {
    const invoice = invoices.find((i) => i.workspaceId === row.workspaceId && i.id === row.id)!
    const number = `${invoice.id}-${invoice.workspaceId.slice(0, 6)}-${Date.now().toString(36)}`
    const items = (invoice.lineItems as Array<{ description: string; quantity: number; unitPrice: number }>)
    const created = await gateway.createDraftInvoice({
      invoiceNumber: number,
      currency: invoice.currency,
      invoiceDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      recipientEmail: config.paypalSandboxPayerEmail!,
      recipientName: invoice.client.name,
      ...(invoice.notes ? { note: invoice.notes } : {}),
      items: items.map((item) => ({ name: item.description, quantity: item.quantity, unitPrice: item.unitPrice })),
    })
    await gateway.sendInvoice(created.id)
    const sent = await gateway.getInvoice(created.id)
    if (!sent.payerUrl) throw new Error(`PayPal gave no payer link for ${invoice.id} (${created.id})`)
    await prisma.invoice.update({
      where: { workspaceId_id: { workspaceId: invoice.workspaceId, id: invoice.id } },
      data: { paypalInvoiceId: created.id, paypalInvoiceNumber: number, paypalPayerUrl: sent.payerUrl },
    })
    console.log(`${invoice.id}: ${row.paypalId} -> ${created.id} (${sent.status})  ${sent.payerUrl}`)
  }
}

await prisma.$disconnect()
