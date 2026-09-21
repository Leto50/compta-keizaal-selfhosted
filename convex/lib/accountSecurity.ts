export interface AccountSecurityState {
  banned?: boolean | null
  id: string
  role?: string | null
}

export function accountHasRole(
  account: Pick<AccountSecurityState, "role">,
  role: string
): boolean {
  return account.role?.split(",").includes(role) ?? false
}

export function isActiveAdmin(account: AccountSecurityState): boolean {
  return account.banned !== true && accountHasRole(account, "admin")
}

export function wouldRemoveLastActiveAdmin(
  accounts: readonly AccountSecurityState[],
  targetUserId: string,
  removesAdminAccess: boolean
): boolean {
  if (!removesAdminAccess) return false
  const target = accounts.find((account) => account.id === targetUserId)
  if (!target || !isActiveAdmin(target)) return false
  return accounts.filter(isActiveAdmin).length <= 1
}
