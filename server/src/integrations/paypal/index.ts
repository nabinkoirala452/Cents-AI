import { config } from "../../config"
import { FakePayPalGateway } from "./fake"
import { RealPayPalGateway } from "./invoicing"
import type { PayPalGateway } from "./types"

const fakeGateway = new FakePayPalGateway()
const realGateway = new RealPayPalGateway()
let overrideGateway: PayPalGateway | undefined

export function getPayPalGateway(): PayPalGateway {
  if (overrideGateway) return overrideGateway
  return config.paypalMode === "fake" ? fakeGateway : realGateway
}

export function setPayPalGatewayForTests(gateway: PayPalGateway | undefined): void {
  overrideGateway = gateway
}

export { FakePayPalGateway } from "./fake"
export { PayPalError, RealPayPalGateway } from "./invoicing"
export type {
  PayPalCallResult,
  PayPalGateway,
  PayPalInvoice,
  PayPalInvoiceInput,
  PayPalPayment,
  PayPalWebhookHeaders,
} from "./types"
