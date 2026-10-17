import { jwtVerify, SignJWT } from "jose"
import type { MembershipRole } from "@prisma/client"
import type { FastifyInstance, FastifyRequest } from "fastify"
import { config } from "../config"
import { prisma } from "../db"
import { HttpError } from "../lib/errors"

export type RequestContext = {
  userId: string
  userName: string
  workspaceId: string
  role: MembershipRole
  requestId: string
}

declare module "fastify" {
  interface FastifyRequest {
    ctx: RequestContext | null
  }
}

const jwtKey = new TextEncoder().encode(config.jwtSecret)

export async function createAccessToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(jwtKey)
}

export function requireContext(request: FastifyRequest): RequestContext {
  if (!request.ctx) throw new HttpError(401, "unauthorized", "Authentication is required.", "Unauthorized")
  return request.ctx
}

export function installAuth(app: FastifyInstance): void {
  app.decorateRequest("ctx", null)
  app.addHook("onRequest", async (request) => {
    const pathname = request.url.split("?", 1)[0]
    if (
      !pathname.startsWith("/api/v1/")
      || pathname === "/api/v1/health"
      || pathname === "/api/v1/auth/login"
      || pathname === "/api/v1/webhooks/paypal"
    ) return

    const authorization = request.headers.authorization
    const match = authorization?.match(/^Bearer\s+(.+)$/i)
    if (!match) {
      throw new HttpError(401, "unauthorized", "Authentication is required.", "Unauthorized")
    }

    let userId: string
    try {
      const { payload } = await jwtVerify(match[1], jwtKey, { algorithms: ["HS256"] })
      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        throw new Error("JWT subject is missing")
      }
      userId = payload.sub
    } catch {
      throw new HttpError(401, "unauthorized", "The access token is invalid or expired.", "Unauthorized")
    }

    const workspaceId = request.headers["x-workspace-id"]
    if (typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
      throw new HttpError(400, "workspace_required", "X-Workspace-Id is required.", "Bad Request")
    }

    const membership = await prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { user: { select: { name: true } } },
    })
    if (!membership) {
      throw new HttpError(404, "workspace_not_found", "Workspace not found.", "Not Found")
    }

    request.ctx = {
      userId,
      userName: membership.user.name,
      workspaceId,
      role: membership.role,
      requestId: request.id,
    }
  })
}
