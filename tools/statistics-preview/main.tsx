import { createRoot } from "react-dom/client"
import {
  createMemoryHistory,
  createRoute,
  createRootRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { AppShell } from "@/components/app-shell"
import { StatisticsPage } from "@/components/statistics-page"
import { TooltipProvider } from "@/components/ui/tooltip"
import "./styles.css"

const root = createRootRoute({
  component: () => (
    <TooltipProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </TooltipProvider>
  ),
})
const statisticsRoute = createRoute({
  getParentRoute: () => root,
  path: "/statistiques",
  component: StatisticsPage,
})
const router = createRouter({
  routeTree: root.addChildren([statisticsRoute]),
  history: createMemoryHistory({ initialEntries: ["/statistiques"] }),
})
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />
)
