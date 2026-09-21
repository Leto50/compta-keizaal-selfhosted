import { createClient, type GenericCtx } from "@convex-dev/better-auth"
import { convex } from "@convex-dev/better-auth/plugins"
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api"
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal"
import { admin, username } from "better-auth/plugins"
import type { GenericActionCtx } from "convex/server"
import { ConvexError, v } from "convex/values"

import { components, internal } from "./_generated/api"
import { type DataModel } from "./_generated/dataModel"
import { internalMutation, query } from "./_generated/server"
import authConfig from "./auth.config"
import authSchema from "./betterAuth/schema"
import { wouldRemoveLastActiveAdmin } from "./lib/accountSecurity"
import {
  internalAccountEmail,
  isAccountIdentifier,
  normalizeAccountIdentifier,
} from "../shared/account-identifiers"

const siteUrl = process.env.SITE_URL ?? "http://localhost:3000"

export const authComponent = createClient<DataModel, typeof authSchema>(
  components.betterAuth,
  {
    local: {
      schema: authSchema,
    },
  }
)

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
}

function bodyString(
  body: unknown,
  property: "email" | "name" | "password" | "role" | "userId"
): string | undefined {
  if (!isRecord(body)) return undefined
  const value = body[property]
  return typeof value === "string" ? value : undefined
}

function bodyDataString(
  body: unknown,
  property: "username"
): string | undefined {
  if (!isRecord(body) || !isRecord(body.data)) return undefined
  const value = body.data[property]
  return typeof value === "string" ? value : undefined
}

function bodyRoleRemovesAdmin(body: unknown): boolean {
  if (!isRecord(body)) return false
  const role = body.role
  if (typeof role === "string") return !role.split(",").includes("admin")
  if (Array.isArray(role)) return !role.includes("admin")
  return false
}

const authAuditActions: Readonly<
  Record<string, { action: string; detailProperty?: "identifier" | "role" }>
> = {
  "/admin/ban-user": { action: "account.disabled" },
  "/admin/create-user": {
    action: "account.created",
    detailProperty: "identifier",
  },
  "/admin/remove-user": { action: "account.deleted" },
  "/admin/revoke-user-sessions": { action: "account.sessions_revoked" },
  "/admin/set-role": { action: "account.role_updated", detailProperty: "role" },
  "/admin/set-user-password": { action: "account.password_reset" },
  "/admin/unban-user": { action: "account.reactivated" },
}

function canRunMutation(
  ctx: GenericCtx<DataModel>
): ctx is GenericActionCtx<DataModel> {
  return "runMutation" in ctx
}

export async function assertAdminContinuity(requestContext: {
  body: unknown
  context: {
    internalAdapter: {
      listUsers: (
        limit?: number,
        offset?: number
      ) => Promise<
        Array<{
          banned?: boolean | null
          id: string
          role?: string | null
        }>
      >
    }
  }
  path: string
}) {
  const protectsLastAdmin =
    requestContext.path === "/admin/ban-user" ||
    requestContext.path === "/admin/remove-user" ||
    (requestContext.path === "/admin/set-role" &&
      bodyRoleRemovesAdmin(requestContext.body))
  if (!protectsLastAdmin) return
  const userId = bodyString(requestContext.body, "userId")
  if (!userId) return
  const users = await requestContext.context.internalAdapter.listUsers(200, 0)
  if (wouldRemoveLastActiveAdmin(users, userId, true)) {
    throw new APIError("BAD_REQUEST", {
      message:
        "Le dernier administrateur actif ne peut pas être rétrogradé ou désactivé.",
    })
  }
}

export const createAuthOptions = (convexCtx: GenericCtx<DataModel>) =>
  ({
    baseURL: siteUrl,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(convexCtx),
    emailAndPassword: {
      disableSignUp: true,
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 12,
      requireEmailVerification: false,
    },
    hooks: {
      before: createAuthMiddleware(async (requestContext) => {
        await assertAdminContinuity(requestContext)
        if (requestContext.path !== "/admin/create-user") return

        const name = bodyString(requestContext.body, "name")?.trim()
        const password = bodyString(requestContext.body, "password")
        const role = bodyString(requestContext.body, "role")
        const rawIdentifier = bodyDataString(requestContext.body, "username")
        const identifier = rawIdentifier
          ? normalizeAccountIdentifier(rawIdentifier)
          : ""
        const email = bodyString(requestContext.body, "email")
        if (!name || name.length > 100) {
          throw new APIError("BAD_REQUEST", {
            message: "Le nom doit contenir entre 1 et 100 caractères.",
          })
        }
        if (!password || password.length < 12 || password.length > 128) {
          throw new APIError("BAD_REQUEST", {
            message:
              "Le mot de passe doit contenir entre 12 et 128 caractères.",
          })
        }
        if (role !== "admin" && role !== "user") {
          throw new APIError("BAD_REQUEST", {
            message: "Le rôle doit être employé ou administrateur.",
          })
        }
        if (
          !isAccountIdentifier(identifier) ||
          email !== internalAccountEmail(identifier)
        ) {
          throw new APIError("BAD_REQUEST", {
            message: "L’identifiant de connexion est invalide.",
          })
        }
      }),
      after: createAuthMiddleware(async (requestContext) => {
        const audit = authAuditActions[requestContext.path]
        if (!audit || !canRunMutation(convexCtx)) return
        const session = await getSessionFromCtx(requestContext)
        if (!session) return
        const entityId =
          bodyString(requestContext.body, "userId") ??
          bodyDataString(requestContext.body, "username") ??
          bodyString(requestContext.body, "email")
        if (!entityId) return
        const detail =
          audit.detailProperty === "identifier"
            ? bodyDataString(requestContext.body, "username")
            : audit.detailProperty
              ? bodyString(requestContext.body, audit.detailProperty)
              : undefined
        await convexCtx.runMutation(internal.administration.logAuthAction, {
          action: audit.action,
          actorUserId: session.user.id,
          ...(detail ? { detail } : {}),
          entityId,
        })
      }),
    },
    plugins: [
      convex({ authConfig }),
      username({
        maxUsernameLength: 30,
        minUsernameLength: 3,
        usernameNormalization: normalizeAccountIdentifier,
        usernameValidator: isAccountIdentifier,
      }),
      admin(),
    ],
    telemetry: {
      enabled: false,
    },
  }) satisfies BetterAuthOptions

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx))

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => authComponent.safeGetAuthUser(ctx),
})

export const bootstrapAdmin = internalMutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const configuredIdentifier = process.env.INITIAL_ADMIN_IDENTIFIER?.trim()
    const legacyEmail = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase()
    if (!configuredIdentifier && !legacyEmail) {
      throw new ConvexError({
        code: "MISSING_CONFIGURATION",
        message: "INITIAL_ADMIN_IDENTIFIER doit être configuré.",
      })
    }
    const legacyLocalPart = legacyEmail?.split("@")[0] ?? ""
    const identifier = normalizeAccountIdentifier(
      configuredIdentifier ??
        (isAccountIdentifier(legacyLocalPart)
          ? legacyLocalPart
          : "administrateur")
    )
    if (!isAccountIdentifier(identifier)) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "INITIAL_ADMIN_IDENTIFIER est invalide.",
      })
    }
    const accountEmail = internalAccountEmail(identifier)

    const name = args.name.trim()
    if (!name || name.length > 100) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Le nom doit contenir entre 1 et 100 caractères.",
      })
    }

    const auth = createAuth(ctx)
    const authContext = await auth.$context
    const legacyAccount = legacyEmail
      ? await authContext.internalAdapter.findUserByEmail(legacyEmail)
      : null
    const existing =
      legacyAccount ??
      (await authContext.internalAdapter.findUserByEmail(accountEmail))
    if (existing) {
      const existingUsername = (
        existing.user as typeof existing.user & { username?: string | null }
      ).username
      await authContext.internalAdapter.updateUserByEmail(existing.user.email, {
        role: "admin",
        ...(existingUsername === identifier ? {} : { username: identifier }),
      })
      return { created: false, identifier, name: existing.user.name }
    }

    const password = process.env.INITIAL_ADMIN_PASSWORD
    if (!password) {
      throw new ConvexError({
        code: "MISSING_CONFIGURATION",
        message: "INITIAL_ADMIN_PASSWORD doit être configurée.",
      })
    }
    if (password.length < 12 || password.length > 128) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Le mot de passe doit contenir entre 12 et 128 caractères.",
      })
    }

    await auth.api.createUser({
      body: {
        data: { username: identifier },
        email: accountEmail,
        name,
        password,
        role: "admin",
      },
    })

    return { created: true, identifier, name }
  },
})

export const removeUserByEmail = internalMutation({
  args: {
    confirmation: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase()
    const confirmation = args.confirmation.trim().toLowerCase()
    if (!email || confirmation !== email) {
      throw new ConvexError({
        code: "INVALID_CONFIRMATION",
        message: "L’adresse de confirmation ne correspond pas.",
      })
    }

    const authContext = await createAuth(ctx).$context
    const existing = await authContext.internalAdapter.findUserByEmail(email)
    if (!existing) return { email, removed: false }

    const users = (await authContext.internalAdapter.listUsers(
      200,
      0
    )) as Array<{
      banned?: boolean | null
      id: string
      role?: string | null
    }>
    if (wouldRemoveLastActiveAdmin(users, existing.user.id, true)) {
      throw new ConvexError({
        code: "LAST_ACTIVE_ADMIN",
        message: "Le dernier administrateur actif ne peut pas être supprimé.",
      })
    }

    await authContext.internalAdapter.deleteUser(existing.user.id)
    return { email, removed: true }
  },
})
