import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { internalMutation, mutation, query } from "./_generated/server"
import { createAuth } from "./auth"
import { requireAdmin } from "./lib/auth"
import {
  accountRole,
  accountRoleLabels,
  accountRoles,
} from "../shared/account-roles"
import { readerAccessValidator } from "./schema"
import { readReaderAccess } from "./lib/readerAccess"
import {
  wouldRemoveLastActiveAdmin,
  type AccountSecurityState,
} from "./lib/accountSecurity"
import {
  internalAccountEmail,
  isAccountIdentifier,
  normalizeAccountIdentifier,
} from "../shared/account-identifiers"
import { type MutationCtx } from "./_generated/server"
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
    return Promise.all(
      users.map(async (user) => ({
        banned: user.banned === true,
        createdAt: timestamp(user.createdAt),
        id: user.id,
        identifier: accountIdentifier(user),
        name: user.name,
        role: accountRole(user.role),
        readerAccess: await readReaderAccess(ctx, {
          _id: user.id,
          role: user.role,
        }),
        updatedAt: timestamp(user.updatedAt),
      }))
    )
  },
})

async function storeReaderAccess(
  ctx: MutationCtx,
  userId: string,
  updatedBy: string,
  access: typeof readerAccessValidator.type
) {
  if (access.productIds && access.productIds.length > 2000)
    throw new ConvexError("La sélection est limitée à 2 000 produits.")
  for (const productId of access.productIds ?? []) {
    if (!(await ctx.db.get(productId)))
      throw new ConvexError("Un produit sélectionné est introuvable.")
  }
  const existing = await ctx.db
    .query("readerAccess")
    .withIndex("by_user", (index) => index.eq("userId", userId))
    .unique()
  const details = {
    ...access,
    sections: [...new Set(access.sections)],
    operationKinds: [...new Set(access.operationKinds)],
    productIds:
      access.productIds === undefined
        ? undefined
        : [...new Set(access.productIds)],
    showPurchasePrices: access.showPurchasePrices,
    showSalePrices: access.showSalePrices,
    showSalaries: access.showSalaries,
    userId,
    updatedBy,
    updatedAt: Date.now(),
  }
  if (existing) await ctx.db.patch(existing._id, details)
  else await ctx.db.insert("readerAccess", details)
}

export const createReaderAccount = mutation({
  args: {
    identifier: v.string(),
    name: v.string(),
    password: v.string(),
    access: readerAccessValidator,
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx)
    const identifier = normalizeAccountIdentifier(args.identifier)
    if (!isAccountIdentifier(identifier))
      throw new ConvexError("L’identifiant de connexion est invalide.")
    const result = await createAuth(ctx).api.createUser({
      body: {
        data: { username: identifier },
        email: internalAccountEmail(identifier),
        name: args.name.trim(),
        password: args.password,
        role: "reader",
      },
    })
    await storeReaderAccess(ctx, result.user.id, admin._id, args.access)
    await ctx.db.insert("auditLogs", {
      action: "account.created",
      actorUserId: admin._id,
      createdAt: Date.now(),
      entityType: "account",
      entityId: result.user.id,
      detail: identifier,
    })
    return { id: result.user.id }
  },
})

export const saveAccountAccess = mutation({
  args: {
    userId: v.string(),
    role: v.union(...accountRoles.map((role) => v.literal(role))),
    access: readerAccessValidator,
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx)
    const authContext = await createAuth(ctx).$context
    const target = await authContext.internalAdapter.findUserById(args.userId)
    if (!target) throw new ConvexError("Compte introuvable.")
    const users = (await authContext.internalAdapter.listUsers(
      200,
      0
    )) as AccountSecurityState[]
    if (!users.some((user) => user.id === target.id)) users.push(target)
    if (wouldRemoveLastActiveAdmin(users, args.userId, args.role !== "admin"))
      throw new ConvexError(
        "Le dernier administrateur actif ne peut pas être rétrogradé."
      )
    await storeReaderAccess(ctx, args.userId, admin._id, args.access)
    await authContext.internalAdapter.updateUser(args.userId, {
      role: args.role,
    })
    await ctx.db.insert("auditLogs", {
      action: "account.access_updated",
      actorUserId: admin._id,
      createdAt: Date.now(),
      entityType: "account",
      entityId: args.userId,
      detail: `${accountRoleLabels[args.role]} · ${args.access.sections.join(", ") || "aucune rubrique"} · prix ${args.access.showPrices ? "visibles" : "masqués"} · salaires ${args.access.showSalaries === false ? "masqués" : "visibles"} · stocks ${args.access.showStock ? "visibles" : "masqués"} · ${args.access.productIds === undefined ? "tous les produits" : `${args.access.productIds.length} produits`} · ${args.access.operationKinds.join(", ") || "aucune opération"}`,
    })
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
