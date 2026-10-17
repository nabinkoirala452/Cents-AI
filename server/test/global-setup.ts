import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { PrismaClient } from "@prisma/client"
import "../src/config"

const serverDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const prismaCli = resolve(serverDirectory, "node_modules/prisma/build/index.js")

export default async function setup() {
  const baseUrl = process.env.DATABASE_URL
  if (!baseUrl) throw new Error("DATABASE_URL is required for the database integration test")

  const schema = `centsai_test_${randomUUID().replaceAll("-", "")}`
  const testUrl = new URL(baseUrl)
  testUrl.searchParams.set("schema", schema)
  const admin = new PrismaClient({ datasources: { db: { url: baseUrl } } })

  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
    process.env.DATABASE_URL = testUrl.toString()
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: serverDirectory,
      env: { ...process.env, DATABASE_URL: testUrl.toString() },
      stdio: "inherit",
    })
  } catch (error) {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await admin.$disconnect()
    throw error
  }

  return async () => {
    try {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    } finally {
      await admin.$disconnect()
    }
  }
}
