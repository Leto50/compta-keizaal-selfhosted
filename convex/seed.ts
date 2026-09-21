import { ConvexError, v } from "convex/values"

import seedData from "../data/inventaire.seed.json"
import { type Doc, type Id } from "./_generated/dataModel"
import { mutation } from "./_generated/server"
import {
  isFinancialTransaction,
  rebuildAccountWeekSummaries,
} from "./lib/accountSummary"
import { rebuildInventorySummary } from "./lib/inventorySummary"
import { normalizeName } from "./lib/text"
import { buildTransactionSearchText } from "./lib/transactionSearch"
import { rebuildJournalSummary } from "./lib/journalSummary"
import { isLootOnlyLegacyProduct } from "./lib/products"
import { markReadModelsReady } from "./lib/readModels"
import { rebuildRecipeCostProjections } from "./lib/recipeCost"
import { canonicalRecipeFamily } from "./lib/recipeFamilies"
import {
  canonicalProductName,
  convertLegacyOperationsData,
  normalizeCatalogNamesData,
  repairRecipeReferencesData,
} from "./migrations"

const SEED_KEY = "workbook-seed-version"

function requireSeedSecret(candidate: string): void {
  const configuredSecret = process.env.SEED_SECRET
  if (!configuredSecret || candidate !== configuredSecret) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "L’import initial n’est pas autorisé.",
    })
  }
}

type ProductCategory = Doc<"products">["category"]
type TransactionKind = Doc<"transactions">["kind"]

function parseProductCategory(value: string): ProductCategory {
  switch (value) {
    case "annexe":
      return "potion"
    case "ingredient":
    case "potion":
    case "service":
      return value
    default:
      throw new ConvexError(`Catégorie de seed inconnue : ${value}`)
  }
}

function parseTransactionKind(value: string): TransactionKind {
  switch (value) {
    case "bundle":
    case "order":
    case "production":
    case "purchase":
    case "sale":
    case "service":
      return value
    default:
      throw new ConvexError(`Opération de seed inconnue : ${value}`)
  }
}

function productDelta(kind: TransactionKind, quantity: number): number {
  if (kind === "sale" || kind === "bundle") return -quantity
  if (kind === "purchase" || kind === "production") return quantity
  return 0
}

function contactKey(kind: "client" | "supplier", name: string): string {
  return `${kind}:${normalizeName(name)}`
}

export const importWorkbook = mutation({
  args: { seedSecret: v.string() },
  handler: async (ctx, args) => {
    requireSeedSecret(args.seedSecret)

    const existingSeed = await ctx.db
      .query("systemSettings")
      .withIndex("by_key", (index) => index.eq("key", SEED_KEY))
      .unique()
    if (existingSeed) {
      return {
        imported: false,
        message: "Le classeur a déjà été importé.",
      }
    }

    const products = new Map<
      string,
      { id: Id<"products">; name: string; tracksStock: boolean }
    >()
    for (const product of seedData.products) {
      const category = parseProductCategory(product.category)
      const id = await ctx.db.insert("products", {
        active: true,
        category,
        ...(category === "potion"
          ? { craftable: !isLootOnlyLegacyProduct(product.legacyKey) }
          : {}),
        currentStock: product.currentStock,
        legacyKey: product.legacyKey,
        minimumStock: product.minimumStock,
        name: product.name,
        normalizedName: product.normalizedName,
        ...(product.purchasePrice === undefined
          ? {}
          : { purchasePrice: product.purchasePrice }),
        ...(product.salePrice === undefined
          ? {}
          : { salePrice: product.salePrice }),
        tracksStock: product.tracksStock,
      })
      products.set(product.normalizedName, {
        id,
        name: product.name,
        tracksStock: product.tracksStock,
      })
    }

    const characters = new Map<string, Id<"characters">>()
    for (const character of seedData.characters) {
      const id = await ctx.db.insert("characters", {
        active: true,
        legacyKey: character.legacyKey,
        name: character.name,
      })
      characters.set(normalizeName(character.name), id)
    }

    const contacts = new Map<string, Id<"contacts">>()
    for (const contact of seedData.contacts) {
      const kind = contact.kind === "supplier" ? "supplier" : "client"
      const id = await ctx.db.insert("contacts", {
        active: true,
        kind,
        legacyKey: contact.legacyKey,
        name: contact.name,
        normalizedName: normalizeName(contact.name),
      })
      contacts.set(contactKey(kind, contact.name), id)
    }

    for (const transaction of seedData.transactions) {
      const kind = parseTransactionKind(transaction.kind)
      const product = products.get(normalizeName(transaction.productName))
      const characterId = characters.get(normalizeName(transaction.actorName))
      const transactionId = await ctx.db.insert("transactions", {
        ...(characterId ? { actorCharacterId: characterId } : {}),
        actorName: transaction.actorName,
        ...(transaction.comment ? { comment: transaction.comment } : {}),
        ...(transaction.counterparty
          ? { counterparty: transaction.counterparty }
          : {}),
        ...(transaction.discount === undefined
          ? {}
          : { discount: transaction.discount }),
        financial: isFinancialTransaction({ kind }),
        kind,
        legacyKey: transaction.legacyKey,
        occurredAt: transaction.occurredAt,
        ...(product ? { productId: product.id } : {}),
        productName: transaction.productName,
        quantity: transaction.quantity,
        searchText: buildTransactionSearchText(transaction),
        source: "workbook",
        total: transaction.total,
        ...(transaction.unitPrice === undefined
          ? {}
          : { unitPrice: transaction.unitPrice }),
      })

      if (product?.tracksStock) {
        const delta = productDelta(kind, transaction.quantity)
        if (delta !== 0) {
          await ctx.db.insert("stockMovements", {
            delta,
            occurredAt: transaction.occurredAt,
            productId: product.id,
            reason: kind,
            transactionId,
          })
        }
      }
    }

    for (const order of seedData.orders) {
      const kind = order.kind === "supplier" ? "supplier" : "client"
      const contactId = contacts.get(contactKey(kind, order.contactName))
      const orderId = await ctx.db.insert("orders", {
        ...(contactId ? { contactId } : {}),
        contactName: order.contactName,
        ...(order.dueAt === undefined ? {} : { dueAt: order.dueAt }),
        ...(order.dueLabel ? { dueLabel: order.dueLabel } : {}),
        kind,
        legacyKey: order.legacyKey,
        ...(order.notes ? { notes: order.notes } : {}),
        status: order.status === "delivered" ? "delivered" : "open",
        ...(order.total === undefined ? {} : { total: order.total }),
      })

      for (const line of order.lines) {
        const product = products.get(normalizeName(line.productName))
        const lineTotal = "total" in line ? line.total : undefined
        const unitPrice = "unitPrice" in line ? line.unitPrice : undefined
        await ctx.db.insert("orderLines", {
          legacyKey: line.legacyKey,
          orderId,
          ...(product ? { productId: product.id } : {}),
          productName: line.productName,
          quantity: line.quantity,
          ...(lineTotal === undefined ? {} : { total: lineTotal }),
          ...(unitPrice === undefined ? {} : { unitPrice }),
        })
      }
    }

    for (const recipe of seedData.recipes) {
      const product = products.get(canonicalProductName(recipe.name))
      if (!product?.tracksStock) {
        throw new ConvexError({
          code: "SEED_REFERENCE_MISSING",
          message: `La recette « ${recipe.name} » ne correspond à aucun article fabriqué.`,
        })
      }
      const family = canonicalRecipeFamily(recipe.family)
      if (!family) {
        throw new ConvexError({
          code: "SEED_REFERENCE_MISSING",
          message: `La catégorie « ${recipe.family} » de la recette « ${recipe.name} » est inconnue.`,
        })
      }
      await ctx.db.patch(product.id, { craftable: true })
      const recipeId = await ctx.db.insert("recipes", {
        active: true,
        ...(recipe.cost === undefined ? {} : { cost: recipe.cost }),
        ...(recipe.effect ? { effect: recipe.effect } : {}),
        family,
        legacyKey: recipe.legacyKey,
        name: product.name,
        productId: product.id,
      })
      for (const ingredient of recipe.ingredients) {
        const ingredientProduct = products.get(
          canonicalProductName(ingredient.ingredientName)
        )
        if (!ingredientProduct?.tracksStock) {
          throw new ConvexError({
            code: "SEED_REFERENCE_MISSING",
            message: `L’ingrédient « ${ingredient.ingredientName} » est introuvable.`,
          })
        }
        await ctx.db.insert("recipeIngredients", {
          ingredientName: ingredientProduct.name,
          legacyKey: ingredient.legacyKey,
          productId: ingredientProduct.id,
          quantity: ingredient.quantity,
          raw: `${ingredient.quantity} ${ingredientProduct.name}`,
          recipeId,
        })
      }
    }

    for (const bundle of seedData.bundles) {
      const bundleId = await ctx.db.insert("bundles", {
        active: true,
        legacyKey: bundle.legacyKey,
        name: bundle.name,
        ...(bundle.price === undefined ? {} : { price: bundle.price }),
      })
      for (const item of bundle.items) {
        const product = products.get(normalizeName(item.productName))
        await ctx.db.insert("bundleItems", {
          bundleId,
          legacyKey: item.legacyKey,
          ...(product ? { productId: product.id } : {}),
          productName: item.productName,
          quantity: item.quantity,
        })
      }
    }

    const migration = await convertLegacyOperationsData(ctx)
    const recipeMigration = await repairRecipeReferencesData(ctx)
    const catalogNamesMigration = await normalizeCatalogNamesData(ctx)
    await rebuildRecipeCostProjections(ctx)
    await rebuildJournalSummary(ctx)
    await rebuildAccountWeekSummaries(ctx)
    await rebuildInventorySummary(ctx)
    await markReadModelsReady(ctx)

    const updatedAt = Date.parse(seedData.metadata.sourceModifiedAt)
    await ctx.db.insert("systemSettings", {
      key: SEED_KEY,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
      value: String(seedData.metadata.schemaVersion),
    })

    return {
      imported: true,
      catalogNamesMigration,
      message: "Les données ont été initialisées depuis le classeur.",
      migration,
      recipeMigration,
      stats: seedData.metadata.stats,
    }
  },
})
