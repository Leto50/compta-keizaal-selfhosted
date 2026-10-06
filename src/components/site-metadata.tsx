import { useRouterState } from "@tanstack/react-router"

import { useSiteName } from "@/hooks/use-site-name"

export function SiteMetadata() {
  const siteName = useSiteName()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    <>
      <title>
        {pathname === "/connexion" ? `Connexion · ${siteName}` : siteName}
      </title>
      <meta
        content={`L’application de gestion de ${siteName} : inventaire, opérations, commandes et recettes.`}
        name="description"
      />
    </>
  )
}
