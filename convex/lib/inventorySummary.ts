import { type Doc } from "../_generated/dataModel"
import { type MutationCtx, type QueryCtx } from "../_generated/server"
import { readModelsAreReady } from "./readModels"

type InventoryProduct = Doc<"products">
type LowStockEntry = Doc<"inventorySummaries">["lowStock"][number]

export interface InventoryProductChange {
  after?: InventoryProduct
  before?: InventoryProduct
}

function isTracked(product: InventoryProduct | undefined) {
  return Boolean(product?.active && product.tracksStock)
}

function isLowStock(product: InventoryProduct | undefined) {
  return Boolean(
    isTracked(product) && product!.currentStock <= product!.minimumStock
  )
}

function lowStockEntry(product: InventoryProduct): LowStockEntry {
  return {
    creationTime: product._creationTime,
    currentStock: product.currentStock,
    minimumStock: product.minimumStock,
    productId: product._id,
    ratio: product.currentStock / Math.max(product.minimumStock, 1),
  }
}

function sortLowStock(entries: LowStockEntry[]) {
  return entries.sort(
    (left, right) =>
      left.ratio - right.ratio ||
      left.creationTime - right.creationTime ||
      String(left.productId).localeCompare(String(right.productId))
  )
}

function fallbackValuationPrice(product: InventoryProduct) {
  return product.purchasePrice ?? product.salePrice ?? 0
}

async function productionCostForProduct(
  ctx: QueryCtx | MutationCtx,
  productId: InventoryProduct["_id"]
): Promise<number | null> {
  const recipes = await ctx.db
    .query("recipes")
    .withIndex("by_product", (index) => index.eq("productId", productId))
    .collect()
  return (
    recipes.find(
      (recipe) => recipe.active !== false && recipe.cost !== undefined
    )?.cost ?? null
  )
}

async function productStockValue(
  ctx: QueryCtx | MutationCtx,
  product: InventoryProduct | undefined,
  knownProductionCost?: number | null
) {
  if (!isTracked(product)) return 0
  const productionCost =
    knownProductionCost === undefined
      ? await productionCostForProduct(ctx, product!._id)
      : knownProductionCost
  return (
    product!.currentStock * (productionCost ?? fallbackValuationPrice(product!))
  )
}

async function getStoredSummary(ctx: QueryCtx | MutationCtx) {
  return ctx.db
    .query("inventorySummaries")
    .withIndex("by_key", (index) => index.eq("key", "main"))
    .unique()
}

export async function readInventorySummary(ctx: QueryCtx) {
  return getStoredSummary(ctx)
}

export async function applyInventoryProductChanges(
  ctx: MutationCtx,
  changes: readonly InventoryProductChange[]
) {
  if (changes.length === 0 || !(await readModelsAreReady(ctx))) return
  const summary = await getStoredSummary(ctx)
  if (!summary) return

  let stockValue = summary.stockValue
  let lowStock = summary.lowStock.map((entry) => ({ ...entry }))
  for (const { after, before } of changes) {
    const productId = after?._id ?? before?._id
    if (!productId) continue
    const productionCost = await productionCostForProduct(ctx, productId)
    stockValue +=
      (await productStockValue(ctx, after, productionCost)) -
      (await productStockValue(ctx, before, productionCost))
    lowStock = lowStock.filter((entry) => entry.productId !== productId)
    if (after && isLowStock(after)) lowStock.push(lowStockEntry(after))
  }

  await ctx.db.patch(summary._id, {
    lowStock: sortLowStock(lowStock),
    stockValue: Math.abs(stockValue) < 1e-9 ? 0 : stockValue,
    updatedAt: Date.now(),
  })
}

export async function rebuildInventorySummary(ctx: MutationCtx) {
  const [existing, products, recipes] = await Promise.all([
    getStoredSummary(ctx),
    ctx.db.query("products").collect(),
    ctx.db.query("recipes").collect(),
  ])
  const productionCosts = new Map<string, number>()
  for (const recipe of recipes) {
    if (
      recipe.active !== false &&
      recipe.productId &&
      recipe.cost !== undefined
    ) {
      productionCosts.set(recipe.productId, recipe.cost)
    }
  }
  const trackedProducts = products.filter(isTracked)
  const stockValue = trackedProducts.reduce(
    (total, product) =>
      total +
      product.currentStock *
        (productionCosts.get(product._id) ?? fallbackValuationPrice(product)),
    0
  )
  const lowStock = sortLowStock(
    trackedProducts.filter(isLowStock).map(lowStockEntry)
  )
  const details = {
    key: "main" as const,
    lowStock,
    stockValue,
    updatedAt: Date.now(),
  }
  if (existing) {
    await ctx.db.replace(existing._id, details)
    return existing._id
  }
  return ctx.db.insert("inventorySummaries", details)
}

export async function rebuildInventorySummaryIfReady(ctx: MutationCtx) {
  if (!(await readModelsAreReady(ctx))) return
  await rebuildInventorySummary(ctx)
}
