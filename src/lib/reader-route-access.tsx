import { convexQuery } from "@convex-dev/react-query"
import { type QueryClient } from "@tanstack/react-query"
import { Link, redirect } from "@tanstack/react-router"
import { type ComponentType } from "react"
import { api } from "../../convex/_generated/api"
import { canReadSection, type ReaderSection } from "../../shared/reader-access"
import { usePermissions } from "@/hooks/use-permissions"
import { PageSkeleton } from "@/components/page-skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export function readerRouteAccess(...sections: ReaderSection[]) {
  return async ({ context }: { context: { queryClient: QueryClient } }) => {
    const user = await context.queryClient.fetchQuery({
      ...convexQuery(api.auth.getCurrentUser, {}),
      staleTime: 0,
    })
    if (
      !sections.some((section) =>
        canReadSection(user?.role, user?.readerAccess, section)
      )
    ) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: "/" })
    }
  }
}

export function withReaderAccess(
  Component: ComponentType,
  ...sections: ReaderSection[]
) {
  return function ReaderAccessGuard() {
    const { canRead, isPending } = usePermissions()
    if (isPending) return <PageSkeleton />
    if (!sections.some(canRead))
      return (
        <Alert>
          <AlertTitle>Accès non autorisé</AlertTitle>
          <AlertDescription>
            Votre accès à cette rubrique a changé.{" "}
            <Link className="underline" to="/">
              Retour à l’accueil
            </Link>
          </AlertDescription>
        </Alert>
      )
    return <Component />
  }
}
