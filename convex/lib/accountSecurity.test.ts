import { describe, expect, it } from "vitest"

import { wouldRemoveLastActiveAdmin } from "./accountSecurity"

describe("accountSecurity", () => {
  it("protège le dernier administrateur actif", () => {
    const accounts = [
      { banned: false, id: "admin-1", role: "admin" },
      { banned: false, id: "employee-1", role: "user" },
    ]

    expect(wouldRemoveLastActiveAdmin(accounts, "admin-1", true)).toBe(true)
    expect(wouldRemoveLastActiveAdmin(accounts, "employee-1", true)).toBe(false)
    expect(wouldRemoveLastActiveAdmin(accounts, "admin-1", false)).toBe(false)
  })

  it("autorise la rétrogradation lorsqu’un autre administrateur reste actif", () => {
    const accounts = [
      { id: "admin-1", role: "admin" },
      { id: "admin-2", role: "admin,user" },
      { banned: true, id: "admin-archive", role: "admin" },
    ]

    expect(wouldRemoveLastActiveAdmin(accounts, "admin-1", true)).toBe(false)
    expect(wouldRemoveLastActiveAdmin(accounts, "admin-2", true)).toBe(false)
  })
})
