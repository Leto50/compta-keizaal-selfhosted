import { createFileRoute } from "@tanstack/react-router"
import { StatisticsPage } from "@/components/statistics-page"
import { PageError } from "@/components/page-error"
import { PageSkeleton } from "@/components/page-skeleton"
import { readerRouteAccess, withReaderAccess } from "@/lib/reader-route-access"

export const Route = createFileRoute("/_app/statistiques")({
  beforeLoad: readerRouteAccess("statistics"),
  component: withReaderAccess(StatisticsPage, "statistics"),
  errorComponent: PageError,
  pendingComponent: PageSkeleton,
})
