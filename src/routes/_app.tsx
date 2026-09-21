import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { useConvexAuth } from "convex/react"
import { useEffect } from "react"

import { AppShell } from "@/components/app-shell"

export const Route = createFileRoute("/_app")({
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated) {
      // TanStack Router redirects are throwable response descriptors, not Errors.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: "/connexion" })
    }
  },
  component: AppLayout,
})

function AppLayout() {
  const { isAuthenticated, isLoading } = useConvexAuth()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      window.location.replace("/connexion")
    }
  }, [isAuthenticated, isLoading])

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
