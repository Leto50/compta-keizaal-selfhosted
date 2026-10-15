import { formatDecimalSeptims } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  calculateHarvestValue,
  type HarvestValueLine,
} from "../../shared/harvest-value"

export function HarvestValueSummary({
  compact = false,
  lines,
}: Readonly<{ compact?: boolean; lines: readonly HarvestValueLine[] }>) {
  const { knownValue, unpricedLineCount } = calculateHarvestValue(lines)
  return (
    <HarvestValueAmount
      compact={compact}
      knownValue={knownValue}
      unpricedLineCount={unpricedLineCount}
      lineCount={lines.length}
    />
  )
}

export function HarvestValueAmount({
  compact = false,
  knownValue,
  unpricedLineCount,
  lineCount,
  showLabel = false,
}: Readonly<{
  compact?: boolean
  knownValue: number
  unpricedLineCount: number
  lineCount: number
  showLabel?: boolean
}>) {
  const hasKnownPrices = unpricedLineCount < lineCount

  return (
    <div
      className={cn(
        "grid gap-1",
        compact ? "justify-items-end" : "border-t border-border/70 pt-3"
      )}
    >
      <div
        className={cn(
          "text-sm",
          !compact &&
            "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
        )}
      >
        <p
          className={
            compact
              ? cn("text-xs text-muted-foreground", !showLabel && "md:sr-only")
              : undefined
          }
        >
          {unpricedLineCount === 0
            ? "Économie estimée à l’achat"
            : "Valeur connue à l’achat"}
        </p>
        <p className="font-semibold text-[#405c43] tabular-nums">
          {hasKnownPrices ? formatDecimalSeptims(knownValue) : "Non renseignée"}
        </p>
      </div>
      {unpricedLineCount > 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {compact ? (
            <>
              {hasKnownPrices ? "Partielle · " : ""}
              {unpricedLineCount} prix manquant
              {unpricedLineCount > 1 ? "s" : ""}
            </>
          ) : (
            <>
              Estimation incomplète : {unpricedLineCount} ingrédient
              {unpricedLineCount > 1 ? "s" : ""} sans prix d’achat.
            </>
          )}
        </p>
      ) : null}
    </div>
  )
}
