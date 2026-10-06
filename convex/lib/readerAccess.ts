import { type Doc } from "../_generated/dataModel"
import { type MutationCtx, type QueryCtx } from "../_generated/server"
import { canWrite, hasAccountRole } from "../../shared/account-roles"
import {
  canSeeCatalogEntry,
  defaultReaderAccess,
  type ReaderAccess,
} from "../../shared/reader-access"

export async function readReaderAccess(
  ctx: QueryCtx | MutationCtx,
  user: { _id: string; role?: string | null }
): Promise<ReaderAccess | null> {
  if (canWrite(user.role)) return null
  if (!hasAccountRole(user.role, "reader"))
    return {
      sections: [],
      showPrices: false,
      showStock: false,
      productIds: [],
      operationKinds: [],
    }
  const stored = await ctx.db
    .query("readerAccess")
    .withIndex("by_user", (index) => index.eq("userId", user._id))
    .unique()
  if (!stored) return { ...defaultReaderAccess }
  return {
    sections: stored.sections,
    showPrices: stored.showPrices,
    showStock: stored.showStock,
    operationKinds: stored.operationKinds,
    ...(stored.productIds === undefined
      ? {}
      : { productIds: stored.productIds }),
  }
}

export async function transactionIsVisible(
  ctx: QueryCtx,
  access: ReaderAccess | null,
  transaction: Doc<"transactions">
): Promise<boolean> {
  if (!access) return true
  if (!access.operationKinds.includes(transaction.kind)) return false
  if (!access.productIds) return true
  const lines = await ctx.db
    .query("transactionLines")
    .withIndex("by_transaction", (index) =>
      index.eq("transactionId", transaction._id)
    )
    .collect()
  const productIds = [
    transaction.productId,
    ...lines.map((line) => line.productId),
  ].filter((id) => id !== undefined)
  const movements = await ctx.db
    .query("stockMovements")
    .withIndex("by_transaction", (index) =>
      index.eq("transactionId", transaction._id)
    )
    .collect()
  productIds.push(...movements.map((movement) => movement.productId))
  if (transaction.orderId) {
    const orderLines = await ctx.db
      .query("orderLines")
      .withIndex("by_order", (index) =>
        index.eq("orderId", transaction.orderId!)
      )
      .collect()
    if (orderLines.some((line) => !line.productId)) return false
    productIds.push(
      ...orderLines
        .map((line) => line.productId)
        .filter((id) => id !== undefined)
    )
  }
  for (const line of lines) {
    if (line.bundleId) {
      const items = await ctx.db
        .query("bundleItems")
        .withIndex("by_bundle", (index) => index.eq("bundleId", line.bundleId!))
        .collect()
      if (items.some((item) => !item.productId)) return false
      productIds.push(
        ...items.map((item) => item.productId).filter((id) => id !== undefined)
      )
    }
  }
  if (lines.some((line) => !line.productId && !line.bundleId)) return false
  return canSeeCatalogEntry(access, productIds)
}

export async function visibleTransactions(
  ctx: QueryCtx,
  access: ReaderAccess | null,
  transactions: Doc<"transactions">[]
) {
  const visible = await Promise.all(
    transactions.map((transaction) =>
      transactionIsVisible(ctx, access, transaction)
    )
  )
  return transactions.filter((_, index) => visible[index])
}

export async function orderIsVisible(
  ctx: QueryCtx,
  access: ReaderAccess | null,
  order: Doc<"orders">
): Promise<boolean> {
  if (!access?.productIds) return true
  const lines = await ctx.db
    .query("orderLines")
    .withIndex("by_order", (index) => index.eq("orderId", order._id))
    .collect()
  return canSeeCatalogEntry(
    access,
    lines.map((line) => line.productId)
  )
}
