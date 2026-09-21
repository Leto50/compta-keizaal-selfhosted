import { v } from "convex/values"

export const productCategory = v.union(
  v.literal("annexe"),
  v.literal("ingredient"),
  v.literal("potion"),
  v.literal("service")
)

export const transactionKind = v.union(
  v.literal("adjustment"),
  v.literal("bundle"),
  v.literal("exchange"),
  v.literal("order"),
  v.literal("production"),
  v.literal("purchase"),
  v.literal("sale"),
  v.literal("service")
)

export const financialTransactionKind = v.union(
  v.literal("bundle"),
  v.literal("exchange"),
  v.literal("order"),
  v.literal("purchase"),
  v.literal("sale"),
  v.literal("service")
)

export const transactionLineKind = v.union(
  v.literal("bundle"),
  v.literal("product")
)

export const transactionLineDirection = v.union(
  v.literal("incoming"),
  v.literal("outgoing")
)

export const stockOperationKind = v.union(
  v.literal("exchange"),
  v.literal("production"),
  v.literal("purchase"),
  v.literal("sale"),
  v.literal("service")
)

export const orderKind = v.union(v.literal("client"), v.literal("supplier"))

export const orderStatus = v.union(
  v.literal("cancelled"),
  v.literal("delivered"),
  v.literal("open"),
  v.literal("ready")
)
