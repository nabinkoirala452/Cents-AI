import { describe, expect, it } from "vitest"
import {
  canApprove,
  canEdit,
  canPrepare,
  canView,
  isOwner,
} from "../src/lib/permissions"

describe("role permissions", () => {
  it("matches the workspace permission tiers", () => {
    for (const role of ["Viewer", "FinanceManager", "Owner"] as const) {
      expect(canView(role)).toBe(true)
    }

    expect(canPrepare("Viewer")).toBe(false)
    expect(canEdit("Viewer")).toBe(false)
    expect(canPrepare("FinanceManager")).toBe(true)
    expect(canEdit("FinanceManager")).toBe(true)
    expect(canPrepare("Owner")).toBe(true)
    expect(canEdit("Owner")).toBe(true)

    expect(canApprove("Viewer", 1, 6000)).toBe(false)
    expect(canApprove("FinanceManager", 6000, 6000)).toBe(true)
    expect(canApprove("FinanceManager", 6000.01, 6000)).toBe(false)
    expect(canApprove("Owner", 1_000_000, 6000)).toBe(true)

    expect(isOwner("Owner")).toBe(true)
    expect(isOwner("FinanceManager")).toBe(false)
    expect(isOwner("Viewer")).toBe(false)
  })
})
