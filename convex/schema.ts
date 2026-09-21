import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

import {
  orderKind,
  orderStatus,
  productCategory,
  transactionKind,
  transactionLineDirection,
  transactionLineKind,
} from "./lib/validators"

export default defineSchema({
  accountSettings: defineTable({
    cashBalance: v.number(),
    censusPerEmployee: v.number(),
    employeeCount: v.number(),
    fundsBalance: v.number(),
    key: v.literal("main"),
    salaryPerEmployee: v.optional(v.number()),
    salaryRate: v.optional(v.number()),
    taxRate: v.number(),
    updatedAt: v.number(),
    updatedBy: v.string(),
    weeklyRent: v.number(),
  }).index("by_key", ["key"]),

  journalSummaries: defineTable({
    balance: v.number(),
    key: v.literal("main"),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  accountWeekSummaries: defineTable({
    actors: v.array(
      v.object({
        actorCharacterId: v.optional(v.id("characters")),
        actorName: v.string(),
        incoming: v.number(),
        outgoing: v.number(),
        salaryRevenue: v.number(),
        transactionCount: v.number(),
      })
    ),
    balance: v.number(),
    incoming: v.number(),
    outgoing: v.number(),
    startsAt: v.number(),
    transactionCount: v.number(),
    updatedAt: v.number(),
  }).index("by_starts_at", ["startsAt"]),

  inventorySummaries: defineTable({
    key: v.literal("main"),
    lowStock: v.array(
      v.object({
        creationTime: v.number(),
        currentStock: v.number(),
        minimumStock: v.number(),
        productId: v.id("products"),
        ratio: v.number(),
      })
    ),
    stockValue: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  products: defineTable({
    active: v.boolean(),
    category: productCategory,
    craftable: v.optional(v.boolean()),
    currentStock: v.number(),
    legacyKey: v.optional(v.string()),
    minimumStock: v.number(),
    name: v.string(),
    normalizedName: v.string(),
    purchasePrice: v.optional(v.number()),
    salePrice: v.optional(v.number()),
    tracksStock: v.boolean(),
  })
    .index("by_active", ["active"])
    .index("by_category", ["category"])
    .index("by_legacy_key", ["legacyKey"])
    .index("by_normalized_name", ["normalizedName"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["active", "category"],
    }),

  characters: defineTable({
    active: v.boolean(),
    legacyKey: v.optional(v.string()),
    name: v.string(),
  })
    .index("by_legacy_key", ["legacyKey"])
    .index("by_name", ["name"]),

  contacts: defineTable({
    active: v.optional(v.boolean()),
    kind: orderKind,
    legacyKey: v.optional(v.string()),
    name: v.string(),
    normalizedName: v.optional(v.string()),
  })
    .index("by_kind", ["kind"])
    .index("by_kind_and_normalized_name", ["kind", "normalizedName"])
    .index("by_legacy_key", ["legacyKey"]),

  transactions: defineTable({
    actorCharacterId: v.optional(v.id("characters")),
    actorName: v.string(),
    actorUserId: v.optional(v.string()),
    comment: v.optional(v.string()),
    counterparty: v.optional(v.string()),
    discount: v.optional(v.number()),
    financial: v.optional(v.boolean()),
    incomingTotal: v.optional(v.number()),
    kind: transactionKind,
    legacyKey: v.optional(v.string()),
    lineCount: v.optional(v.number()),
    occurredAt: v.number(),
    orderId: v.optional(v.id("orders")),
    outgoingTotal: v.optional(v.number()),
    productId: v.optional(v.id("products")),
    productName: v.string(),
    quantity: v.number(),
    searchText: v.optional(v.string()),
    source: v.union(v.literal("web"), v.literal("workbook")),
    total: v.number(),
    unitPrice: v.optional(v.number()),
  })
    .index("by_financial_and_date", ["financial", "occurredAt"])
    .index("by_kind_and_date", ["kind", "occurredAt"])
    .index("by_legacy_key", ["legacyKey"])
    .index("by_occurred_at", ["occurredAt"])
    .index("by_product_and_date", ["productId", "occurredAt"])
    .searchIndex("search_journal", {
      filterFields: ["financial", "kind", "actorCharacterId"],
      searchField: "searchText",
    }),

  transactionLines: defineTable({
    bundleId: v.optional(v.id("bundles")),
    direction: v.optional(transactionLineDirection),
    kind: transactionLineKind,
    productId: v.optional(v.id("products")),
    productName: v.string(),
    quantity: v.number(),
    total: v.number(),
    transactionId: v.id("transactions"),
    unitPrice: v.number(),
  }).index("by_transaction", ["transactionId"]),

  stockMovements: defineTable({
    delta: v.number(),
    occurredAt: v.number(),
    previousStock: v.optional(v.number()),
    productId: v.id("products"),
    reason: transactionKind,
    resultingStock: v.optional(v.number()),
    transactionId: v.id("transactions"),
  })
    .index("by_product_and_date", ["productId", "occurredAt"])
    .index("by_transaction", ["transactionId"]),

  orders: defineTable({
    contactId: v.optional(v.id("contacts")),
    contactName: v.string(),
    discount: v.optional(v.number()),
    dueAt: v.optional(v.number()),
    dueLabel: v.optional(v.string()),
    kind: orderKind,
    legacyKey: v.optional(v.string()),
    notes: v.optional(v.string()),
    processedAt: v.optional(v.number()),
    status: orderStatus,
    total: v.optional(v.number()),
    transactionId: v.optional(v.id("transactions")),
  })
    .index("by_kind_and_status", ["kind", "status"])
    .index("by_legacy_key", ["legacyKey"])
    .index("by_status", ["status"])
    .index("by_transaction", ["transactionId"]),

  orderLines: defineTable({
    bundleId: v.optional(v.id("bundles")),
    kind: v.optional(transactionLineKind),
    legacyKey: v.optional(v.string()),
    orderId: v.id("orders"),
    productId: v.optional(v.id("products")),
    productName: v.string(),
    quantity: v.number(),
    total: v.optional(v.number()),
    unitPrice: v.optional(v.number()),
  })
    .index("by_legacy_key", ["legacyKey"])
    .index("by_order", ["orderId"]),

  recipes: defineTable({
    active: v.optional(v.boolean()),
    cost: v.optional(v.number()),
    effect: v.optional(v.string()),
    family: v.string(),
    legacyKey: v.optional(v.string()),
    missingCostReferences: v.optional(v.array(v.string())),
    name: v.string(),
    productId: v.optional(v.id("products")),
  })
    .index("by_family", ["family"])
    .index("by_legacy_key", ["legacyKey"])
    .index("by_product", ["productId"])
    .searchIndex("search_name", { searchField: "name" }),

  recipeIngredients: defineTable({
    ingredientName: v.string(),
    legacyKey: v.optional(v.string()),
    productId: v.optional(v.id("products")),
    quantity: v.number(),
    raw: v.string(),
    recipeId: v.id("recipes"),
  })
    .index("by_legacy_key", ["legacyKey"])
    .index("by_recipe", ["recipeId"]),

  bundles: defineTable({
    active: v.boolean(),
    legacyKey: v.optional(v.string()),
    name: v.string(),
    price: v.optional(v.number()),
  }).index("by_legacy_key", ["legacyKey"]),

  bundleItems: defineTable({
    bundleId: v.id("bundles"),
    legacyKey: v.optional(v.string()),
    productId: v.optional(v.id("products")),
    productName: v.string(),
    quantity: v.number(),
  })
    .index("by_bundle", ["bundleId"])
    .index("by_legacy_key", ["legacyKey"]),

  auditLogs: defineTable({
    action: v.string(),
    actorUserId: v.string(),
    createdAt: v.number(),
    detail: v.optional(v.string()),
    entityId: v.string(),
    entityType: v.string(),
  }).index("by_created_at", ["createdAt"]),

  systemSettings: defineTable({
    key: v.string(),
    updatedAt: v.number(),
    value: v.string(),
  }).index("by_key", ["key"]),
})
