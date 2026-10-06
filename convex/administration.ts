import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { internalMutation, mutation, query } from "./_generated/server"
import { createAuth } from "./auth"
import { requireAdmin } from "./lib/auth"
import { accountRole } from "../shared/account-roles"
import { DEFAULT_SITE_NAME, SITE_NAME_MAX_LENGTH } from "../shared/site-name"

const SITE_NAME_KEY = "site-name"

// Le nom seul est public pour identifier le site avant la connexion.
export const getSiteName = query({
  args: {},
  handler: async (ctx) => {
    const setting = await ctx.db
      .query("systemSettings")
      .withIndex("by_key", (index) => index.eq("key", SITE_NAME_KEY))
      .unique()
    return setting?.value ?? DEFAULT_SITE_NAME
  },
})

export const saveSiteName = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx)
    const name = args.name.trim()
    if (!name || name.length > SITE_NAME_MAX_LENGTH) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `Le nom du site doit contenir entre 1 et ${SITE_NAME_MAX_LENGTH} caractères.`,
      })
    }

    const existing = await ctx.db
      .query("systemSettings")
      .withIndex("by_key", (index) => index.eq("key", SITE_NAME_KEY))
      .unique()
    if (existing?.value === name) return name

    const updatedAt = Date.now()
    const details = { key: SITE_NAME_KEY, updatedAt, value: name }
    const settingsId = existing
      ? existing._id
      : await ctx.db.insert("systemSettings", details)
    if (existing) await ctx.db.patch(existing._id, details)

    await ctx.db.insert("auditLogs", {
      action: "site.name_updated",
      actorUserId: String(user._id),
      createdAt: updatedAt,
      detail: `${existing?.value ?? DEFAULT_SITE_NAME} → ${name}`,
      entityId: settingsId,
      entityType: "site_settings",
    })
    return name
  },
})

function timestamp(value: Date | number): number {
  return value instanceof Date ? value.getTime() : value
}

interface AuthAccount {
  banned?: boolean | null
  createdAt: Date | number
  email: string
  id: string
  name: string
  role?: string | null
  username?: string | null
  updatedAt: Date | number
}

function accountIdentifier(
  user: Pick<AuthAccount, "email" | "username">
): string {
  return user.username?.trim() ?? user.email
}

export const listAccounts = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx)
    const authContext = await createAuth(ctx).$context
    const users = (await authContext.internalAdapter.listUsers(200, 0, {
      direction: "asc",
      field: "name",
    })) as AuthAccount[]
    return users.map((user) => ({
      banned: user.banned === true,
      createdAt: timestamp(user.createdAt),
      id: user.id,
      identifier: accountIdentifier(user),
      name: user.name,
      role: accountRole(user.role),
      updatedAt: timestamp(user.updatedAt),
    }))
  },
})

export const listAuditPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    const result = await ctx.db
      .query("auditLogs")
      .withIndex("by_created_at")
      .order("desc")
      .paginate(args.paginationOpts)
    const actorIds = [...new Set(result.page.map((entry) => entry.actorUserId))]
    const authContext = await createAuth(ctx).$context
    const actors = await Promise.all(
      actorIds.map(async (actorUserId) => {
        const user = (await authContext.internalAdapter.findUserById(
          actorUserId
        )) as Pick<AuthAccount, "email" | "name" | "username"> | null
        return [
          actorUserId,
          user
            ? {
                identifier: accountIdentifier(user),
                name: user.name,
              }
            : undefined,
        ] as const
      })
    )
    const actorsById = new Map(actors)
    return {
      ...result,
      page: result.page.map((entry) => ({
        ...entry,
        actor: actorsById.get(entry.actorUserId),
      })),
    }
  },
})

export const logAuthAction = internalMutation({
  args: {
    action: v.string(),
    actorUserId: v.string(),
    detail: v.optional(v.string()),
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      action: args.action,
      actorUserId: args.actorUserId,
      createdAt: Date.now(),
      ...(args.detail ? { detail: args.detail } : {}),
      entityId: args.entityId,
      entityType: "account",
    })
  },
})
