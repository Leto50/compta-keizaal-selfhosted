import { useQuery } from "convex/react"

import { api } from "../../convex/_generated/api"
import { canWrite, hasAccountRole } from "../../shared/account-roles"
import { canReadSection, type ReaderSection } from "../../shared/reader-access"

export function usePermissions() {
  const user = useQuery(api.auth.getCurrentUser, {})
  return {
    canWrite: canWrite(user?.role),
    isAdmin: hasAccountRole(user?.role, "admin"),
    isReader: hasAccountRole(user?.role, "reader") && !canWrite(user?.role),
    isPending: user === undefined,
    canRead: (section: ReaderSection) =>
      canReadSection(user?.role, user?.readerAccess, section),
    showPrices:
      canWrite(user?.role) ||
      (hasAccountRole(user?.role, "reader") &&
        user?.readerAccess?.showPrices !== false),
    showStock:
      canWrite(user?.role) ||
      (hasAccountRole(user?.role, "reader") &&
        user?.readerAccess?.showStock !== false),
    access: user?.readerAccess,
  }
}
