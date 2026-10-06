import { usePermissions } from "./use-permissions"
import * as format from "@/lib/format"

export function useVisibleAmounts() {
  const { showPrices, showPurchasePrices, showSalePrices } = usePermissions()
  return {
    formatSeptims: (value: number) =>
      showPrices ? format.formatSeptims(value) : "Masqué",
    formatDecimalSeptims: (value: number) =>
      showPrices ? format.formatDecimalSeptims(value) : "Masqué",
    formatUnitPrice: (value: number) =>
      showPrices ? format.formatUnitPrice(value) : "Masqué",
    formatCost: (value: number) =>
      showPurchasePrices ? format.formatDecimalSeptims(value) : "Masqué",
    formatSalePrice: (value: number) =>
      showSalePrices ? format.formatUnitPrice(value) : "Masqué",
    formatSaleAmount: (value: number) =>
      showSalePrices ? format.formatSeptims(value) : "Masqué",
  }
}
