import { ConvexQueryClient } from "@convex-dev/react-query"
import { QueryClient, notifyManager } from "@tanstack/react-query"
import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query"

import { createNavigationAuthCache } from "@/lib/navigation-auth-cache"

import { routeTree } from "./routeTree.gen"

export function getRouter() {
  if (typeof document !== "undefined") {
    notifyManager.setScheduler((callback) => {
      window.requestAnimationFrame(callback)
    })
  }

  const convexUrl = import.meta.env.SSR
    ? (process.env.CONVEX_INTERNAL_URL ?? import.meta.env.VITE_CONVEX_URL)
    : import.meta.env.VITE_CONVEX_URL
  if (!convexUrl) {
    throw new Error("VITE_CONVEX_URL n'est pas configurée.")
  }

  const convexQueryClient = new ConvexQueryClient(convexUrl, {
    expectAuth: true,
    initialAuthTokenReuse: true,
  })
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: convexQueryClient.queryFn(),
        queryKeyHashFn: convexQueryClient.hashFn(),
      },
    },
  })
  convexQueryClient.connect(queryClient)

  const router = createTanStackRouter({
    routeTree,
    context: {
      convexQueryClient,
      navigationAuth: createNavigationAuthCache(),
      queryClient,
    },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  })
  setupRouterSsrQueryIntegration({ queryClient, router })

  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
