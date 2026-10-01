import { useQuery } from "convex/react"

import { api } from "../../convex/_generated/api"
import { canWrite, hasAccountRole } from "../../shared/account-roles"

export function usePermissions() {
  const user = useQuery(api.auth.getCurrentUser, {})
  return {
    canWrite: canWrite(user?.role),
    isAdmin: hasAccountRole(user?.role, "admin"),
    isReader: hasAccountRole(user?.role, "reader") && !canWrite(user?.role),
    isPending: user === undefined,
  }
}
