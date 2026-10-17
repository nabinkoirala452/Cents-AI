import { randomUUID } from "node:crypto"
import type { Prisma } from "@prisma/client"
import type { PayPalApiCall } from "./call-log"

export async function auditPayPalCalls(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string
    actor: string
    actorUserId?: string
    requestId?: string
    ref: string
    calls: PayPalApiCall[]
  },
): Promise<void> {
  for (const call of input.calls) {
    const status = call.status === null ? "network error" : String(call.status)
    const debugId = call.debug_id ? ` · debug_id ${call.debug_id}` : ""
    await tx.auditEvent.create({
      data: {
        workspaceId: input.workspaceId,
        id: `AU-${randomUUID()}`,
        actorUserId: input.actorUserId,
        actor: input.actor,
        action: "PayPal API call",
        detail: `${call.method} ${call.path} → ${status}${debugId}`,
        ref: input.ref,
        outcome: call.status !== null && call.status >= 200 && call.status < 300 ? "info" : "error",
        requestId: input.requestId,
      },
    })
  }
}
