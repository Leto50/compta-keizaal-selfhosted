export interface PriceDraft {
  septims: string
  units: string
}

export interface PriceRatio {
  septims: number
  units: number
}

const MAX_DISPLAY_DENOMINATOR = 1_000
const RATIO_TOLERANCE = 1e-9

function greatestCommonDivisor(first: number, second: number): number {
  let left = Math.abs(first)
  let right = Math.abs(second)

  while (right !== 0) {
    const remainder = left % right
    left = right
    right = remainder
  }

  return left || 1
}

export function priceRatioFromValue(value: number): PriceRatio {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Le prix doit être un nombre positif fini.")
  }

  let bestSeptims = Math.round(value)
  let bestUnits = 1
  let bestError = Math.abs(value - bestSeptims)

  for (let units = 1; units <= MAX_DISPLAY_DENOMINATOR; units += 1) {
    const septims = Math.round(value * units)
    const error = Math.abs(value - septims / units)

    if (error < bestError) {
      bestError = error
      bestSeptims = septims
      bestUnits = units
    }
    if (error <= RATIO_TOLERANCE * Math.max(1, value)) break
  }

  const divisor = greatestCommonDivisor(bestSeptims, bestUnits)
  return {
    septims: bestSeptims / divisor,
    units: bestUnits / divisor,
  }
}

export function priceDraftFromValue(
  value: number | null | undefined
): PriceDraft {
  if (value === null || value === undefined) {
    return { septims: "", units: "1" }
  }

  const ratio = priceRatioFromValue(value)
  return {
    septims: ratio.septims.toString(),
    units: ratio.units.toString(),
  }
}

export function priceDraftToValue(draft: Readonly<PriceDraft>): number | null {
  if (!draft.septims.trim()) return null

  const septims = Number(draft.septims)
  const units = Number(draft.units)
  if (
    !Number.isSafeInteger(septims) ||
    !Number.isSafeInteger(units) ||
    septims < 0 ||
    units <= 0
  ) {
    return Number.NaN
  }

  return septims / units
}

export function roundSeptimsDown(value: number): number {
  const nearestInteger = Math.round(value)
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(value)) * 8

  return Math.abs(value - nearestInteger) <= tolerance
    ? nearestInteger
    : Math.floor(value)
}
