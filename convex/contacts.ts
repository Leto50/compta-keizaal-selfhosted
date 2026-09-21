import { ConvexError, v } from "convex/values"

import { mutation, query, type MutationCtx } from "./_generated/server"
import { requireUser } from "./lib/auth"
import { contactIsActive } from "./lib/contacts"
import { normalizeName } from "./lib/text"

const MAX_NAME_LENGTH = 100

async function hasDuplicateName(
  ctx: MutationCtx,
  contactId: string,
  kind: "client" | "supplier",
  name: string
): Promise<boolean> {
  const normalizedName = normalizeName(name)
  const contacts = await ctx.db
    .query("contacts")
    .withIndex("by_kind", (index) => index.eq("kind", kind))
    .collect()
  return contacts.some(
    (contact) =>
      contact._id !== contactId &&
      (contact.normalizedName ?? normalizeName(contact.name)) === normalizedName
  )
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const contacts = await ctx.db.query("contacts").collect()
    return contacts
      .filter(contactIsActive)
      .sort(
        (left, right) =>
          left.kind.localeCompare(right.kind) ||
          left.name.localeCompare(right.name, "fr")
      )
  },
})

export const listForManagement = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const contacts = await ctx.db.query("contacts").collect()
    return contacts.sort(
      (left, right) =>
        Number(contactIsActive(right)) - Number(contactIsActive(left)) ||
        left.kind.localeCompare(right.kind) ||
        left.name.localeCompare(right.name, "fr")
    )
  },
})

export const rename = mutation({
  args: {
    contactId: v.id("contacts"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const contact = await ctx.db.get(args.contactId)
    if (!contact) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Contact introuvable.",
      })
    }
    const name = args.name.trim()
    if (!name || name.length > MAX_NAME_LENGTH) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `Le nom doit contenir entre 1 et ${MAX_NAME_LENGTH} caractères.`,
      })
    }
    if (await hasDuplicateName(ctx, contact._id, contact.kind, name)) {
      throw new ConvexError({
        code: "ALREADY_EXISTS",
        message: "Un contact de ce type portant ce nom existe déjà.",
      })
    }

    await ctx.db.patch(contact._id, {
      name,
      normalizedName: normalizeName(name),
    })
    await ctx.db.insert("auditLogs", {
      action: "contact.renamed",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: `${contact.name}->${name}`,
      entityId: contact._id,
      entityType: "contact",
    })
  },
})

export const setActive = mutation({
  args: {
    active: v.boolean(),
    contactId: v.id("contacts"),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const contact = await ctx.db.get(args.contactId)
    if (!contact) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Contact introuvable.",
      })
    }
    if (args.active) {
      if (
        await hasDuplicateName(ctx, contact._id, contact.kind, contact.name)
      ) {
        throw new ConvexError({
          code: "ALREADY_EXISTS",
          message: "Un contact actif de ce type porte déjà ce nom.",
        })
      }
    }

    await ctx.db.patch(contact._id, {
      active: args.active,
      normalizedName: contact.normalizedName ?? normalizeName(contact.name),
    })
    await ctx.db.insert("auditLogs", {
      action: args.active ? "contact.reactivated" : "contact.archived",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: contact.name,
      entityId: contact._id,
      entityType: "contact",
    })
  },
})
