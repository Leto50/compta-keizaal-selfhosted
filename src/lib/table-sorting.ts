export type SortDirection = "asc" | "desc"
export type InventorySortKey = "name" | "price" | "status" | "stock"
export type ActorSortKey =
  "incoming" | "name" | "net" | "operations" | "outgoing" | "salary"

interface SortableInventoryEntry {
  currentStock: number
  minimumStock: number
  name: string
  purchasePrice?: number
  salePrice?: number
  tracksStock: boolean
}

interface SortableActorEntry {
  actorName: string
  incoming: number
  net: number
  outgoing: number
  salary: number
  transactionCount: number
}

const frenchCollator = new Intl.Collator("fr", {
  numeric: true,
  sensitivity: "base",
})

function withDirection(comparison: number, direction: SortDirection): number {
  return direction === "asc" ? comparison : -comparison
}

function compareOptionalNumbers(
  left: number | undefined,
  right: number | undefined,
  direction: SortDirection
): number {
  if (left === undefined && right === undefined) return 0
  if (left === undefined) return 1
  if (right === undefined) return -1
  return withDirection(left - right, direction)
}

function inventoryStatusRank(entry: SortableInventoryEntry): number {
  return entry.currentStock <= entry.minimumStock ? 0 : 1
}

function compareInventoryStatuses(
  left: SortableInventoryEntry,
  right: SortableInventoryEntry,
  direction: SortDirection
): number {
  if (!left.tracksStock && !right.tracksStock) return 0
  if (!left.tracksStock) return 1
  if (!right.tracksStock) return -1
  return withDirection(
    inventoryStatusRank(left) - inventoryStatusRank(right),
    direction
  )
}

export function sortInventoryEntries<T extends SortableInventoryEntry>(
  entries: readonly T[],
  key: InventorySortKey,
  direction: SortDirection
): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      let comparison = 0
      if (key === "name") {
        comparison = withDirection(
          frenchCollator.compare(left.entry.name, right.entry.name),
          direction
        )
      } else if (key === "stock") {
        comparison = compareOptionalNumbers(
          left.entry.tracksStock ? left.entry.currentStock : undefined,
          right.entry.tracksStock ? right.entry.currentStock : undefined,
          direction
        )
      } else if (key === "price") {
        comparison = compareOptionalNumbers(
          left.entry.salePrice ?? left.entry.purchasePrice,
          right.entry.salePrice ?? right.entry.purchasePrice,
          direction
        )
      } else {
        comparison = compareInventoryStatuses(
          left.entry,
          right.entry,
          direction
        )
      }
      return (
        comparison ||
        frenchCollator.compare(left.entry.name, right.entry.name) ||
        left.index - right.index
      )
    })
    .map(({ entry }) => entry)
}

export function sortActorEntries<T extends SortableActorEntry>(
  entries: readonly T[],
  key: ActorSortKey,
  direction: SortDirection
): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const comparison =
        key === "name"
          ? withDirection(
              frenchCollator.compare(
                left.entry.actorName,
                right.entry.actorName
              ),
              direction
            )
          : withDirection(
              key === "operations"
                ? left.entry.transactionCount - right.entry.transactionCount
                : left.entry[key] - right.entry[key],
              direction
            )
      return (
        comparison ||
        frenchCollator.compare(left.entry.actorName, right.entry.actorName) ||
        left.index - right.index
      )
    })
    .map(({ entry }) => entry)
}
