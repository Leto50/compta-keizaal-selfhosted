import { useQuery } from "convex/react"

import { api } from "../../convex/_generated/api"
import { canWrite, hasAccountRole } from "../../shared/account-roles"
import { canReadSection, type ReaderSection } from "../../shared/reader-access"

export function usePermissions() {
  const user = useQuery(api.auth.getCurrentUser, {})
  const writer = canWrite(user?.role)
  const readerPrices =
    hasAccountRole(user?.role, "reader") &&
    user?.readerAccess?.showPrices !== false
  const showPurchasePrices =
    writer || (readerPrices && user?.readerAccess?.showPurchasePrices !== false)
  const showSalePrices =
    writer || (readerPrices && user?.readerAccess?.showSalePrices !== false)
  return {
    canWrite: canWrite(user?.role),
    isAdmin: hasAccountRole(user?.role, "admin"),
    isReader: hasAccountRole(user?.role, "reader") && !canWrite(user?.role),
    isPending: user === undefined,
    canRead: (section: ReaderSection) =>
      canReadSection(user?.role, user?.readerAccess, section),
    showPrices: showPurchasePrices && showSalePrices,
    showPurchasePrices,
    showSalePrices,
    showSalaries:
      showPurchasePrices &&
      showSalePrices &&
      (writer || user?.readerAccess?.showSalaries !== false),
    showStock:
      canWrite(user?.role) ||
      (hasAccountRole(user?.role, "reader") &&
        user?.readerAccess?.showStock !== false),
    access: user?.readerAccess,
  }
}
