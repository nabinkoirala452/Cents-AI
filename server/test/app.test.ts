import { describe, expect, it } from "vitest"
import { buildApp } from "../src/app"
import { config } from "../src/config"

describe("API foundation", () => {
  it("serves the versioned health endpoint", async () => {
    const app = await buildApp()
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/health" })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        status: "ok",
        paypalMode: expect.stringMatching(/^(sandbox|fake)$/),
        paypalEnvironment: expect.stringMatching(/^(sandbox|live)$/),
      })

      const missing = await app.inject({ method: "GET", url: "/not-a-route" })
      expect(missing.statusCode).toBe(404)
      expect(missing.headers["content-type"]).toContain("application/problem+json")
    } finally {
      await app.close()
    }
  })

  it("returns access-control-allow-methods for CORS preflight of PUT, PATCH and DELETE from the configured origin", async () => {
    const app = await buildApp()
    try {
      const origin = config.corsOrigins[0]
      for (const method of ["PUT", "PATCH", "DELETE"]) {
        const response = await app.inject({
          method: "OPTIONS",
          url: "/api/v1/settings/forecast-assumptions",
          headers: {
            origin,
            "access-control-request-method": method,
          },
        })
        expect(response.statusCode).toBe(204)
        expect(response.headers["access-control-allow-origin"]).toBe(origin)
        const allowed = response.headers["access-control-allow-methods"]
        expect(allowed).toBeDefined()
        expect(allowed).toContain(method)
      }
    } finally {
      await app.close()
    }
  })
})

