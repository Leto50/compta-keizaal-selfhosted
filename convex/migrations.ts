import { ConvexError } from "convex/values"

import seedData from "../data/inventaire.seed.json"
import { type Doc, type Id } from "./_generated/dataModel"
import { internalMutation, type MutationCtx } from "./_generated/server"
import {
  isFinancialTransaction,
  rebuildAccountWeekSummaries,
} from "./lib/accountSummary"
import { rebuildInventorySummary } from "./lib/inventorySummary"
import { roundSeptimsDown } from "./lib/numbers"
import { orderTransactionLabel } from "./lib/order"
import {
  canonicalProductCategory,
  isLootOnlyLegacyProduct,
} from "./lib/products"
import {
  calculateRecipeCost,
  rebuildRecipeCostProjections,
} from "./lib/recipeCost"
import { markReadModelsReady, readModelsAreReady } from "./lib/readModels"
import { canonicalRecipeFamily } from "./lib/recipeFamilies"
import { normalizeCatalogName, normalizeName } from "./lib/text"
import { buildTransactionSearchText } from "./lib/transactionSearch"
import { rebuildJournalSummary as rebuildJournalSummaryData } from "./lib/journalSummary"

const CATALOG_NAMES_MIGRATION_KEY = "catalog-names-v1"
const EXCHANGE_MIGRATION_KEY = "exchange-model-v5"
const CONTACTS_MIGRATION_KEY = "contacts-v1"
const PRODUCT_CATEGORY_MIGRATION_KEY = "product-categories-v1"
const PRODUCT_CRAFTABILITY_MIGRATION_KEY = "product-craftability-v1"
const RECIPE_FAMILY_MIGRATION_KEY = "recipe-families-v1"
const RECIPE_REFERENCE_MIGRATION_KEY = "recipe-references-v1"
const TRANSACTION_SEARCH_MIGRATION_KEY = "transaction-search-v1"
const WORKBOOK_TRANSACTIONS_MIGRATION_KEY =
  "workbook-transactions-2026-08-31-v1"

function assertUniqueCatalogNames(
  entries: readonly { id: string; name: string }[],
  entityLabel: string
) {
  const entriesByName = new Map<string, Array<{ id: string; name: string }>>()
  for (const entry of entries) {
    const normalizedName = normalizeName(entry.name)
    entriesByName.set(normalizedName, [
      ...(entriesByName.get(normalizedName) ?? []),
      entry,
    ])
  }
  const duplicate = [...entriesByName.values()].find(
    (matchingEntries) => matchingEntries.length > 1
  )
  if (duplicate) {
    throw new ConvexError({
      code: "MIGRATION_NAME_COLLISION",
      message: `${entityLabel} en conflit : ${duplicate
        .map((entry) => `« ${entry.name} »`)
        .join(", ")}.`,
    })
  }
}

const productAliases: Readonly<Record<string, string>> = {
  "breuvage mana accru": "breuvage magie accrue",
  "breuvage resistance magie": "breuvage resistance magique",
  "breuvage vigueur accru": "breuvage vigueur amelioree",
  "breuvage de vigueur amelioree": "breuvage vigueur amelioree",
  "breuvages de recuperation": "breuvage recuperation",
  "breuvages de vigueur amelioree": "breuvage vigueur amelioree",
  "breuvages du guerrier": "breuvage guerrier",
  "breuvages du guerisseur": "breuvage guerisseur",
  chardon: "tige de chardon",
  "gemme spirituelle insignifiante": "gemme insignifiante",
  genievre: "genievres",
  "griffes d ours": "griffe d ours",
  hydromel: "hydromelle",
  hyvernelle: "hivernelle",
  lichen: "lichen geant",
  medicinal: "medicinale",
  "oeuf fauvette": "oeuf de fauvette",
  "oreille elfe": "oreilles d elfes",
  "plantes grimpantes": "plante grimpante",
  "potion mana accru": "potion magie accrue",
  "potion de pied leger": "pied leger",
  "potion de recuperation": "potion recuperation",
  "potion de soin": "soin moyen",
  "potion de soin mineur": "soin mineur",
  "potion de soin profuse": "soin profus",
  "potion medicinale": "medicinale",
  "potion resistance magie": "potion resistance magique",
  "potion vigueur accru": "potion vigueur amelioree",
  "potions de berserker": "potion berserker",
  "potions de pied leger": "pied leger",
  "potions de puissance durable": "potion puissance durable",
  "potions de resistance magique": "potion resistance magique",
  "potions de soin mineur": "soin mineur",
  "potions de soin moyenne": "soin moyen",
  "potions medicinale": "medicinale",
  "potions medicinales": "medicinale",
  "racine canis": "racine de canis",
  raisin: "raisin jasbay",
  "raisin de jazbai": "raisin jasbay",
  "sel du neant": "sel de neant",
  "sel feu": "sel de feu",
  "sel givre": "sel de givre",
  "sel neant": "sel de neant",
}

const bundleAliases: Readonly<Record<string, string>> = {
  "l aventurier debutant": "l aventurier en herbe",
}

interface LegacyOrderLine {
  productName: string
  quantity: number
  unitPrice: number
}

const legacyOrderLines: Readonly<Record<string, readonly LegacyOrderLine[]>> = {
  "transaction:10": [
    { productName: "Médicinale", quantity: 5, unitPrice: 12 },
    { productName: "Soin Mineur", quantity: 10, unitPrice: 12 },
    { productName: "Soin Moyen", quantity: 5, unitPrice: 17 },
    { productName: "Potion Récupération", quantity: 5, unitPrice: 17 },
  ],
  "transaction:19": [{ productName: "Blé", quantity: 800, unitPrice: 1 / 2 }],
  "transaction:20": [
    { productName: "Raisin jasbay", quantity: 1200, unitPrice: 5 / 24 },
    { productName: "Rayon de miel", quantity: 50, unitPrice: 3 },
  ],
  "transaction:50": [
    { productName: "Soin Mineur", quantity: 50, unitPrice: 12 },
    { productName: "Soin Moyen", quantity: 40, unitPrice: 17 },
    { productName: "Soin Profus", quantity: 15, unitPrice: 25 },
  ],
  "transaction:53": [
    { productName: "Lys bleu", quantity: 2000, unitPrice: 1 / 10 },
  ],
  "transaction:54": [
    { productName: "Bière", quantity: 150, unitPrice: 10 / 3 },
    { productName: "Vin", quantity: 150, unitPrice: 4 },
  ],
  "transaction:60": [
    { productName: "Médicinale", quantity: 10, unitPrice: 11 },
    { productName: "Soin Mineur", quantity: 30, unitPrice: 12 },
    { productName: "Soin Moyen", quantity: 20, unitPrice: 17 },
    { productName: "Soin Profus", quantity: 5, unitPrice: 25 },
  ],
  "transaction:70": [
    { productName: "Médicinale", quantity: 25, unitPrice: 11 },
    { productName: "Soin Mineur", quantity: 25, unitPrice: 12 },
    { productName: "Tige de Chardon", quantity: 300, unitPrice: 0 },
  ],
  "transaction:89": [
    { productName: "Raisin jasbay", quantity: 1200, unitPrice: 1 / 5 },
  ],
  "transaction:9": [
    { productName: "Bière", quantity: 150, unitPrice: 10 / 3 },
    { productName: "Vin", quantity: 50, unitPrice: 4 },
  ],
  "transaction:97": [{ productName: "Blé", quantity: 800, unitPrice: 1 / 2 }],
}

const legacyOrderLinks: Readonly<Record<string, string>> = {
  "transaction:10": "order:client:zahreen-350-debut-de-semaine",
  "transaction:53": "order:supplier:mordred-14",
  "transaction:54": "order:client:jahim-al-suna-1100-debut-de-semaine",
  "transaction:60":
    "order:client:garde-de-solitude-935-reduit-a-800-livre-le-11-08-26",
  "transaction:89": "order:supplier:gue-du-sombreflot-11",
}

interface PreparedLegacyLine {
  bundleId?: Id<"bundles">
  direction: "incoming" | "outgoing"
  kind: "bundle" | "product"
  productId?: Id<"products">
  productName: string
  quantity: number
  total: number
  unitPrice: number
}

function reconcileLegacyAmounts(
  lines: PreparedLegacyLine[],
  transaction: Doc<"transactions">
): number {
  const direction = transactionDirection(transaction)
  const targetTotal = Math.abs(transaction.total)
  const gross = lines.reduce((sum, line) => sum + line.total, 0)
  const firstLine = lines[0]

  if (!firstLine) {
    throw new ConvexError("Une opération convertie doit avoir une ligne.")
  }
  if (direction === "incoming") {
    if (roundSeptimsDown(gross) !== targetTotal) {
      firstLine.unitPrice += (targetTotal - gross) / firstLine.quantity
      firstLine.total = firstLine.quantity * firstLine.unitPrice
    }
    return 0
  }

  const originalDiscount = transaction.discount ?? 0
  if (roundSeptimsDown(gross - originalDiscount) === targetTotal) {
    return originalDiscount
  }
  if (roundSeptimsDown(gross) === targetTotal) {
    return 0
  }
  if (gross > targetTotal) {
    return gross - targetTotal
  }

  firstLine.unitPrice += (targetTotal - gross) / firstLine.quantity
  firstLine.total = firstLine.quantity * firstLine.unitPrice
  return 0
}

export function canonicalProductName(value: string): string {
  const normalized = normalizeName(value)
  return productAliases[normalized] ?? normalized
}

function canonicalBundleName(value: string): string {
  const normalized = normalizeName(value)
  return bundleAliases[normalized] ?? normalized
}

function requireProduct(
  products: ReadonlyMap<string, Doc<"products">>,
  name: string
): Doc<"products"> {
  const product = products.get(canonicalProductName(name))
  if (product) return product
  throw new ConvexError({
    code: "MIGRATION_REFERENCE_MISSING",
    message: `La référence historique « ${name} » ne correspond à aucun produit.`,
  })
}

function requireBundle(
  bundles: ReadonlyMap<string, Doc<"bundles">>,
  name: string
): Doc<"bundles"> {
  const bundle = bundles.get(canonicalBundleName(name))
  if (bundle) return bundle
  throw new ConvexError({
    code: "MIGRATION_REFERENCE_MISSING",
    message: `Le lot historique « ${name} » est introuvable.`,
  })
}

function transactionDirection(
  transaction: Doc<"transactions">
): "incoming" | "outgoing" {
  return transaction.kind === "purchase" || transaction.total < 0
    ? "incoming"
    : "outgoing"
}

async function prepareTransactionLines(
  ctx: MutationCtx,
  transaction: Doc<"transactions">,
  products: ReadonlyMap<string, Doc<"products">>,
  bundles: ReadonlyMap<string, Doc<"bundles">>
): Promise<PreparedLegacyLine[]> {
  const direction = transactionDirection(transaction)
  if (transaction.kind === "order") {
    const specs = transaction.legacyKey
      ? legacyOrderLines[transaction.legacyKey]
      : undefined
    if (!specs) {
      const product = requireProduct(products, transaction.productName)
      const unitPrice =
        Math.abs(transaction.total) / Math.max(1, transaction.quantity)
      return [
        {
          direction,
          kind: "product",
          productId: product._id,
          productName: product.name,
          quantity: transaction.quantity,
          total: Math.abs(transaction.total),
          unitPrice,
        },
      ]
    }
    return specs.map((spec) => {
      const product = requireProduct(products, spec.productName)
      return {
        direction,
        kind: "product" as const,
        productId: product._id,
        productName: product.name,
        quantity: spec.quantity,
        total: spec.quantity * spec.unitPrice,
        unitPrice: spec.unitPrice,
      }
    })
  }

  if (transaction.kind === "bundle") {
    const bundle = requireBundle(bundles, transaction.productName)
    const unitPrice = Math.abs(transaction.total) / transaction.quantity
    return [
      {
        bundleId: bundle._id,
        direction: "outgoing",
        kind: "bundle",
        productName: bundle.name,
        quantity: transaction.quantity,
        total: Math.abs(transaction.total),
        unitPrice,
      },
    ]
  }

  const product = transaction.productId
    ? await ctx.db.get(transaction.productId)
    : requireProduct(products, transaction.productName)
  if (!product) {
    throw new ConvexError({
      code: "MIGRATION_REFERENCE_MISSING",
      message: `Le produit de ${transaction.legacyKey ?? transaction._id} est introuvable.`,
    })
  }
  const unitPrice =
    transaction.unitPrice ??
    Math.abs(transaction.total) / Math.max(1, transaction.quantity)
  return [
    {
      direction,
      kind: "product",
      productId: product._id,
      productName: product.name,
      quantity: transaction.quantity,
      total: transaction.quantity * unitPrice,
      unitPrice,
    },
  ]
}

async function movementDeltasForLines(
  ctx: MutationCtx,
  lines: readonly PreparedLegacyLine[]
): Promise<Map<string, { delta: number; product: Doc<"products"> }>> {
  const deltas = new Map<string, { delta: number; product: Doc<"products"> }>()
  const add = (product: Doc<"products">, delta: number) => {
    const current = deltas.get(product._id)
    deltas.set(product._id, {
      delta: (current?.delta ?? 0) + delta,
      product,
    })
  }

  for (const line of lines) {
    if (line.kind === "product" && line.productId) {
      const product = await ctx.db.get(line.productId)
      if (product?.tracksStock) {
        add(
          product,
          line.direction === "incoming" ? line.quantity : -line.quantity
        )
      }
      continue
    }
    if (!line.bundleId) continue
    const items = await ctx.db
      .query("bundleItems")
      .withIndex("by_bundle", (index) => index.eq("bundleId", line.bundleId!))
      .collect()
    for (const item of items) {
      if (!item.productId) {
        throw new ConvexError({
          code: "MIGRATION_REFERENCE_MISSING",
          message: `Le composant « ${item.productName} » n’est pas relié.`,
        })
      }
      const product = await ctx.db.get(item.productId)
      if (!product?.tracksStock) {
        throw new ConvexError({
          code: "MIGRATION_REFERENCE_MISSING",
          message: `Le composant « ${item.productName} » est indisponible.`,
        })
      }
      add(product, -(item.quantity * line.quantity))
    }
  }
  return deltas
}

export async function repairRecipeReferencesData(ctx: MutationCtx) {
  const existingMigration = await ctx.db
    .query("systemSettings")
    .withIndex("by_key", (index) =>
      index.eq("key", RECIPE_REFERENCE_MIGRATION_KEY)
    )
    .unique()
  if (existingMigration) {
    return {
      repaired: false,
      message: "Les références des recettes sont déjà normalisées.",
    }
  }

  const initialProducts = await ctx.db.query("products").collect()
  const products = new Map(
    initialProducts.map((product) => [product.normalizedName, product])
  )
  let createdProducts = 0
  if (!products.has(normalizeName("Sucrelune"))) {
    const productId = await ctx.db.insert("products", {
      active: true,
      category: "ingredient",
      currentStock: 0,
      legacyKey: "product:sucrelune",
      minimumStock: 50,
      name: "Sucrelune",
      normalizedName: normalizeName("Sucrelune"),
      tracksStock: true,
    })
    const product = await ctx.db.get(productId)
    if (product) products.set(product.normalizedName, product)
    createdProducts += 1
  }

  const productsById = new Map(
    [...products.values()].map((product) => [product._id, product])
  )
  const ingredients = await ctx.db.query("recipeIngredients").collect()
  const resolvedIngredientProducts = new Map<string, Id<"products">>()
  let linkedIngredients = 0
  for (const ingredient of ingredients) {
    const product =
      (ingredient.productId
        ? productsById.get(ingredient.productId)
        : undefined) ?? requireProduct(products, ingredient.ingredientName)
    resolvedIngredientProducts.set(ingredient._id, product._id)
    if (
      ingredient.productId !== product._id ||
      ingredient.ingredientName !== product.name
    ) {
      await ctx.db.patch(ingredient._id, {
        ingredientName: product.name,
        productId: product._id,
        raw: `${ingredient.quantity} ${product.name}`,
      })
      linkedIngredients += 1
    }
  }

  const recipes = await ctx.db.query("recipes").collect()
  let linkedRecipes = 0
  let pricedRecipes = 0
  for (const recipe of recipes) {
    const product =
      (recipe.productId ? productsById.get(recipe.productId) : undefined) ??
      requireProduct(products, recipe.name)
    const recipeIngredients = ingredients
      .filter((ingredient) => ingredient.recipeId === recipe._id)
      .map((ingredient) => ({
        ...ingredient,
        productId: resolvedIngredientProducts.get(ingredient._id),
      }))
    const { cost } = calculateRecipeCost(recipeIngredients, productsById)
    const family =
      normalizeName(recipe.family) === normalizeName(recipe.name)
        ? product.name
        : recipe.family
    await ctx.db.patch(recipe._id, {
      cost,
      family,
      name: product.name,
      productId: product._id,
    })
    if (cost !== undefined) pricedRecipes += 1
    if (recipe.productId !== product._id || recipe.name !== product.name) {
      linkedRecipes += 1
    }
  }

  const result = {
    createdProducts,
    linkedIngredients,
    linkedRecipes,
    pricedRecipes,
    repaired: true,
  }
  await ctx.db.insert("systemSettings", {
    key: RECIPE_REFERENCE_MIGRATION_KEY,
    updatedAt: Date.now(),
    value: JSON.stringify(result),
  })
  return result
}

export async function reclassifyAnnexePotionsData(ctx: MutationCtx) {
  const existingMigration = await ctx.db
    .query("systemSettings")
    .withIndex("by_key", (index) =>
      index.eq("key", PRODUCT_CATEGORY_MIGRATION_KEY)
    )
    .unique()
  if (existingMigration) {
    return {
      reclassified: false,
      message: "Les catégories des potions sont déjà normalisées.",
    }
  }

  const products = await ctx.db
    .query("products")
    .withIndex("by_category", (index) => index.eq("category", "annexe"))
    .collect()
  await Promise.all(
    products.map((product) =>
      ctx.db.patch(product._id, { category: "potion" as const })
    )
  )

  const result = {
    reclassified: true,
    reclassifiedProducts: products.length,
  }
  await ctx.db.insert("systemSettings", {
    key: PRODUCT_CATEGORY_MIGRATION_KEY,
    updatedAt: Date.now(),
    value: JSON.stringify(result),
  })
  return result
}

export async function classifyPotionCraftabilityData(ctx: MutationCtx) {
  const existingMigration = await ctx.db
    .query("systemSettings")
    .withIndex("by_key", (index) =>
      index.eq("key", PRODUCT_CRAFTABILITY_MIGRATION_KEY)
    )
    .unique()
  if (existingMigration) {
    return {
      classified: false,
      message: "Le mode d’obtention des potions est déjà renseigné.",
    }
  }

  const products = await ctx.db.query("products").collect()
  const potions = products.filter(
    (product) => canonicalProductCategory(product.category) === "potion"
  )
  let lootOnlyProducts = 0
  for (const product of potions) {
    const craftable =
      product.category !== "annexe" &&
      !isLootOnlyLegacyProduct(product.legacyKey)
    await ctx.db.patch(product._id, { craftable })
    if (!craftable) lootOnlyProducts += 1
  }

  const result = {
    classified: true,
    craftableProducts: potions.length - lootOnlyProducts,
    lootOnlyProducts,
  }
  await ctx.db.insert("systemSettings", {
    key: PRODUCT_CRAFTABILITY_MIGRATION_KEY,
    updatedAt: Date.now(),
    value: JSON.stringify(result),
  })
  return result
}

export async function normalizeCatalogNamesData(ctx: MutationCtx) {
  const existingMigration = await ctx.db
    .query("systemSettings")
    .withIndex("by_key", (index) =>
      index.eq("key", CATALOG_NAMES_MIGRATION_KEY)
    )
    .unique()
  if (existingMigration) {
    return {
      normalized: false,
      message: "Les noms du catalogue sont déjà normalisés.",
    }
  }

  const [products, recipes, bundles, recipeIngredients, bundleItems] =
    await Promise.all([
      ctx.db.query("products").collect(),
      ctx.db.query("recipes").collect(),
      ctx.db.query("bundles").collect(),
      ctx.db.query("recipeIngredients").collect(),
      ctx.db.query("bundleItems").collect(),
    ])
  const productNames = new Map(
    products.map((product) => [product._id, normalizeCatalogName(product.name)])
  )
  const recipeNames = new Map(
    recipes.map((recipe) => [
      recipe._id,
      (recipe.productId && productNames.get(recipe.productId)) ??
        normalizeCatalogName(recipe.name),
    ])
  )
  const bundleNames = new Map(
    bundles.map((bundle) => [bundle._id, normalizeCatalogName(bundle.name)])
  )

  assertUniqueCatalogNames(
    products.map((product) => ({
      id: product._id,
      name: productNames.get(product._id)!,
    })),
    "Références"
  )
  assertUniqueCatalogNames(
    recipes.map((recipe) => ({
      id: recipe._id,
      name: recipeNames.get(recipe._id)!,
    })),
    "Recettes"
  )
  assertUniqueCatalogNames(
    bundles.map((bundle) => ({
      id: bundle._id,
      name: bundleNames.get(bundle._id)!,
    })),
    "Lots"
  )

  let normalizedProducts = 0
  for (const product of products) {
    const name = productNames.get(product._id)!
    const normalizedName = normalizeName(name)
    if (product.name !== name || product.normalizedName !== normalizedName) {
      await ctx.db.patch(product._id, { name, normalizedName })
      normalizedProducts += 1
    }
  }

  let normalizedRecipes = 0
  for (const recipe of recipes) {
    const name = recipeNames.get(recipe._id)!
    if (recipe.name !== name) {
      await ctx.db.patch(recipe._id, { name })
      normalizedRecipes += 1
    }
  }

  let normalizedIngredients = 0
  for (const ingredient of recipeIngredients) {
    const ingredientName =
      (ingredient.productId && productNames.get(ingredient.productId)) ??
      normalizeCatalogName(ingredient.ingredientName)
    const raw = `${ingredient.quantity} ${ingredientName}`
    if (
      ingredient.ingredientName !== ingredientName ||
      ingredient.raw !== raw
    ) {
      await ctx.db.patch(ingredient._id, { ingredientName, raw })
      normalizedIngredients += 1
    }
  }

  let normalizedBundles = 0
  for (const bundle of bundles) {
    const name = bundleNames.get(bundle._id)!
    if (bundle.name !== name) {
      await ctx.db.patch(bundle._id, { name })
      normalizedBundles += 1
    }
  }

  let normalizedBundleItems = 0
  for (const item of bundleItems) {
    const productName =
      (item.productId && productNames.get(item.productId)) ??
      normalizeCatalogName(item.productName)
    if (item.productName !== productName) {
      await ctx.db.patch(item._id, { productName })
      normalizedBundleItems += 1
    }
  }

  const result = {
    normalized: true,
    normalizedBundleItems,
    normalizedBundles,
    normalizedIngredients,
    normalizedProducts,
    normalizedRecipes,
  }
  await ctx.db.insert("systemSettings", {
    key: CATALOG_NAMES_MIGRATION_KEY,
    updatedAt: Date.now(),
    value: JSON.stringify(result),
  })
  return result
}

export async function normalizeRecipeFamiliesData(ctx: MutationCtx) {
  const existingMigration = await ctx.db
    .query("systemSettings")
    .withIndex("by_key", (index) =>
      index.eq("key", RECIPE_FAMILY_MIGRATION_KEY)
    )
    .unique()
  if (existingMigration) {
    return {
      normalized: false,
      message: "Les catégories des recettes sont déjà normalisées.",
    }
  }

  const recipes = await ctx.db.query("recipes").collect()
  const prepared = recipes.map((recipe) => ({
    family: canonicalRecipeFamily(recipe.family),
    recipe,
  }))
  const unknownFamilies = [
    ...new Set(
      prepared.flatMap(({ family, recipe }) => (family ? [] : [recipe.family]))
    ),
  ].sort((left, right) => left.localeCompare(right, "fr"))
  if (unknownFamilies.length > 0) {
    throw new ConvexError({
      code: "MIGRATION_REFERENCE_MISSING",
      message: `Catégories de recettes inconnues : ${unknownFamilies.join(", ")}.`,
    })
  }

  let normalizedRecipes = 0
  for (const { family, recipe } of prepared) {
    if (family && family !== recipe.family) {
      await ctx.db.patch(recipe._id, { family })
      normalizedRecipes += 1
    }
  }

  const result = { normalized: true, normalizedRecipes }
  await ctx.db.insert("systemSettings", {
    key: RECIPE_FAMILY_MIGRATION_KEY,
    updatedAt: Date.now(),
    value: JSON.stringify(result),
  })
  return result
}

export async function indexTransactionSearchData(ctx: MutationCtx) {
  const existingMigration = await ctx.db
    .query("systemSettings")
    .withIndex("by_key", (index) =>
      index.eq("key", TRANSACTION_SEARCH_MIGRATION_KEY)
    )
    .unique()
  if (existingMigration) {
    return {
      indexed: false,
      message: "La recherche du journal est déjà indexée.",
    }
  }

  const transactions = await ctx.db.query("transactions").collect()
  let indexedTransactions = 0
  for (const transaction of transactions) {
    const searchText = buildTransactionSearchText(transaction)
    if (transaction.searchText !== searchText) {
      await ctx.db.patch(transaction._id, { searchText })
      indexedTransactions += 1
    }
  }
  const result = { indexed: true, indexedTransactions }
  await ctx.db.insert("systemSettings", {
    key: TRANSACTION_SEARCH_MIGRATION_KEY,
    updatedAt: Date.now(),
    value: JSON.stringify(result),
  })
  return result
}

export async function normalizeContactsData(ctx: MutationCtx) {
  const existingMigration = await ctx.db
    .query("systemSettings")
    .withIndex("by_key", (index) => index.eq("key", CONTACTS_MIGRATION_KEY))
    .unique()
  if (existingMigration) {
    return {
      normalized: false,
      message: "Les contacts sont déjà normalisés.",
    }
  }

  const [contacts, orders] = await Promise.all([
    ctx.db.query("contacts").collect(),
    ctx.db.query("orders").collect(),
  ])
  const groups = new Map<string, Array<Doc<"contacts">>>()
  for (const contact of contacts) {
    const key = `${contact.kind}:${normalizeName(contact.name)}`
    groups.set(key, [...(groups.get(key) ?? []), contact])
  }

  let mergedContacts = 0
  let normalizedContacts = 0
  let rewiredOrders = 0
  for (const group of groups.values()) {
    const sorted = [...group].sort(
      (left, right) =>
        Number(right.active !== false) - Number(left.active !== false) ||
        Number(Boolean(right.legacyKey)) - Number(Boolean(left.legacyKey)) ||
        left._creationTime - right._creationTime
    )
    const canonical = sorted[0]
    if (!canonical) continue
    const normalizedName = normalizeName(canonical.name)
    const active = group.some((contact) => contact.active !== false)
    if (
      canonical.active !== active ||
      canonical.normalizedName !== normalizedName
    ) {
      await ctx.db.patch(canonical._id, { active, normalizedName })
      normalizedContacts += 1
    }

    for (const duplicate of sorted.slice(1)) {
      for (const order of orders) {
        if (order.contactId !== duplicate._id) continue
        await ctx.db.patch(order._id, { contactId: canonical._id })
        rewiredOrders += 1
      }
      await ctx.db.delete(duplicate._id)
      mergedContacts += 1
    }
  }

  const result = {
    mergedContacts,
    normalized: true,
    normalizedContacts,
    rewiredOrders,
  }
  await ctx.db.insert("systemSettings", {
    key: CONTACTS_MIGRATION_KEY,
    updatedAt: Date.now(),
    value: JSON.stringify(result),
  })
  return result
}

export async function normalizeSupplierOrderStatusesData(ctx: MutationCtx) {
  const readySupplierOrders = await ctx.db
    .query("orders")
    .withIndex("by_kind_and_status", (index) =>
      index.eq("kind", "supplier").eq("status", "ready")
    )
    .collect()
  await Promise.all(
    readySupplierOrders.map((order) =>
      ctx.db.patch(order._id, { status: "open" as const })
    )
  )
  return { normalizedOrders: readySupplierOrders.length }
}

export async function convertLegacyOperationsData(ctx: MutationCtx) {
  const existingMigration = await ctx.db
    .query("systemSettings")
    .withIndex("by_key", (index) => index.eq("key", EXCHANGE_MIGRATION_KEY))
    .unique()
  if (existingMigration) {
    return {
      converted: false,
      message: "Les opérations historiques sont déjà converties.",
    }
  }

  const initialProducts = await ctx.db.query("products").collect()
  const initialStocks = new Map(
    initialProducts.map((product) => [product._id, product.currentStock])
  )
  const products = new Map(
    initialProducts.map((product) => [product.normalizedName, product])
  )
  if (!products.has(normalizeName("Location table étranger"))) {
    const productId = await ctx.db.insert("products", {
      active: true,
      category: "service",
      currentStock: 0,
      minimumStock: 0,
      name: "Location table étranger",
      normalizedName: normalizeName("Location table étranger"),
      salePrice: 20,
      tracksStock: false,
    })
    const product = await ctx.db.get(productId)
    if (product) products.set(product.normalizedName, product)
  }

  const bundlesList = await ctx.db.query("bundles").collect()
  const bundles = new Map(
    bundlesList.map((bundle) => [normalizeName(bundle.name), bundle])
  )
  const bundleItems = await ctx.db.query("bundleItems").collect()
  let linkedBundleItems = 0
  for (const item of bundleItems) {
    if (item.productId) continue
    const product = requireProduct(products, item.productName)
    await ctx.db.patch(item._id, {
      productId: product._id,
      productName: product.name,
    })
    linkedBundleItems += 1
  }

  const orderLines = await ctx.db.query("orderLines").collect()
  let linkedOrderLines = 0
  for (const line of orderLines) {
    if (line.productId || line.bundleId) continue
    const product = requireProduct(products, line.productName)
    await ctx.db.patch(line._id, {
      kind: "product",
      productId: product._id,
      productName: product.name,
    })
    linkedOrderLines += 1
  }

  const orders = await ctx.db.query("orders").collect()
  const ordersByLegacyKey = new Map(
    orders.flatMap((order) =>
      order.legacyKey ? [[order.legacyKey, order] as const] : []
    )
  )
  const transactions = await ctx.db.query("transactions").collect()
  let convertedTransactions = 0
  let insertedMovements = 0

  for (const transaction of transactions) {
    if (
      !transaction.legacyKey ||
      transaction.kind === "adjustment" ||
      transaction.kind === "production"
    ) {
      continue
    }
    const existingLines = await ctx.db
      .query("transactionLines")
      .withIndex("by_transaction", (index) =>
        index.eq("transactionId", transaction._id)
      )
      .collect()
    const linkedOrderLegacyKey = transaction.legacyKey
      ? legacyOrderLinks[transaction.legacyKey]
      : undefined
    const linkedOrder = linkedOrderLegacyKey
      ? ordersByLegacyKey.get(linkedOrderLegacyKey)
      : undefined
    if (existingLines.length > 0) {
      const direction = transactionDirection(transaction)
      const lines: PreparedLegacyLine[] = existingLines.map((line) => ({
        ...(line.bundleId ? { bundleId: line.bundleId } : {}),
        direction: line.direction ?? direction,
        kind: line.kind,
        ...(line.productId ? { productId: line.productId } : {}),
        productName: line.productName,
        quantity: line.quantity,
        total: line.total,
        unitPrice: line.unitPrice,
      }))
      const discount = reconcileLegacyAmounts(lines, transaction)
      await Promise.all(
        lines.map((line, index) => {
          const existingLine = existingLines[index]
          if (!existingLine) return Promise.resolve()
          return ctx.db.patch(existingLine._id, {
            direction: line.direction,
            total: line.total,
            unitPrice: line.unitPrice,
          })
        })
      )
      await ctx.db.patch(transaction._id, {
        discount: !linkedOrder && discount > 0 ? discount : undefined,
        incomingTotal:
          direction === "incoming" ? Math.abs(transaction.total) : 0,
        outgoingTotal:
          direction === "outgoing" ? Math.abs(transaction.total) : 0,
        ...(linkedOrder
          ? {
              productName: orderTransactionLabel(
                linkedOrder.kind,
                linkedOrder.contactName
              ),
            }
          : {}),
      })
      if (linkedOrder) {
        await ctx.db.patch(transaction._id, { orderId: linkedOrder._id })
        await ctx.db.patch(linkedOrder._id, {
          discount: undefined,
          processedAt: transaction.occurredAt,
          ...(linkedOrder.kind === "supplier"
            ? { status: "delivered" as const }
            : {}),
          total: Math.abs(transaction.total),
          transactionId: transaction._id,
        })
      }
      continue
    }

    const lines = await prepareTransactionLines(
      ctx,
      transaction,
      products,
      bundles
    )
    const direction = transactionDirection(transaction)
    const absoluteTotal = Math.abs(transaction.total)
    const discount = reconcileLegacyAmounts(lines, transaction)

    for (const line of lines) {
      await ctx.db.insert("transactionLines", {
        ...(line.bundleId ? { bundleId: line.bundleId } : {}),
        direction: line.direction,
        kind: line.kind,
        ...(line.productId ? { productId: line.productId } : {}),
        productName: line.productName,
        quantity: line.quantity,
        total: line.total,
        transactionId: transaction._id,
        unitPrice: line.unitPrice,
      })
    }

    const firstLine = lines[0]
    await ctx.db.patch(transaction._id, {
      discount: !linkedOrder && discount > 0 ? discount : undefined,
      incomingTotal: direction === "incoming" ? absoluteTotal : 0,
      kind: direction === "incoming" ? "purchase" : "sale",
      lineCount: lines.length,
      ...(linkedOrder ? { orderId: linkedOrder._id } : {}),
      outgoingTotal: direction === "outgoing" ? absoluteTotal : 0,
      ...(lines.length === 1 && firstLine?.productId
        ? { productId: firstLine.productId }
        : {}),
      productName: linkedOrder
        ? orderTransactionLabel(linkedOrder.kind, linkedOrder.contactName)
        : lines.length === 1 && firstLine
          ? firstLine.productName
          : `${lines.length} références`,
      quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
      ...(lines.length === 1 && firstLine
        ? { unitPrice: firstLine.unitPrice }
        : {}),
    })
    if (linkedOrder) {
      await ctx.db.patch(linkedOrder._id, {
        discount: undefined,
        processedAt: transaction.occurredAt,
        ...(linkedOrder.kind === "supplier"
          ? { status: "delivered" as const }
          : {}),
        total: absoluteTotal,
        transactionId: transaction._id,
      })
    }

    const existingMovements = await ctx.db
      .query("stockMovements")
      .withIndex("by_transaction", (index) =>
        index.eq("transactionId", transaction._id)
      )
      .collect()
    const kind = direction === "incoming" ? "purchase" : "sale"
    if (existingMovements.length > 0) {
      for (const movement of existingMovements) {
        const product = await ctx.db.get(movement.productId)
        if (!product) continue
        await ctx.db.patch(movement._id, {
          previousStock: product.currentStock - movement.delta,
          reason: kind,
          resultingStock: product.currentStock,
        })
      }
    } else {
      const deltas = await movementDeltasForLines(ctx, lines)
      for (const { delta, product } of deltas.values()) {
        if (delta === 0) continue
        await ctx.db.insert("stockMovements", {
          delta,
          occurredAt: transaction.occurredAt,
          previousStock: product.currentStock - delta,
          productId: product._id,
          reason: kind,
          resultingStock: product.currentStock,
          transactionId: transaction._id,
        })
        insertedMovements += 1
      }
    }
    convertedTransactions += 1
  }

  let normalizedOrders = 0
  const ordersAfterConversion = await ctx.db.query("orders").collect()
  for (const order of ordersAfterConversion) {
    if (!order.transactionId) continue
    const transaction = await ctx.db.get(order.transactionId)
    if (transaction?.orderId !== order._id) continue
    const total = order.total ?? Math.abs(transaction.total)
    await ctx.db.patch(order._id, { discount: undefined, total })
    await ctx.db.patch(transaction._id, {
      counterparty: order.contactName,
      discount: undefined,
      incomingTotal: order.kind === "supplier" ? total : 0,
      kind: order.kind === "supplier" ? "purchase" : "sale",
      outgoingTotal: order.kind === "client" ? total : 0,
      productName: orderTransactionLabel(order.kind, order.contactName),
      total: order.kind === "client" ? total : -total,
    })
    normalizedOrders += 1
  }

  const productsAfter = await ctx.db.query("products").collect()
  for (const product of productsAfter) {
    const initialStock = initialStocks.get(product._id)
    if (initialStock !== undefined && initialStock !== product.currentStock) {
      throw new ConvexError({
        code: "MIGRATION_STOCK_CHANGED",
        message: `La migration a modifié le stock de « ${product.name} ».`,
      })
    }
  }

  const result = {
    converted: true,
    convertedTransactions,
    insertedMovements,
    linkedBundleItems,
    linkedOrderLines,
    normalizedOrders,
  }
  await ctx.db.insert("systemSettings", {
    key: EXCHANGE_MIGRATION_KEY,
    updatedAt: Date.now(),
    value: JSON.stringify(result),
  })
  return result
}

function parseWorkbookTransactionKind(
  value: string
): "bundle" | "order" | "production" | "purchase" | "sale" | "service" {
  switch (value) {
    case "bundle":
    case "order":
    case "production":
    case "purchase":
    case "sale":
    case "service":
      return value
    default:
      throw new ConvexError({
        code: "MIGRATION_INVALID_TRANSACTION",
        message: `Type de transaction inconnu : ${value}.`,
      })
  }
}

export async function refreshWorkbookTransactionsData(ctx: MutationCtx) {
  const existingMigration = await ctx.db
    .query("systemSettings")
    .withIndex("by_key", (index) =>
      index.eq("key", WORKBOOK_TRANSACTIONS_MIGRATION_KEY)
    )
    .unique()
  if (existingMigration) {
    return {
      refreshed: false,
      message: "Les transactions du classeur sont déjà à jour.",
    }
  }

  const [productsList, charactersList, existingTransactions, orders] =
    await Promise.all([
      ctx.db.query("products").collect(),
      ctx.db.query("characters").collect(),
      ctx.db.query("transactions").collect(),
      ctx.db.query("orders").collect(),
    ])
  const initialStocks = new Map(
    productsList.map((product) => [product._id, product.currentStock])
  )
  const products = new Map(
    productsList.map((product) => [product.normalizedName, product])
  )
  const characters = new Map(
    charactersList.map((character) => [
      normalizeName(character.name),
      character,
    ])
  )
  const workbookTransactions = existingTransactions.filter(
    (transaction) => transaction.source === "workbook"
  )
  const workbookTransactionIds = new Set(
    workbookTransactions.map((transaction) => transaction._id)
  )
  const workbookTransactionsById = new Map(
    workbookTransactions.map((transaction) => [transaction._id, transaction])
  )

  for (const order of orders) {
    if (
      !order.transactionId ||
      !workbookTransactionIds.has(order.transactionId)
    ) {
      continue
    }
    const transaction = workbookTransactionsById.get(order.transactionId)
    const expectedOrderKey = transaction?.legacyKey
      ? legacyOrderLinks[transaction.legacyKey]
      : undefined
    if (!transaction || expectedOrderKey !== order.legacyKey) {
      throw new ConvexError({
        code: "MIGRATION_ORDER_LINK_UNKNOWN",
        message: `La commande « ${order.contactName} » utilise une transaction du classeur sans liaison reproductible.`,
      })
    }
  }

  let removedLines = 0
  let removedMovements = 0
  for (const transaction of workbookTransactions) {
    const [lines, movements] = await Promise.all([
      ctx.db
        .query("transactionLines")
        .withIndex("by_transaction", (index) =>
          index.eq("transactionId", transaction._id)
        )
        .collect(),
      ctx.db
        .query("stockMovements")
        .withIndex("by_transaction", (index) =>
          index.eq("transactionId", transaction._id)
        )
        .collect(),
    ])
    await Promise.all([
      ...lines.map((line) => ctx.db.delete(line._id)),
      ...movements.map((movement) => ctx.db.delete(movement._id)),
    ])
    removedLines += lines.length
    removedMovements += movements.length
    await ctx.db.delete(transaction._id)
  }

  for (const transaction of seedData.transactions) {
    const kind = parseWorkbookTransactionKind(transaction.kind)
    const product = products.get(canonicalProductName(transaction.productName))
    const character = characters.get(normalizeName(transaction.actorName))
    const details = {
      ...(character ? { actorCharacterId: character._id } : {}),
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
      ...(product ? { productId: product._id } : {}),
      productName: transaction.productName,
      quantity: transaction.quantity,
      source: "workbook" as const,
      total: transaction.total,
      ...(transaction.unitPrice === undefined
        ? {}
        : { unitPrice: transaction.unitPrice }),
    }
    await ctx.db.insert("transactions", {
      ...details,
      searchText: buildTransactionSearchText(details),
    })
  }

  const exchangeMigration = await ctx.db
    .query("systemSettings")
    .withIndex("by_key", (index) => index.eq("key", EXCHANGE_MIGRATION_KEY))
    .unique()
  if (exchangeMigration) await ctx.db.delete(exchangeMigration._id)
  const conversion = await convertLegacyOperationsData(ctx)
  await rebuildJournalSummaryData(ctx)
  if (await readModelsAreReady(ctx)) {
    await rebuildAccountWeekSummaries(ctx)
  }

  const productsAfter = await ctx.db.query("products").collect()
  for (const product of productsAfter) {
    const initialStock = initialStocks.get(product._id)
    if (initialStock !== undefined && initialStock !== product.currentStock) {
      throw new ConvexError({
        code: "MIGRATION_STOCK_CHANGED",
        message: `La mise à jour a modifié le stock de « ${product.name} ».`,
      })
    }
  }

  const result = {
    conversion,
    importedTransactions: seedData.transactions.length,
    preservedWebTransactions:
      existingTransactions.length - workbookTransactions.length,
    refreshed: true,
    removedLines,
    removedMovements,
    removedTransactions: workbookTransactions.length,
    sourceModifiedAt: seedData.metadata.sourceModifiedAt,
  }
  await ctx.db.insert("systemSettings", {
    key: WORKBOOK_TRANSACTIONS_MIGRATION_KEY,
    updatedAt: Date.now(),
    value: JSON.stringify(result),
  })
  return result
}

export async function rebuildReadModelsData(ctx: MutationCtx) {
  const transactions = await ctx.db.query("transactions").collect()
  let indexedTransactions = 0
  for (const transaction of transactions) {
    const financial = isFinancialTransaction(transaction)
    if (transaction.financial === financial) continue
    await ctx.db.patch(transaction._id, { financial })
    indexedTransactions += 1
  }
  const projectedRecipes = await rebuildRecipeCostProjections(ctx)
  await rebuildJournalSummaryData(ctx)
  const accountWeeks = await rebuildAccountWeekSummaries(ctx)
  await rebuildInventorySummary(ctx)
  await markReadModelsReady(ctx)
  return { accountWeeks, indexedTransactions, projectedRecipes }
}

export const convertLegacyOperations = internalMutation({
  args: {},
  handler: convertLegacyOperationsData,
})

export const repairRecipeReferences = internalMutation({
  args: {},
  handler: repairRecipeReferencesData,
})

export const reclassifyAnnexePotions = internalMutation({
  args: {},
  handler: reclassifyAnnexePotionsData,
})

export const classifyPotionCraftability = internalMutation({
  args: {},
  handler: classifyPotionCraftabilityData,
})

export const normalizeCatalogNames = internalMutation({
  args: {},
  handler: normalizeCatalogNamesData,
})

export const normalizeRecipeFamilies = internalMutation({
  args: {},
  handler: normalizeRecipeFamiliesData,
})

export const indexTransactionSearch = internalMutation({
  args: {},
  handler: indexTransactionSearchData,
})

export const normalizeContacts = internalMutation({
  args: {},
  handler: normalizeContactsData,
})

export const normalizeSupplierOrderStatuses = internalMutation({
  args: {},
  handler: normalizeSupplierOrderStatusesData,
})

export const rebuildJournalSummary = internalMutation({
  args: {},
  handler: rebuildJournalSummaryData,
})

export const rebuildReadModels = internalMutation({
  args: {},
  handler: rebuildReadModelsData,
})

export const refreshWorkbookTransactions = internalMutation({
  args: {},
  handler: refreshWorkbookTransactionsData,
})
