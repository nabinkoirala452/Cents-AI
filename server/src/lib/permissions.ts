import type { MembershipRole } from "@prisma/client"
import { ForbiddenRoleError } from "./errors"

export function canView(_role: MembershipRole): boolean {
  return true
}

export function canPrepare(role: MembershipRole): boolean {
  return role !== "Viewer"
}

export function canEdit(role: MembershipRole): boolean {
  return role !== "Viewer"
}

export function canApprove(
  role: MembershipRole,
  amount: number,
  managerApprovalLimit: number,
): boolean {
  return role === "Owner" || (role === "FinanceManager" && amount <= managerApprovalLimit)
}

export function isOwner(role: MembershipRole): boolean {
  return role === "Owner"
}

export function requireView(role: MembershipRole): void {
  if (!canView(role)) throw new ForbiddenRoleError()
}

export function requirePrepare(role: MembershipRole): void {
  if (!canPrepare(role)) throw new ForbiddenRoleError()
}

export function requireEdit(role: MembershipRole): void {
  if (!canEdit(role)) throw new ForbiddenRoleError()
}

export function requireOwner(role: MembershipRole): void {
  if (!isOwner(role)) throw new ForbiddenRoleError()
}
