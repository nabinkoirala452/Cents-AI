import type { Currency } from "@prisma/client"

export type PayPalInvoiceInput = {
  invoiceNumber: string
  currency: Currency
  invoiceDate: string
  dueDate: string
  note?: string
  recipientEmail: string
  recipientName: string
  items: Array<{ name: string; quantity: number; unitPrice: number }>
}

export type PayPalPayment = {
  id: string
  amount: number
  currency: Currency
  occurredAt: string
  status?: string
  fee?: number
  net?: number
}

export type PayPalInvoice = {
  id: string
  number: string
  status: string
  total?: number
  currency?: Currency
  recipientEmail?: string
  payerUrl?: string
  debugId?: string
  payments: PayPalPayment[]
}

export type PayPalCallResult = { debugId?: string }

export type PayPalWebhookHeaders = {
  authAlgo?: string
  certUrl?: string
  transmissionId?: string
  transmissionSignature?: string
  transmissionTime?: string
}

export interface PayPalGateway {
  createDraftInvoice(input: PayPalInvoiceInput): Promise<PayPalInvoice>
  sendInvoice(paypalInvoiceId: string): Promise<PayPalCallResult>
  getInvoice(paypalInvoiceId: string): Promise<PayPalInvoice>
  remindInvoice(paypalInvoiceId: string, note?: string): Promise<PayPalCallResult>
  searchInvoiceByNumber(invoiceNumber: string): Promise<PayPalInvoice | null>
  verifyWebhookSignature(rawBody: string, headers: PayPalWebhookHeaders): Promise<boolean>
}
