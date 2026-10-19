import { PrismaClient } from "@prisma/client"

// The hosted database is a remote pooler, so interactive transactions get more than Prisma's 5 s default.
export const prisma = new PrismaClient({ transactionOptions: { maxWait: 10_000, timeout: 15_000 } })
