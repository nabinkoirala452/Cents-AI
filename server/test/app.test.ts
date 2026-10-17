import { describe, expect, it } from "vitest"
import { buildApp } from "../src/app"

describe("API foundation", () => {
  it("serves the versioned health endpoint", async () => {
    const app = await buildApp()
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/health" })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ status: "ok" })

      const missing = await app.inject({ method: "GET", url: "/not-a-route" })
      expect(missing.statusCode).toBe(404)
      expect(missing.headers["content-type"]).toContain("application/problem+json")
    } finally {
      await app.close()
    }
  })
})
