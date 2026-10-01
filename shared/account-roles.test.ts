import { describe, expect, it } from "vitest"

import { canWrite, hasAccountRole } from "./account-roles"

describe("droits d’écriture", () => {
  it.each([
    [undefined, false],
    [null, false],
    ["", false],
    ["unknown", false],
    ["reader", false],
    ["reader,user", false],
    ["user,reader", false],
    ["superadmin", false],
    ["user", true],
    ["admin", true],
    ["admin,user", true],
  ] as const)(
    "accorde au rôle %s uniquement les droits attendus",
    (role, expected) => {
      expect(canWrite(role)).toBe(expected)
    }
  )

  it("exige le rôle admin exact pour accéder à l’administration", () => {
    expect(hasAccountRole("reader", "admin")).toBe(false)
    expect(hasAccountRole("superadmin", "admin")).toBe(false)
    expect(hasAccountRole("admin,user", "admin")).toBe(true)
  })
})
