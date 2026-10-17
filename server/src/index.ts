import { buildApp } from "./app"
import { config } from "./config"

const app = await buildApp()

try {
  await app.listen({ host: "0.0.0.0", port: config.port })
} catch (error) {
  app.log.error({ err: error }, "Failed to start server")
  await app.close()
  process.exitCode = 1
}
