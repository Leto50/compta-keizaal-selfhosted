import { usePermissions } from "./use-permissions"
import * as format from "@/lib/format"

export function useVisibleAmounts() {
  const { showPrices, showPurchasePrices, showSalePrices } = usePermissions()
  return {
    formatSeptims: (value: number) =>
      showPrices ? format.formatSeptims(value) : "",
    formatDecimalSeptims: (value: number) =>
      showPrices ? format.formatDecimalSeptims(value) : "",
    formatUnitPrice: (value: number) =>
      showPrices ? format.formatUnitPrice(value) : "",
    formatCost: (value: number) =>
      showPurchasePrices ? format.formatDecimalSeptims(value) : "",
    formatSalePrice: (value: number) =>
      showSalePrices ? format.formatUnitPrice(value) : "",
    formatSaleAmount: (value: number) =>
      showSalePrices ? format.formatSeptims(value) : "",
  }
}
