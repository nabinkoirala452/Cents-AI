import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"
import { z } from "zod"

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") })

const booleanFromString = z.preprocess((value) => {
  if (value === "true") return true
  if (value === "false") return false
  return value
}, z.boolean())

const optionalValue = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().optional(),
)

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "must contain at least 32 characters"),
  CORS_ORIGIN: z.string()
    .transform((value) => value.split(",").map((origin) => origin.trim()))
    .pipe(z.array(z.string().url()).min(1)),
  SEED_DEMO_PASSWORD: z.string().min(1),
  ALLOW_DEMO_RESET: booleanFromString.default(false),
  PAYPAL_MODE: z.enum(["sandbox", "fake"]).default("sandbox"),
  PAYPAL_ENV: z.enum(["sandbox", "live"]).default("sandbox"),
  PAYPAL_BASE_URL: z.string().url(),
  PAYPAL_CLIENT_ID: optionalValue,
  PAYPAL_CLIENT_SECRET: optionalValue,
  PAYPAL_WEBHOOK_ID: optionalValue,
  PAYPAL_SANDBOX_PAYER_EMAIL: optionalValue,
})

const parsed = environmentSchema.safeParse(process.env)

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ")
  throw new Error(`Invalid server configuration: ${details}`)
}

const expectedPayPalBaseUrl = parsed.data.PAYPAL_ENV === "sandbox"
  ? "https://api-m.sandbox.paypal.com"
  : "https://api-m.paypal.com"

if (parsed.data.PAYPAL_BASE_URL.replace(/\/+$/, "") !== expectedPayPalBaseUrl) {
  throw new Error(
    `Invalid server configuration: PAYPAL_ENV=${parsed.data.PAYPAL_ENV} requires PAYPAL_BASE_URL=${expectedPayPalBaseUrl}`,
  )
}

export const config = {
  nodeEnv: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  databaseUrl: parsed.data.DATABASE_URL,
  jwtSecret: parsed.data.JWT_SECRET,
  corsOrigins: parsed.data.CORS_ORIGIN,
  seedDemoPassword: parsed.data.SEED_DEMO_PASSWORD,
  allowDemoReset: parsed.data.ALLOW_DEMO_RESET,
  paypalMode: parsed.data.PAYPAL_MODE,
  paypalEnv: parsed.data.PAYPAL_ENV,
  paypalBaseUrl: expectedPayPalBaseUrl,
  paypalClientId: parsed.data.PAYPAL_CLIENT_ID,
  paypalClientSecret: parsed.data.PAYPAL_CLIENT_SECRET,
  paypalWebhookId: parsed.data.PAYPAL_WEBHOOK_ID,
  paypalSandboxPayerEmail: parsed.data.PAYPAL_SANDBOX_PAYER_EMAIL,
} as const
