import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { type ComponentProps } from "react"

import { Button } from "@/components/ui/button"
import { TableHead } from "@/components/ui/table"
import { type SortDirection } from "@/lib/table-sorting"
import { cn } from "@/lib/utils"

interface SortableTableHeadProps extends Omit<
  ComponentProps<typeof TableHead>,
  "aria-sort" | "children"
> {
  active: boolean
  direction: SortDirection
  inactiveDirection?: SortDirection
  label: string
  onSort: () => void
}

export function SortableTableHead({
  active,
  className,
  direction,
  inactiveDirection = "asc",
  label,
  onSort,
  ...props
}: Readonly<SortableTableHeadProps>) {
  const nextDirection = active
    ? direction === "asc"
      ? "décroissant"
      : "croissant"
    : inactiveDirection === "asc"
      ? "croissant"
      : "décroissant"
  const Icon = !active ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown

  return (
    <TableHead
      aria-sort={
        active ? (direction === "asc" ? "ascending" : "descending") : "none"
      }
      className={className}
      scope="col"
      {...props}
    >
      <Button
        aria-label={`${label} : trier par ordre ${nextDirection}`}
        className={cn(
          "-mx-2 h-8 gap-1.5 px-2 text-xs font-medium",
          className?.includes("text-right") && "ml-auto"
        )}
        onClick={onSort}
        size="sm"
        type="button"
        variant="ghost"
      >
        {label}
        <Icon aria-hidden="true" className="size-3.5" />
      </Button>
    </TableHead>
  )
}
