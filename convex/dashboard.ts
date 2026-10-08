import { v } from "convex/values"

import { query, type QueryCtx } from "./_generated/server"
import { summarizeOrderAttention } from "../shared/order-attention"
import { isFinancialTransaction } from "./lib/accountSummary"
import { requireUser } from "./lib/auth"
import { readInventorySummary } from "./lib/inventorySummary"
import { assertFiniteRange } from "./lib/numbers"
import { calculateRecipeCost } from "./lib/recipeCost"
import { readModelsAreReady } from "./lib/readModels"
import { startOfUtcWeek } from "./lib/time"
import { loadOrdersNeedingAttention } from "./lib/order"
import {
  readReaderAccess,
  orderIsVisible,
  visibleTransactions,
} from "./lib/readerAccess"
import {
  canSeeProduct,
  hasScopedReaderAccess,
  redactReaderData,
  type ReaderAccess,
} from "../shared/reader-access"

const MAX_TIMESTAMP = 8_640_000_000_000_000

async function loadLegacyInventory(ctx: QueryCtx) {
  const [products, recipes, recipeIngredients] = await Promise.all([
    ctx.db.query("products").collect(),
    ctx.db.query("recipes").collect(),
    ctx.db.query("recipeIngredients").collect(),
  ])
  const productsById = new Map(
    products.map((product) => [product._id, product])
  )
  const productionCosts = new Map<string, number>()
  for (const recipe of recipes) {
    if (recipe.active === false || !recipe.productId) continue
    const { cost } = calculateRecipeCost(
      recipeIngredients.filter(
        (ingredient) => ingredient.recipeId === recipe._id
      ),
      productsById
    )
    if (cost !== undefined) productionCosts.set(recipe.productId, cost)
  }
  const activeStock = products.filter(
    (product) => product.active && product.tracksStock
  )
  const lowStockProducts = activeStock
    .filter((product) => product.currentStock <= product.minimumStock)
    .sort(
      (left, right) =>
        left.currentStock / Math.max(left.minimumStock, 1) -
        right.currentStock / Math.max(right.minimumStock, 1)
    )
  return {
    lowStock: lowStockProducts.slice(0, 6),
    lowStockCount: lowStockProducts.length,
    stockValue: activeStock.reduce(
      (total, product) =>
        total +
        product.currentStock *
          (productionCosts.get(product._id) ??
            product.purchasePrice ??
            product.salePrice ??
            0),
      0
    ),
  }
}

export const overview = query({
  args: {
    currentWeekStartsAt: v.optional(v.number()),
    todayStartsAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const access = await readReaderAccess(ctx, user)
    for (const [label, value] of [
      ["Le début de semaine", args.currentWeekStartsAt],
      ["Le début de journée", args.todayStartsAt],
    ] as const) {
      if (value !== undefined) {
        assertFiniteRange(value, 0, MAX_TIMESTAMP, label)
      }
    }
    const fallbackNow =
      args.currentWeekStartsAt === undefined || args.todayStartsAt === undefined
        ? Date.now()
        : undefined
    const currentWeekStartsAt = startOfUtcWeek(
      args.currentWeekStartsAt ?? fallbackNow!
    )
    const todayStartsAt = args.todayStartsAt ?? fallbackNow!
    if (access && hasScopedReaderAccess(access))
      return readerOverview(ctx, access, currentWeekStartsAt, todayStartsAt)
    const readModelsReady = await readModelsAreReady(ctx)
    const storedInventory = readModelsReady
      ? await readInventorySummary(ctx)
      : null
    const inventory = storedInventory
      ? {
          lowStock: (
            await Promise.all(
              storedInventory.lowStock
                .slice(0, 6)
                .map((entry) => ctx.db.get(entry.productId))
            )
          ).filter((product) => product !== null),
          lowStockCount: storedInventory.lowStock.length,
          stockValue: storedInventory.stockValue,
        }
      : await loadLegacyInventory(ctx)
    const weeklyMetricsPromise = readModelsReady
      ? ctx.db
          .query("accountWeekSummaries")
          .withIndex("by_starts_at", (index) =>
            index.eq("startsAt", currentWeekStartsAt)
          )
          .unique()
          .then((summary) => ({
            weeklyBalance: summary?.balance ?? 0,
            weeklyTransactionCount: summary?.transactionCount ?? 0,
          }))
      : ctx.db
          .query("transactions")
          .withIndex("by_occurred_at", (index) =>
            index.gte("occurredAt", currentWeekStartsAt)
          )
          .collect()
          .then((transactions) => {
            const financialTransactions = transactions.filter(
              isFinancialTransaction
            )
            return {
              weeklyBalance: financialTransactions.reduce(
                (total, transaction) => total + transaction.total,
                0
              ),
              weeklyTransactionCount: financialTransactions.length,
            }
          })
    const [recentTransactions, orders, weeklyMetrics] = await Promise.all([
      readModelsReady
        ? ctx.db
            .query("transactions")
            .withIndex("by_financial_and_date", (index) =>
              index.eq("financial", true)
            )
            .order("desc")
            .take(8)
        : ctx.db
            .query("transactions")
            .withIndex("by_occurred_at")
            .order("desc")
            .filter((filter) =>
              filter.and(
                filter.neq(filter.field("kind"), "adjustment"),
                filter.neq(filter.field("kind"), "production"),
                filter.neq(filter.field("kind"), "harvest")
              )
            )
            .take(8),
      loadOrdersNeedingAttention(ctx),
      weeklyMetricsPromise,
    ])

    const showInventory = !access || access.sections.includes("inventory")
    const showTransactions = !access || access.sections.includes("transactions")
    const showOrders = !access || access.sections.includes("orders")
    const showFinancialSummary =
      showTransactions || access?.sections.includes("account")
    return redactReaderData(
      {
        lowStock: showInventory ? inventory.lowStock : [],
        lowStockCount: showInventory ? inventory.lowStockCount : 0,
        orderAttention: summarizeOrderAttention(
          showOrders ? orders : [],
          todayStartsAt
        ),
        recentTransactions: showTransactions ? recentTransactions : [],
        stockValue: showInventory ? inventory.stockValue : 0,
        weeklyBalance: showFinancialSummary ? weeklyMetrics.weeklyBalance : 0,
        weeklyTransactionCount: showFinancialSummary
          ? weeklyMetrics.weeklyTransactionCount
          : 0,
      },
      access
    )
  },
})

async function readerOverview(
  ctx: QueryCtx,
  access: ReaderAccess,
  currentWeekStartsAt: number,
  todayStartsAt: number
) {
  const products = access.sections.includes("inventory")
    ? (
        await ctx.db
          .query("products")
          .withIndex("by_active", (index) => index.eq("active", true))
          .collect()
      ).filter((product) => canSeeProduct(access, product._id))
    : []
  const lowStock = products.filter(
    (product) =>
      product.tracksStock && product.currentStock <= product.minimumStock
  )
  const transactions = access.sections.some(
    (section) => section === "transactions" || section === "account"
  )
    ? await visibleTransactions(
        ctx,
        access,
        await ctx.db
          .query("transactions")
          .withIndex("by_occurred_at")
          .order("desc")
          .collect()
      )
    : []
  const financial = transactions.filter(isFinancialTransaction)
  const weekly = financial.filter(
    (transaction) => transaction.occurredAt >= currentWeekStartsAt
  )
  const orders = access.sections.includes("orders")
    ? await loadOrdersNeedingAttention(ctx)
    : []
  const visibleOrders = await Promise.all(
    orders.map((order) => orderIsVisible(ctx, access, order))
  )
  return redactReaderData(
    {
      lowStock: lowStock.slice(0, 6),
      lowStockCount: lowStock.length,
      stockValue: products.reduce(
        (sum, product) =>
          sum +
          (product.tracksStock
            ? product.currentStock *
              (product.purchasePrice ?? product.salePrice ?? 0)
            : 0),
        0
      ),
      orderAttention: summarizeOrderAttention(
        orders.filter((_, index) => visibleOrders[index]),
        todayStartsAt
      ),
      recentTransactions: access.sections.includes("transactions")
        ? financial.slice(0, 8)
        : [],
      weeklyBalance: weekly.reduce(
        (sum, transaction) => sum + transaction.total,
        0
      ),
      weeklyTransactionCount: weekly.length,
    },
    access
  )
}
