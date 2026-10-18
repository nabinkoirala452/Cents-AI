import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { prisma } from "../../db"
import { requireContext } from "../../plugins/auth"
import { patchSettings, patchWorkspace, readWorkspaceState, replaceDismissedInsights, saveForecastAssumptions } from "./service"

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone })
    return true
  } catch {
    return false
  }
}

function isHttpWebsite(website: string): boolean {
  if (website.length === 0) return true
  try {
    const url = new URL(website)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

const workspacePatch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  agencyType: z.string().trim().min(1).max(100).optional(),
  teamSize: z.string().trim().min(1).max(100).optional(),
  location: z.string().trim().min(1).max(200).optional(),
  website: z.string().trim().max(500).refine(isHttpWebsite, "Website must be empty or an HTTP(S) URL").optional(),
  timezone: z.string().trim().min(1).max(100)
    .refine(isValidTimeZone, "Timezone must be a valid IANA timezone").optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required")

const settingsPatch = z.object({
  ownerName: z.string().trim().min(1).max(200).optional(),
  ownerEmail: z.string().trim().email().optional(),
  safetyThreshold: z.number().finite().nonnegative().optional(),
  defaultHorizon: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
  planningScenario: z.enum(["expected", "optimistic", "conservative"]).optional(),
  notifications: z.record(z.string(), z.boolean()).optional(),
  managerApprovalLimit: z.number().finite().nonnegative().optional(),
  team: z.array(z.object({
    email: z.string().trim().email(),
    role: z.enum(["Owner", "Finance Manager", "Viewer"]),
  }).strict()).max(100).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one setting is required")

const dismissedInsightsBody = z.object({
  dismissedInsights: z.array(z.string().min(1).max(200)).max(500),
}).strict()
const forecastAssumptionsBody = z.object({
  safetyThreshold: z.number().finite().nonnegative().max(999_999_999_999.99),
  invoiceOverrides: z.array(z.object({
    id: z.string().trim().min(1).max(100),
    expectedDelayOverride: z.number().int().nonnegative().max(3650).nullable(),
  }).strict()).max(1000),
}).strict()

export function registerWorkspaceRoutes(app: FastifyInstance): void {
  app.get("/api/v1/me", async (request) => {
    const context = requireContext(request)
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: context.userId },
      select: { id: true, name: true, email: true },
    })
    const memberships = await prisma.membership.findMany({
      where: { userId: context.userId },
      include: { workspace: { select: { id: true, name: true } } },
      orderBy: { workspace: { name: "asc" } },
    })
    return {
      user,
      workspaces: memberships.map(({ workspace, role }) => ({ ...workspace, role })),
    }
  })

  app.get("/api/v1/workspace/state", async (request) =>
    readWorkspaceState(requireContext(request)),
  )

  app.patch("/api/v1/workspace", { schema: { body: workspacePatch } }, async (request) =>
    patchWorkspace(requireContext(request), workspacePatch.parse(request.body)),
  )

  app.patch("/api/v1/settings", { schema: { body: settingsPatch } }, async (request) =>
    patchSettings(requireContext(request), settingsPatch.parse(request.body)),
  )

  app.put("/api/v1/settings/dismissed-insights", {
    schema: { body: dismissedInsightsBody },
  }, async (request) =>
    replaceDismissedInsights(
      requireContext(request),
      dismissedInsightsBody.parse(request.body).dismissedInsights,
    ),
  )

  app.put("/api/v1/settings/forecast-assumptions", {
    schema: { body: forecastAssumptionsBody },
  }, async (request) =>
    saveForecastAssumptions(
      requireContext(request),
      forecastAssumptionsBody.parse(request.body),
    ),
  )
}
