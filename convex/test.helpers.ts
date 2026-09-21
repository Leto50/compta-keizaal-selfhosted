import { convexTest } from "convex-test"

import { components } from "./_generated/api"
import authSchema from "./betterAuth/schema"
import schema from "./schema"
import { modules } from "./test.setup"

const authModules = import.meta.glob("./betterAuth/**/*.ts")

function documentId(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("_id" in value) ||
    typeof value._id !== "string"
  ) {
    throw new Error(
      "Le composant d'authentification n'a pas renvoyé d'identifiant."
    )
  }
  return value._id
}

export function createTestBackend() {
  const backend = convexTest(schema, modules)
  backend.registerComponent("betterAuth", authSchema, authModules)
  return backend
}

export async function asAuthenticatedUser(
  backend: ReturnType<typeof createTestBackend>,
  role: "admin" | "user" = "user"
) {
  const now = Date.now()
  const createdUser: unknown = await backend.mutation(
    components.betterAuth.adapter.create,
    {
      input: {
        data: {
          createdAt: now,
          email: `${role}@example.test`,
          emailVerified: true,
          name: role === "admin" ? "Administratrice test" : "Employé test",
          role,
          updatedAt: now,
          username: role,
        },
        model: "user",
      },
    }
  )
  const userId = documentId(createdUser)
  const createdSession: unknown = await backend.mutation(
    components.betterAuth.adapter.create,
    {
      input: {
        data: {
          createdAt: now,
          expiresAt: now + 60_000,
          token: `${role}-test-session-token`,
          updatedAt: now,
          userId,
        },
        model: "session",
      },
    }
  )
  const sessionId = documentId(createdSession)

  return backend.withIdentity({
    issuer: "https://auth.example.test",
    sessionId,
    subject: userId,
    tokenIdentifier: `https://auth.example.test|${userId}`,
  })
}
