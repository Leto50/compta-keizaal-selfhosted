import { Download } from "lucide-react"
import {
  useStatistics,
  statisticsPeriods,
  formatStatisticsDate,
} from "@/hooks/use-statistics"
import { downloadStatistics } from "@/lib/statistics-export"
import { formatNumber } from "@/lib/format"
import { DatePicker } from "@/components/date-picker"
import { PageHeader } from "@/components/page-header"
import { StatisticsEmpty } from "@/components/statistics-panels"
import {
  StatisticsActivity,
  StatisticsHarvests,
  StatisticsOrders,
  StatisticsProducts,
} from "@/components/statistics-sections"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function StatisticsPage() {
  const m = useStatistics()
  const readyToExport = m.ordersActive
    ? !m.ordersLoading
    : !m.invalidRange &&
      !m.loading &&
      m.totals.transactionCount > 0 &&
      (m.tab !== "activity" || !m.previousPeriod || m.comparisonReady) &&
      (m.tab !== "products" || m.products.length > 0) &&
      (m.tab !== "harvests" || m.totals.harvestCount > 0)
  const loading = m.ordersActive ? m.ordersLoading : m.loading
  const initialLoading = m.ordersActive
    ? m.ordersInitialLoading
    : m.initialLoading
  const financialWarnings =
    m.totals.incompleteFlowCount > 0 &&
    (m.tab === "activity" || m.tab === "products")
  return (
    <div className="animate-in duration-300 fade-in motion-reduce:animate-none">
      <PageHeader
        eyebrow="Le bilan de la boutique"
        title="Statistiques"
        action={
          m.hasHistory || m.hasOrders ? (
            <Button
              variant="outline"
              disabled={!readyToExport}
              onClick={() => downloadStatistics(m)}
            >
              <Download aria-hidden="true" />
              Exporter en CSV
            </Button>
          ) : undefined
        }
      >
        Comprendre les mouvements, les produits et les récoltes de la boutique.
      </PageHeader>
      {!m.hasHistory && !m.hasOrders ? (
        <div className="mt-8">
          <StatisticsEmpty title="Aucune activité consultable">
            L’accès aux statistiques nécessite aussi un accès aux transactions,
            au compte, aux récoltes ou aux commandes.
          </StatisticsEmpty>
        </div>
      ) : (
        <Tabs
          value={m.tab}
          onValueChange={m.setTab}
          className="mt-6 min-w-0 gap-0"
        >
          <TabsList
            variant="line"
            aria-label="Rubriques statistiques"
            className="mb-5 grid h-auto w-full grid-cols-2 justify-start gap-1 border-b border-border/70 p-0 pb-2 group-data-horizontal/tabs:h-auto sm:flex sm:w-fit sm:flex-wrap sm:gap-4 [&>button]:min-h-11 [&>button]:px-2 [&>button]:text-sm"
          >
            {m.hasHistory ? (
              <>
                <TabsTrigger value="activity">Activité</TabsTrigger>
                <TabsTrigger value="products">Produits & lots</TabsTrigger>
              </>
            ) : null}
            {m.hasHarvests ? (
              <TabsTrigger value="harvests">Récoltes</TabsTrigger>
            ) : null}
            {m.hasOrders ? (
              <TabsTrigger value="orders">Commandes</TabsTrigger>
            ) : null}
          </TabsList>
          {!m.ordersActive ? (
            <div className="mb-5 flex flex-wrap items-end gap-3">
              <div className="grid w-full gap-1.5 sm:w-60">
                <Label htmlFor="statistics-period">Période</Label>
                <Select value={m.period} onValueChange={m.setPeriod}>
                  <SelectTrigger id="statistics-period" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statisticsPeriods.map((e) => (
                      <SelectItem value={e.value} key={e.value}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {m.period === "custom" ? (
                <>
                  <div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-48">
                    <Label htmlFor="statistics-from">Du</Label>
                    <DatePicker
                      id="statistics-from"
                      ariaLabel="Début de la période"
                      value={m.fromValue}
                      onChange={m.setFromValue}
                      display="short"
                      max={m.toValue || undefined}
                      required
                      ariaInvalid={m.invalidRange}
                    />
                  </div>
                  <div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-48">
                    <Label htmlFor="statistics-to">Au inclus</Label>
                    <DatePicker
                      id="statistics-to"
                      ariaLabel="Fin de la période"
                      value={m.toValue}
                      onChange={m.setToValue}
                      display="short"
                      min={m.fromValue || undefined}
                      required
                      ariaInvalid={m.invalidRange}
                    />
                  </div>
                </>
              ) : null}
              {m.tab !== "products" ? (
                <div className="grid w-full gap-1.5 sm:ml-auto sm:w-52">
                  <Label htmlFor="statistics-interval">Regrouper par</Label>
                  <Select
                    value={m.intervalChoice}
                    onValueChange={m.setIntervalChoice}
                  >
                    <SelectTrigger id="statistics-interval" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">
                        Automatique ·{" "}
                        {m.safeInterval === "day"
                          ? "jour"
                          : m.safeInterval === "week"
                            ? "semaine"
                            : "mois"}
                      </SelectItem>
                      <SelectItem value="day">Jour</SelectItem>
                      <SelectItem value="week">Semaine</SelectItem>
                      <SelectItem value="month">Mois</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
          ) : null}
          {m.invalidRange && !m.ordersActive ? (
            <Alert>
              <AlertTitle>Période invalide</AlertTitle>
              <AlertDescription>
                Renseignez les deux dates. La fin doit être postérieure ou égale
                au début.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div
                role="status"
                className="mb-5 flex min-h-6 items-center gap-2 text-sm text-muted-foreground"
              >
                {loading ? (
                  <>
                    <Spinner aria-hidden="true" />
                    {initialLoading
                      ? "Chargement des données…"
                      : "Analyse de l’historique en cours · résultats provisoires"}
                  </>
                ) : m.ordersActive ? (
                  "État actuel · toutes les commandes consultables"
                ) : (
                  <span>
                    {formatStatisticsDate(m.firstDate)} —{" "}
                    {formatStatisticsDate(m.lastDate - 1)}{" "}
                    <span className="mx-1 text-border">/</span>{" "}
                    {formatNumber(m.totals.transactionCount)} opération
                    {m.totals.transactionCount === 1 ? "" : "s"}{" "}
                    <span className="text-xs">· dates en UTC</span>
                  </span>
                )}
              </div>
              {!m.ordersActive &&
              m.safeInterval !== m.interval &&
              m.tab !== "products" ? (
                <p className="mb-4 text-xs text-muted-foreground">
                  Graphiques regroupés par mois pour garder cette durée lisible.
                  L’export conserve les dates quotidiennes.
                </p>
              ) : null}
              {initialLoading ? (
                <div
                  aria-label="Chargement des statistiques"
                  className="space-y-5"
                >
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    {[0, 1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-32 rounded-none" />
                    ))}
                  </div>
                  <Skeleton className="h-80 rounded-none" />
                </div>
              ) : (
                <div aria-busy={loading}>
                  {financialWarnings ? (
                    <Alert className="mb-5">
                      <AlertTitle>Flux historiques incomplets</AlertTitle>
                      <AlertDescription>
                        {formatNumber(m.totals.incompleteFlowCount)} anciens
                        échanges ne distinguent pas les achats des ventes. Les
                        flux reprennent les montants connus du Compte ; leur
                        solde reste inclus.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  {!m.ordersActive && !loading && !m.totals.transactionCount ? (
                    <StatisticsEmpty
                      action={
                        m.period !== "all" ? (
                          <Button
                            variant="outline"
                            onClick={() => m.setPeriod("all")}
                          >
                            Voir tout l’historique
                          </Button>
                        ) : undefined
                      }
                    >
                      {m.period === "all"
                        ? "Les statistiques apparaîtront après les premières opérations consultables."
                        : "Essayez une autre période ou consultez tout l’historique."}
                    </StatisticsEmpty>
                  ) : (
                    <>
                      <TabsContent value="activity">
                        <StatisticsActivity model={m} />
                      </TabsContent>
                      <TabsContent value="products">
                        <StatisticsProducts model={m} />
                      </TabsContent>
                      <TabsContent value="harvests">
                        <StatisticsHarvests model={m} />
                      </TabsContent>
                      <TabsContent value="orders">
                        <StatisticsOrders model={m} />
                      </TabsContent>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </Tabs>
      )}
    </div>
  )
}
