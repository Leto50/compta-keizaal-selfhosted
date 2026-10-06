import { canWrite } from "./account-roles"

export const readerSections = [
  "inventory",
  "transactions",
  "account",
  "orders",
  "recipes",
  "bundles",
] as const
export type ReaderSection = (typeof readerSections)[number]
export const readerSectionLabels: Record<ReaderSection, string> = {
  inventory: "Inventaire",
  transactions: "Transactions",
  account: "Compte",
  orders: "Commandes",
  recipes: "Recettes",
  bundles: "Lots",
}
export const readerOperationKinds = [
  "adjustment",
  "bundle",
  "exchange",
  "order",
  "production",
  "purchase",
  "sale",
  "service",
] as const
export type ReaderOperationKind = (typeof readerOperationKinds)[number]
export interface ReaderAccess {
  sections: ReaderSection[]
  showPrices: boolean
  showStock: boolean
  showPurchasePrices?: boolean
  showSalePrices?: boolean
  productIds?: string[]
  operationKinds: ReaderOperationKind[]
}
export const defaultReaderAccess: ReaderAccess = {
  sections: [...readerSections],
  showPrices: true,
  showStock: true,
  showPurchasePrices: true,
  showSalePrices: true,
  operationKinds: [...readerOperationKinds],
}
export function canReadSection(
  role: string | null | undefined,
  access: ReaderAccess | null | undefined,
  section: ReaderSection
): boolean {
  return (
    canWrite(role) ||
    (role?.split(",").includes("reader") === true &&
      (access ?? defaultReaderAccess).sections.includes(section))
  )
}
export function canSeeProduct(
  access: ReaderAccess | null,
  productId: string | undefined
): boolean {
  return (
    !access?.productIds ||
    (productId !== undefined && access.productIds.includes(productId))
  )
}
export function canSeeCatalogEntry(
  access: ReaderAccess | null,
  productIds: (string | undefined)[]
): boolean {
  return (
    !access?.productIds ||
    (productIds.length > 0 &&
      productIds.every((id) => canSeeProduct(access, id)))
  )
}

export function hasScopedReaderAccess(access: ReaderAccess | null): boolean {
  return (
    !!access &&
    (access.productIds !== undefined ||
      readerOperationKinds.some(
        (kind) => !access.operationKinds.includes(kind)
      ))
  )
}

const priceFields = new Set([
  "purchasePrice",
  "salePrice",
  "price",
  "unitPrice",
  "cost",
  "total",
  "incomingTotal",
  "outgoingTotal",
  "discount",
  "stockValue",
  "weeklyBalance",
  "journalBalance",
  "balance",
  "incoming",
  "outgoing",
  "net",
  "salary",
  "salaryRevenue",
  "cashBalance",
  "fundsBalance",
  "censusPerEmployee",
  "weeklyRent",
  "census",
  "rent",
  "tax",
])
const stockFields = new Set([
  "currentStock",
  "minimumStock",
  "previousStock",
  "resultingStock",
  "lowStockCount",
  "possibleCrafts",
  "stockValue",
])

// Keep response shapes stable, but replace protected numeric values with zero.
// The UI uses the same policy to label them as “Masqué”, never as real values.
export function redactReaderData<T>(value: T, access: ReaderAccess | null): T {
  if (!access) return value
  if (Array.isArray(value))
    return value.map((entry: unknown) => redactReaderData(entry, access)) as T
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]: [string, unknown]) => {
      const purchaseHidden =
        !access.showPrices || access.showPurchasePrices === false
      const saleHidden = !access.showPrices || access.showSalePrices === false
      const hidePrice =
        key === "purchasePrice" || key === "cost"
          ? purchaseHidden
          : key === "salePrice" || key === "price"
            ? saleHidden
            : purchaseHidden || saleHidden
      if (
        (hidePrice && priceFields.has(key)) ||
        (!access.showStock && stockFields.has(key))
      )
        return [key, typeof entry === "number" ? 0 : entry]
      if (
        (!access.showStock && (key === "lowStock" || key === "stockDeltas")) ||
        (purchaseHidden && key === "missingCostReferences")
      )
        return [key, []]
      return [key, redactReaderData(entry, access)]
    })
  ) as T
}
