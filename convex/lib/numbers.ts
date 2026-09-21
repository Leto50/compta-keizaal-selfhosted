import { ConvexError } from "convex/values"

export function assertFiniteRange(
  value: number,
  minimum: number,
  maximum: number,
  label: string
): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: `${label} doit être compris entre ${minimum} et ${maximum}.`,
    })
  }
}

export function assertWholeNumberRange(
  value: number,
  minimum: number,
  maximum: number,
  label: string
): void {
  assertFiniteRange(value, minimum, maximum, label)
  if (!Number.isInteger(value)) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: `${label} doit être un nombre entier.`,
    })
  }
}

export function roundSeptimsDown(value: number): number {
  const nearestInteger = Math.round(value)
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(value)) * 8

  return Math.abs(value - nearestInteger) <= tolerance
    ? nearestInteger
    : Math.floor(value)
}
