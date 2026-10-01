export const accountRoles = ["admin", "user", "reader"] as const

export type AccountRole = (typeof accountRoles)[number]

export const accountRoleLabels: Readonly<Record<AccountRole, string>> = {
  admin: "Administrateur",
  user: "Employé",
  reader: "Lecteur",
}

export function isAccountRole(value: unknown): value is AccountRole {
  return value === "admin" || value === "user" || value === "reader"
}

export function hasAccountRole(
  role: string | null | undefined,
  expected: AccountRole
): boolean {
  return role?.split(",").includes(expected) ?? false
}

export function canWrite(role: string | null | undefined): boolean {
  return (
    hasAccountRole(role, "admin") ||
    (hasAccountRole(role, "user") && !hasAccountRole(role, "reader"))
  )
}

export function accountRole(role: string | null | undefined): AccountRole {
  if (hasAccountRole(role, "admin")) return "admin"
  if (hasAccountRole(role, "reader")) return "reader"
  return "user"
}
