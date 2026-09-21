import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { internalMutation, query } from "./_generated/server"
import { createAuth } from "./auth"
import { requireAdmin } from "./lib/auth"

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
      role: user.role?.split(",").includes("admin") ? "admin" : "user",
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
