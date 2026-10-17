import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { requireContext } from "../../plugins/auth"
import {
  approveApproval,
  confirmContractorTransfer,
  createApproval,
  listApprovals,
  rejectApproval,
  retryApproval,
} from "./service"

const idParams = z.object({ id: z.string().trim().min(1).max(100) }).strict()
const createBody = z.object({
  kind: z.enum([
    "paypal_send_invoice",
    "send_reminder",
    "record_contractor_payment",
    "cancel_subscription",
  ]),
  refId: z.string().trim().min(1).max(100),
  draft: z.string().max(2000).optional(),
}).strict().superRefine((value, context) => {
  if (value.draft !== undefined && value.kind !== "send_reminder") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["draft"],
      message: "A reminder draft is only valid for send_reminder approvals.",
    })
  }
})
const rejectBody = z.object({ reason: z.string().trim().min(1).max(1000) }).strict()
const referenceBody = z.object({ reference: z.string().trim().min(1).max(200) }).strict()
const noBody = z.preprocess(
  (value) => value === undefined || value === null ? {} : value,
  z.object({}).strict(),
)
const listQuery = z.object({
  status: z.enum(["Pending", "Rejected", "Submitted", "Verified", "Failed", "Stale"]).optional(),
}).strict()

export function registerApprovalRoutes(app: FastifyInstance): void {
  app.get("/api/v1/approvals", { schema: { querystring: listQuery } }, async (request) =>
    listApprovals(requireContext(request), listQuery.parse(request.query).status),
  )
  app.post("/api/v1/approvals", { schema: { body: createBody } }, async (request) =>
    createApproval(requireContext(request), createBody.parse(request.body)),
  )
  app.post("/api/v1/approvals/:id/approve", {
    schema: { params: idParams, body: noBody },
    config: { allowEmptyBody: true },
  }, async (request) =>
    approveApproval(requireContext(request), idParams.parse(request.params).id, request.log),
  )
  app.post("/api/v1/approvals/:id/retry", {
    schema: { params: idParams, body: noBody },
    config: { allowEmptyBody: true },
  }, async (request) =>
    retryApproval(requireContext(request), idParams.parse(request.params).id, request.log),
  )
  app.post("/api/v1/approvals/:id/reject", {
    schema: { params: idParams, body: rejectBody },
  }, async (request) =>
    rejectApproval(
      requireContext(request),
      idParams.parse(request.params).id,
      rejectBody.parse(request.body).reason,
    ),
  )
  app.post("/api/v1/approvals/:id/confirm-transfer", {
    schema: { params: idParams, body: referenceBody },
  }, async (request) =>
    confirmContractorTransfer(
      requireContext(request),
      idParams.parse(request.params).id,
      referenceBody.parse(request.body).reference,
    ),
  )
}
