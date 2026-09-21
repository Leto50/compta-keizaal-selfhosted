import { ConvexError } from "convex/values"

import { type Doc, type Id } from "../_generated/dataModel"
import { type MutationCtx } from "../_generated/server"
import { normalizeName } from "./text"

export function contactIsActive(contact: Doc<"contacts">): boolean {
  return contact.active !== false
}

export async function findContactByName(
  ctx: MutationCtx,
  kind: Doc<"contacts">["kind"],
  name: string
): Promise<Doc<"contacts"> | undefined> {
  const normalizedName = normalizeName(name)
  const indexedContacts = await ctx.db
    .query("contacts")
    .withIndex("by_kind_and_normalized_name", (index) =>
      index.eq("kind", kind).eq("normalizedName", normalizedName)
    )
    .collect()
  const indexedContact = indexedContacts.find(contactIsActive)
  if (indexedContact) return indexedContact
  if (indexedContacts[0]) return indexedContacts[0]

  const legacyContacts = await ctx.db
    .query("contacts")
    .withIndex("by_kind", (index) => index.eq("kind", kind))
    .collect()
  return legacyContacts.find(
    (contact) => normalizeName(contact.name) === normalizedName
  )
}

export async function resolveOrderContact(
  ctx: MutationCtx,
  args: {
    contactId?: Id<"contacts">
    existingOrder?: Doc<"orders">
    kind: Doc<"orders">["kind"]
    name: string
  }
): Promise<{ contactId: Id<"contacts">; contactName: string }> {
  const submittedName = args.name.trim()
  const normalizedName = normalizeName(submittedName)
  const contact = args.contactId
    ? await ctx.db.get(args.contactId)
    : await findContactByName(ctx, args.kind, submittedName)

  if (args.contactId && !contact) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Contact introuvable.",
    })
  }
  if (contact && contact.kind !== args.kind) {
    throw new ConvexError({
      code: "INVALID_REFERENCE",
      message: "Ce contact ne correspond pas au type de commande.",
    })
  }

  if (contact) {
    const contactName = contact.normalizedName ?? normalizeName(contact.name)
    const reusesHistoricalName =
      args.existingOrder?.contactId === contact._id &&
      args.existingOrder.kind === args.kind &&
      normalizeName(args.existingOrder.contactName) === normalizedName
    if (normalizedName !== contactName && !reusesHistoricalName) {
      throw new ConvexError({
        code: "INVALID_REFERENCE",
        message: "Le nom saisi ne correspond pas au contact sélectionné.",
      })
    }
    if (!contactIsActive(contact) && !reusesHistoricalName) {
      throw new ConvexError({
        code: "CONTACT_ARCHIVED",
        message:
          "Ce contact est archivé. Réactivez-le avant de l’utiliser dans une nouvelle commande.",
      })
    }
    return {
      contactId: contact._id,
      contactName: reusesHistoricalName ? submittedName : contact.name,
    }
  }

  const contactId = await ctx.db.insert("contacts", {
    active: true,
    kind: args.kind,
    name: submittedName,
    normalizedName,
  })
  return { contactId, contactName: submittedName }
}
