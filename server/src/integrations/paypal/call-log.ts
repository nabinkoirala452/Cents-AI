import { AsyncLocalStorage } from "node:async_hooks"
import type { FastifyBaseLogger } from "fastify"

export type PayPalApiCall = {
  method: string
  path: string
  status: number | null
  debug_id: string | null
}

type CallLogContext = {
  logger: FastifyBaseLogger
  calls: PayPalApiCall[]
}

const callLog = new AsyncLocalStorage<CallLogContext>()

export function withPayPalCallLog<T>(
  logger: FastifyBaseLogger,
  calls: PayPalApiCall[],
  callback: () => Promise<T>,
): Promise<T> {
  return callLog.run({ logger, calls }, callback)
}

export function recordPayPalApiCall(call: PayPalApiCall): void {
  const context = callLog.getStore()
  if (!context) return
  context.calls.push(call)
  context.logger.info({ provider: "PayPal", ...call }, "PayPal API call")
}
