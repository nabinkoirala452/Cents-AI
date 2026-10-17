import { fileURLToPath } from "node:url"
import bcrypt from "bcryptjs"
import { Prisma, type PrismaClient } from "@prisma/client"
import { createSeed } from "../src/core"
import { config } from "../src/config"
import { prisma } from "../src/db"
import { replaceDemoWorkspaceRecords } from "../src/lib/demo-seed"

export const DEMO_WORKSPACE_ID = "centsai-demo"

const json = (value: unknown) => value as Prisma.InputJsonValue

export async function seedDemoWorkspace(database: PrismaClient, password: string) {
  const state = createSeed()
  const passwordHash = await bcrypt.hash(password, 12)
  const [owner, financeManager, viewer] = await Promise.all([
    database.user.upsert({
      where: { email: "owner@centsai.demo" },
      create: { email: "owner@centsai.demo", name: "Alex Kumar", passwordHash },
      update: { name: "Alex Kumar", passwordHash },
    }),
    database.user.upsert({
      where: { email: "finance@centsai.demo" },
      create: { email: "finance@centsai.demo", name: "Neha Shah", passwordHash },
      update: { name: "Neha Shah", passwordHash },
    }),
    database.user.upsert({
      where: { email: "viewer@centsai.demo" },
      create: { email: "viewer@centsai.demo", name: "Mina Rao", passwordHash },
      update: { name: "Mina Rao", passwordHash },
    }),
  ])

  await database.$transaction(async (tx) => {
    await tx.idempotencyKey.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } })
    await tx.membership.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } })
    await tx.workspace.upsert({
      where: { id: DEMO_WORKSPACE_ID },
      create: {
        id: DEMO_WORKSPACE_ID,
        name: state.settings.agencyName,
        currency: state.settings.currency,
        agencyType: state.settings.agencyType,
        teamSize: state.settings.teamSize,
        location: state.settings.location,
        website: state.settings.website,
        timezone: "America/Chicago",
        seededOn: state.seededOn,
      },
      update: {
        name: state.settings.agencyName,
        currency: state.settings.currency,
        agencyType: state.settings.agencyType,
        teamSize: state.settings.teamSize,
        location: state.settings.location,
        website: state.settings.website,
        timezone: "America/Chicago",
        seededOn: state.seededOn,
      },
    })
    await tx.workspaceSettings.upsert({
      where: { workspaceId: DEMO_WORKSPACE_ID },
      create: {
        workspaceId: DEMO_WORKSPACE_ID,
        safetyThreshold: state.settings.safetyThreshold,
        defaultHorizon: state.settings.defaultHorizon,
        planningScenario: state.settings.planningScenario,
        managerApprovalLimit: state.settings.managerApprovalLimit,
        openingBalance: state.settings.openingBalance,
        openingDate: state.settings.openingDate,
        ownerName: state.settings.ownerName,
        ownerEmail: state.settings.ownerEmail,
        notifications: json(state.settings.notifications),
        readiness: json(state.settings.readiness),
        dismissedInsights: json(state.dismissedInsights),
      },
      update: {
        safetyThreshold: state.settings.safetyThreshold,
        defaultHorizon: state.settings.defaultHorizon,
        planningScenario: state.settings.planningScenario,
        managerApprovalLimit: state.settings.managerApprovalLimit,
        openingBalance: state.settings.openingBalance,
        openingDate: state.settings.openingDate,
        ownerName: state.settings.ownerName,
        ownerEmail: state.settings.ownerEmail,
        notifications: json(state.settings.notifications),
        readiness: json(state.settings.readiness),
        dismissedInsights: json(state.dismissedInsights),
      },
    })
    await tx.membership.createMany({
      data: [
        { workspaceId: DEMO_WORKSPACE_ID, userId: owner.id, role: "Owner" },
        { workspaceId: DEMO_WORKSPACE_ID, userId: financeManager.id, role: "FinanceManager" },
        { workspaceId: DEMO_WORKSPACE_ID, userId: viewer.id, role: "Viewer" },
      ],
    })
    await replaceDemoWorkspaceRecords(
      tx,
      DEMO_WORKSPACE_ID,
      state,
      state.settings.currency,
      new Map([
        ["Alex Kumar", owner.id],
        ["Neha Shah", financeManager.id],
      ]),
      owner.id,
    )
  }, { maxWait: 30_000, timeout: 120_000 })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedDemoWorkspace(prisma, config.seedDemoPassword)
    console.info("Demo workspace seeded.")
  } finally {
    await prisma.$disconnect()
  }
}
