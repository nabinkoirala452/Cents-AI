import { Prisma, type MembershipRole } from "@prisma/client"
import type { Role } from "../../../../src/lib/types"
import { prisma } from "../../db"
import { HttpError } from "../../lib/errors"
import { requireEdit, requireOwner, requireView } from "../../lib/permissions"
import { loadState } from "../../lib/state"
import type { RequestContext } from "../../plugins/auth"
import { audit } from "../audit/service"

export type WorkspacePatch = {
  name?: string
  agencyType?: string
  teamSize?: string
  location?: string
  website?: string
  timezone?: string
}

export type SettingsPatch = {
  ownerName?: string
  ownerEmail?: string
  safetyThreshold?: number
  defaultHorizon?: 7 | 30 | 90
  planningScenario?: "expected" | "optimistic" | "conservative"
  notifications?: Record<string, boolean>
  managerApprovalLimit?: number
  team?: Array<{ email: string; role: Role }>
}

export type ForecastAssumptions = {
  safetyThreshold: number
  invoiceOverrides: Array<{ id: string; expectedDelayOverride: number | null }>
}

const roleToDatabase: Record<Role, MembershipRole> = {
  Owner: "Owner",
  "Finance Manager": "FinanceManager",
  Viewer: "Viewer",
}

export async function readWorkspaceState(ctx: RequestContext) {
  requireView(ctx.role)
  const role: Role = ctx.role === "FinanceManager" ? "Finance Manager" : ctx.role
  return loadState(ctx.workspaceId, role)
}

export async function patchWorkspace(ctx: RequestContext, patch: WorkspacePatch) {
  requireEdit(ctx.role)
  const entries = Object.entries(patch)
  if (entries.length === 0) {
    throw new HttpError(400, "empty_update", "Provide at least one workspace field to update.", "Bad Request")
  }
  const updated = await prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.update({
      where: { id: ctx.workspaceId },
      data: patch,
    })
    await audit(ctx, {
      action: "Workspace updated",
      detail: `Updated workspace fields: ${entries.map(([key]) => key).join(", ")}`,
      outcome: "success",
    }, tx)
    return workspace
  })
  return updated
}

export async function patchSettings(ctx: RequestContext, patch: SettingsPatch) {
  requireEdit(ctx.role)
  const ownerOnlyFields = patch.managerApprovalLimit !== undefined || patch.team !== undefined
  if (ownerOnlyFields) requireOwner(ctx.role)

  if (Object.keys(patch).length === 0) {
    throw new HttpError(400, "empty_update", "Provide at least one setting to update.", "Bad Request")
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (patch.team) {
      const emails = patch.team.map(({ email }) => email.toLowerCase())
      if (new Set(emails).size !== emails.length) {
        throw new HttpError(400, "duplicate_team_member", "Each team member may appear only once.", "Bad Request")
      }

      const memberships = await tx.membership.findMany({
        where: { workspaceId: ctx.workspaceId, user: { email: { in: emails } } },
        include: { user: { select: { email: true } } },
      })
      const byEmail = new Map(memberships.map((membership) => [membership.user.email.toLowerCase(), membership]))
      if (emails.some((email) => !byEmail.has(email))) {
        throw new HttpError(404, "team_member_not_found", "One or more team members were not found.", "Not Found")
      }
      for (const member of patch.team) {
        const membership = byEmail.get(member.email.toLowerCase())!
        const nextRole = roleToDatabase[member.role]
        if (membership.role === "Owner" && nextRole !== "Owner") {
          throw new HttpError(400, "owner_role_required", "The workspace owner role cannot be changed.", "Bad Request")
        }
      }
      for (const member of patch.team) {
        const membership = byEmail.get(member.email.toLowerCase())!
        await tx.membership.update({
          where: {
            workspaceId_userId: {
              workspaceId: ctx.workspaceId,
              userId: membership.userId,
            },
          },
          data: { role: roleToDatabase[member.role] },
        })
      }
    }

    const { team: _team, ...settingFields } = patch
    const settings = await tx.workspaceSettings.update({
      where: { workspaceId: ctx.workspaceId },
      data: {
        ...settingFields,
        ...(patch.notifications
          ? { notifications: patch.notifications as Prisma.InputJsonValue }
          : {}),
      },
    })
    const fieldNames = Object.keys(patch)
    await audit(ctx, {
      action: "Workspace settings updated",
      detail: `Updated settings fields: ${fieldNames.join(", ")}`,
      outcome: "success",
    }, tx)
    return settings
  })
  return {
    ...updated,
    safetyThreshold: updated.safetyThreshold.toNumber(),
    managerApprovalLimit: updated.managerApprovalLimit.toNumber(),
    openingBalance: updated.openingBalance.toNumber(),
  }
}

export async function replaceDismissedInsights(ctx: RequestContext, dismissedInsights: string[]) {
  requireView(ctx.role)
  return prisma.$transaction(async (tx) => {
    const settings = await tx.workspaceSettings.update({
      where: { workspaceId: ctx.workspaceId },
      data: { dismissedInsights },
    })
    await audit(ctx, {
      action: "Dismissed insights updated",
      detail: `Replaced dismissed insights (${dismissedInsights.length} entries)`,
      outcome: "success",
    }, tx)
    return settings.dismissedInsights
  })
}

export async function saveForecastAssumptions(ctx: RequestContext, assumptions: ForecastAssumptions) {
  requireEdit(ctx.role)
  const ids = assumptions.invoiceOverrides.map(({ id }) => id)
  if (new Set(ids).size !== ids.length) {
    throw new HttpError(400, "duplicate_invoice_override", "Each invoice may appear only once.", "Bad Request")
  }

  return prisma.$transaction(async (tx) => {
    let changed = 0
    if (ids.length) {
      const invoices = await tx.invoice.findMany({
        where: { workspaceId: ctx.workspaceId, id: { in: ids } },
        select: { id: true, status: true, expectedDelayOverride: true },
      })
      if (invoices.length !== ids.length || invoices.some((invoice) => invoice.status !== "Sent")) {
        throw new HttpError(409, "invoice_override_not_editable", "Receipt assumptions can only be changed for sent invoices.", "Conflict")
      }
      // The form sends every sent invoice; write only the ones that changed, one query per distinct value,
      // so a save stays well inside the transaction timeout on a remote database.
      const current = new Map(invoices.map((invoice) => [invoice.id, invoice.expectedDelayOverride]))
      const byValue = new Map<number | null, string[]>()
      for (const item of assumptions.invoiceOverrides) {
        if (current.get(item.id) === item.expectedDelayOverride) continue
        byValue.set(item.expectedDelayOverride, [...(byValue.get(item.expectedDelayOverride) ?? []), item.id])
      }
      for (const [expectedDelayOverride, invoiceIds] of byValue) {
        changed += invoiceIds.length
        await tx.invoice.updateMany({
          where: { workspaceId: ctx.workspaceId, id: { in: invoiceIds } },
          data: { expectedDelayOverride },
        })
      }
    }
    await tx.workspaceSettings.update({
      where: { workspaceId: ctx.workspaceId },
      data: { safetyThreshold: assumptions.safetyThreshold },
    })
    await audit(ctx, {
      action: "Forecast assumptions updated",
      detail: `Safety threshold and ${changed} sent-invoice receipt assumption(s) updated`,
      outcome: "success",
    }, tx)
    return { saved: true }
  }, { timeout: 20_000 })
}
