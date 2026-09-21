import { describe, expect, it } from "vitest"

import { formatDateLabel, formatDateValue, parseDateValue } from "./date-values"

describe("date values", () => {
  it("convertit une date locale sans décalage de fuseau", () => {
    const date = parseDateValue("2026-08-30")

    expect(date).toBeDefined()
    expect(formatDateValue(date!)).toBe("2026-08-30")
    expect(formatDateLabel(date!)).toBe("30 août 2026")
    expect(formatDateLabel(date!, "short")).toBe("30/08/2026")
  })

  it("refuse les dates calendaires impossibles", () => {
    expect(parseDateValue("2026-02-29")).toBeUndefined()
    expect(parseDateValue("2026-13-01")).toBeUndefined()
    expect(parseDateValue("30/08/2026")).toBeUndefined()
  })

  it("accepte les années bissextiles", () => {
    expect(formatDateValue(parseDateValue("2028-02-29")!)).toBe("2028-02-29")
  })
})
