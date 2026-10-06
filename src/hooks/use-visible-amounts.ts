import { usePermissions } from "./use-permissions"
import * as format from "@/lib/format"

export function useVisibleAmounts() {
  const { showPrices } = usePermissions()
  return {
    formatSeptims: (value: number) =>
      showPrices ? format.formatSeptims(value) : "Masqué",
    formatDecimalSeptims: (value: number) =>
      showPrices ? format.formatDecimalSeptims(value) : "Masqué",
    formatUnitPrice: (value: number) =>
      showPrices ? format.formatUnitPrice(value) : "Masqué",
  }
}
