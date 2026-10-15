export interface HarvestValueLine {
  purchaseUnitPrice?: number
  quantity: number
}

export function calculateHarvestValue(lines: readonly HarvestValueLine[]) {
  let knownValue = 0
  let unpricedLineCount = 0
  for (const line of lines) {
    if (line.purchaseUnitPrice === undefined) {
      unpricedLineCount += 1
    } else {
      knownValue += line.quantity * line.purchaseUnitPrice
    }
  }
  return { knownValue, unpricedLineCount }
}
