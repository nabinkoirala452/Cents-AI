import bcrypt from "bcryptjs"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { prisma } from "../../db"
import { HttpError } from "../../lib/errors"
import { createAccessToken } from "../../plugins/auth"

const loginBody = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  password: z.string().min(1),
}).strict()

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post("/api/v1/auth/login", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: { body: loginBody },
  }, async (request) => {
    const { email, password } = loginBody.parse(request.body)
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new HttpError(401, "invalid_credentials", "Email or password is incorrect.", "Unauthorized")
    }

    const [token, memberships] = await Promise.all([
      createAccessToken(user.id),
      prisma.membership.findMany({
        where: { userId: user.id },
        include: { workspace: { select: { id: true, name: true } } },
        orderBy: { workspace: { name: "asc" } },
      }),
    ])

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email },
      workspaces: memberships.map(({ workspace, role }) => ({
        id: workspace.id,
        name: workspace.name,
        role,
      })),
    }
  })
}
