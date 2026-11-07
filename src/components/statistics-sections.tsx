import { useState } from "react"
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChartNoAxesCombined,
  Leaf,
  Scale,
} from "lucide-react"
import {
  cumulativeStatistics,
  statisticsOrderLabel,
} from "../../shared/statistics"
import {
  formatStatisticsDate,
  type ProductMetric,
  type StatisticsModel,
} from "@/hooks/use-statistics"
import {
  StatisticsChart,
  StatisticsDistribution,
  StatisticsRanking,
} from "@/components/statistics-charts"
import {
  StatisticsEmpty,
  StatisticsMetric,
  StatisticsPanel,
} from "@/components/statistics-panels"
import { HarvestValueAmount } from "@/components/harvest-value-summary"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  formatDecimalSeptims,
  formatNumber,
  operationLabels,
} from "@/lib/format"

export function StatisticsActivity({
  model: m,
}: Readonly<{ model: StatisticsModel }>) {
  const [visual, setVisual] = useState("flows")
  const comparison = (
    current: number,
    previous: number,
    format = formatNumber
  ) => (m.comparisonReady ? { current, previous, format } : undefined)
  const hasMoney = m.hasFinancial && m.showPrices
  const timelineLabels = m.chartPoints(() => [])
  return (
    <div className="space-y-5">
      <dl
        aria-label="Indicateurs de la période"
        className="grid grid-cols-2 gap-3 xl:grid-cols-4"
      >
        {hasMoney ? (
          <>
            <StatisticsMetric
              label={
                m.totals.incompleteFlowCount ? "Entrées connues" : "Entrées"
              }
              value={formatDecimalSeptims(m.totals.incoming)}
              detail="Encaissements du journal"
              icon={<ArrowUpRight />}
              comparison={comparison(
                m.totals.incoming,
                m.previousTotals.incoming,
                formatDecimalSeptims
              )}
            />
            <StatisticsMetric
              label={
                m.totals.incompleteFlowCount ? "Sorties connues" : "Sorties"
              }
              value={formatDecimalSeptims(m.totals.outgoing)}
              detail="Décaissements du journal"
              icon={<ArrowDownLeft />}
              comparison={comparison(
                m.totals.outgoing,
                m.previousTotals.outgoing,
                formatDecimalSeptims
              )}
            />
            <StatisticsMetric
              label="Solde des mouvements"
              value={formatDecimalSeptims(
                m.totals.incoming - m.totals.outgoing
              )}
              detail="Entrées − sorties, avant charges"
              icon={<Scale />}
              accent
              comparison={comparison(
                m.totals.incoming - m.totals.outgoing,
                m.previousTotals.incoming - m.previousTotals.outgoing,
                formatDecimalSeptims
              )}
            />
          </>
        ) : null}
        <StatisticsMetric
          label="Opérations"
          value={formatNumber(m.totals.transactionCount)}
          detail={
            m.hasFinancial
              ? `${formatNumber(m.totals.financialCount)} mouvements financiers`
              : "Enregistrements consultables"
          }
          icon={<ChartNoAxesCombined />}
          comparison={comparison(
            m.totals.transactionCount,
            m.previousTotals.transactionCount
          )}
        />
        {m.hasHarvests && !hasMoney ? (
          <StatisticsMetric
            label="Unités récoltées"
            value={formatNumber(m.totals.harvestQuantity)}
            detail={`${formatNumber(m.totals.harvestCount)} récoltes`}
            icon={<Leaf />}
            comparison={comparison(
              m.totals.harvestQuantity,
              m.previousTotals.harvestQuantity
            )}
          />
        ) : null}
      </dl>
      {m.previousPeriod ? (
        <p className="text-xs text-muted-foreground">
          {m.comparisonReady
            ? `Comparaison du ${formatStatisticsDate(m.previousPeriod.from)} au ${formatStatisticsDate(m.previousPeriod.to - 1)} · même durée.`
            : "Chargement de la période précédente pour la comparaison…"}
          {m.comparisonReady && !m.previousTotals.transactionCount
            ? " Aucune opération sur la période précédente ; aucun pourcentage calculé."
            : ""}
          {m.comparisonReady && m.previousTotals.incompleteFlowCount
            ? " Les flux de la période précédente sont incomplets."
            : ""}
        </p>
      ) : null}
      {hasMoney ? (
        <StatisticsPanel
          title={
            visual === "flows"
              ? "Entrées et sorties"
              : "Solde cumulé de la période"
          }
          description={
            visual === "flows"
              ? "Encaissements et décaissements du journal, après remise. Montants en septims."
              : "Départ à zéro au début de la sélection. Ce cumul ne représente pas la caisse disponible."
          }
          action={
            <div
              className="flex gap-1"
              role="group"
              aria-label="Graphique financier"
            >
              <Button
                size="sm"
                variant={visual === "flows" ? "secondary" : "ghost"}
                aria-pressed={visual === "flows"}
                onClick={() => setVisual("flows")}
              >
                Flux
              </Button>
              <Button
                size="sm"
                variant={visual === "balance" ? "secondary" : "ghost"}
                aria-pressed={visual === "balance"}
                onClick={() => setVisual("balance")}
              >
                Cumul
              </Button>
            </div>
          }
        >
          {visual === "flows" ? (
            <StatisticsChart
              label="Évolution des entrées et sorties"
              points={m.chartPoints((day) => [day.incoming, day.outgoing])}
              series={[
                {
                  label: m.totals.incompleteFlowCount
                    ? "Entrées connues"
                    : "Entrées",
                  color: "#456044",
                },
                {
                  label: m.totals.incompleteFlowCount
                    ? "Sorties connues"
                    : "Sorties",
                  color: "#8a3e2f",
                },
              ]}
              formatValue={formatDecimalSeptims}
              allowDecimals
            />
          ) : (
            <StatisticsChart
              label="Solde cumulé"
              points={cumulativeStatistics(m.timeline).map((point, index) => ({
                label: timelineLabels[index]!.label,
                values: [point.balance],
              }))}
              series={[{ label: "Solde cumulé", color: "#1e374f" }]}
              formatValue={formatDecimalSeptims}
              allowDecimals
              visual="area"
            />
          )}
          <p className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
            Les charges, salaires, taxes et fonds ne sont pas déduits ici. Le
            solde des mouvements ne constitue pas un bénéfice.
          </p>
        </StatisticsPanel>
      ) : null}
      <div className="grid min-w-0 gap-5 xl:grid-cols-[1.4fr_1fr]">
        <StatisticsPanel
          title="Activité enregistrée"
          description="Ventes, achats, récoltes et autres opérations consultables."
        >
          <StatisticsChart
            label="Nombre d’opérations"
            points={m.chartPoints((day) => [day.transactionCount])}
            series={[{ label: "Opérations", color: "#1e374f" }]}
          />
        </StatisticsPanel>
        <StatisticsPanel
          title="Répartition des opérations"
          description="Nombre d’enregistrements par type d’activité."
        >
          <StatisticsDistribution
            label="Répartition des opérations"
            entries={[...m.batch.kinds]
              .sort((a, b) => b.count - a.count)
              .map((e) => ({
                key: e.kind,
                label: operationLabels[e.kind],
                value: e.count,
              }))}
          />
        </StatisticsPanel>
      </div>
    </div>
  )
}

export function StatisticsProducts({
  model: m,
}: Readonly<{ model: StatisticsModel }>) {
  const [visible, setVisible] = useState(20)
  const format = m.moneyMetric ? formatDecimalSeptims : formatNumber
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid w-full gap-1.5 sm:w-64">
          <Label htmlFor="statistics-search">
            Rechercher un produit ou un lot
          </Label>
          <Input
            id="statistics-search"
            placeholder="Nom d’une référence…"
            value={m.search}
            onChange={(e) => {
              m.setSearch(e.target.value)
              setVisible(20)
            }}
          />
        </div>
        <div className="grid w-full gap-1.5 sm:ml-auto sm:w-60">
          <Label htmlFor="statistics-metric">Classer par</Label>
          <Select
            value={m.metric.value}
            onValueChange={(value) => {
              m.setMetricChoice(value as ProductMetric)
              setVisible(20)
            }}
          >
            <SelectTrigger id="statistics-metric">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {m.availableMetrics.map((e) => (
                <SelectItem value={e.value} key={e.value}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {m.totals.unattributedCount > 0 ? (
        <Alert>
          <AlertTitle>Ventilation partielle des références</AlertTitle>
          <AlertDescription>
            {formatNumber(m.totals.unattributedCount)} opérations sans détail
            complet par référence. Les totaux du journal restent inchangés.
            {m.hasFinancial && m.showPrices
              ? ` Montants sans ventilation : ${formatDecimalSeptims(m.totals.unattributedIncoming)} en entrées et ${formatDecimalSeptims(m.totals.unattributedOutgoing)} en sorties.`
              : ""}
          </AlertDescription>
        </Alert>
      ) : null}
      {!m.products.length ? (
        <StatisticsEmpty
          title={
            m.search.trim()
              ? "Aucune référence trouvée"
              : "Aucune référence pour cet indicateur"
          }
          action={
            m.search.trim() ? (
              <Button variant="outline" onClick={() => m.setSearch("")}>
                Effacer la recherche
              </Button>
            ) : undefined
          }
        >
          {m.search.trim()
            ? "Essayez un autre nom ou effacez la recherche."
            : "Choisissez un autre indicateur ou une autre période."}
        </StatisticsEmpty>
      ) : (
        <>
          <StatisticsPanel
            title="Références les plus actives"
            description={`${m.metric.label} · les ${Math.min(8, m.products.length)} premières références${m.search.trim() ? " de la recherche" : ""}.`}
          >
            <StatisticsRanking
              label="Classement des produits et lots"
              entries={m.products.slice(0, 8)}
              formatValue={format}
            />
          </StatisticsPanel>
          <StatisticsPanel
            title="Détail des produits et lots"
            description={`${formatNumber(m.products.length)} référence${m.products.length === 1 ? "" : "s"} affichée${m.products.length === 1 ? "" : "s"} sur ${formatNumber(m.rankedProducts.length)}. Les parts portent sur toute la période, même après recherche.`}
          >
            <Table className="max-sm:[&_td]:px-1 max-sm:[&_th]:px-1">
              <TableHeader>
                <TableRow>
                  <TableHead>Produit / lot</TableHead>
                  <TableHead className="text-right whitespace-normal">
                    {m.metric.label}
                  </TableHead>
                  <TableHead className="text-right">Part</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {m.products.slice(0, visible).map((p) => (
                  <TableRow key={p.key}>
                    <TableCell className="max-w-80 min-w-24 [overflow-wrap:anywhere] whitespace-normal sm:min-w-32">
                      {p.label}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {format(p.value)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(p.share)} %
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {m.products.length > visible ? (
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => setVisible((n) => n + 50)}
              >
                Afficher davantage ({formatNumber(m.products.length - visible)})
              </Button>
            ) : null}
            <p className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              Les lots restent des références distinctes.{" "}
              {m.moneyMetric
                ? "Les montants sont ventilés au prorata des lignes, après remise ; ils ne permettent pas de calculer une marge."
                : "Les quantités reprennent les lignes enregistrées à la date des opérations."}
            </p>
          </StatisticsPanel>
        </>
      )}
    </div>
  )
}

export function StatisticsHarvests({
  model: m,
}: Readonly<{ model: StatisticsModel }>) {
  if (!m.totals.harvestCount)
    return (
      <StatisticsEmpty title="Aucune récolte sur cette période">
        Choisissez une autre période pour consulter les ingrédients récoltés.
      </StatisticsEmpty>
    )
  return (
    <div className="space-y-5">
      <dl className="grid gap-3 sm:grid-cols-2">
        <StatisticsMetric
          label="Unités récoltées"
          value={formatNumber(m.totals.harvestQuantity)}
          detail="Ingrédients ajoutés aux stocks"
          icon={<Leaf />}
        />
        <StatisticsMetric
          label="Récoltes enregistrées"
          value={formatNumber(m.totals.harvestCount)}
          detail="Opérations de récolte sur la période"
          icon={<ChartNoAxesCombined />}
        />
      </dl>
      <StatisticsPanel
        title="Volume des récoltes"
        description="Quantités ajoutées aux stocks, sans mouvement d’argent."
      >
        <StatisticsChart
          label="Unités récoltées"
          points={m.chartPoints((day) => [day.harvestQuantity])}
          series={[{ label: "Unités récoltées", color: "#456044" }]}
        />
      </StatisticsPanel>
      <div className="grid gap-5 xl:grid-cols-2">
        <StatisticsPanel
          title="Ingrédients les plus récoltés"
          description="Les dix premières références de la période."
        >
          <StatisticsRanking
            label="Classement des ingrédients récoltés"
            entries={[...m.batch.products]
              .filter((p) => p.harvested > 0)
              .sort((a, b) => b.harvested - a.harvested)
              .slice(0, 10)
              .map((p) => ({ key: p.key, label: p.name, value: p.harvested }))}
          />
        </StatisticsPanel>
        {m.showPurchasePrices ? (
          <StatisticsPanel
            title="Valeur estimée des récoltes"
            description="Prix d’achat enregistrés au moment de la récolte."
          >
            <HarvestValueAmount
              knownValue={m.totals.knownValue}
              lineCount={m.totals.harvestLineCount}
              unpricedLineCount={m.totals.unpricedLineCount}
            />
            <p className="mt-4 text-sm text-muted-foreground">
              Les prix actuels du catalogue ne remplacent pas les tarifs
              manquants. Cette estimation ne constitue pas un encaissement.
            </p>
          </StatisticsPanel>
        ) : null}
      </div>
    </div>
  )
}

export function StatisticsOrders({
  model: m,
}: Readonly<{ model: StatisticsModel }>) {
  return (
    <div className="space-y-5">
      <div className="border-l-2 border-primary py-1 pl-4">
        <h2 className="font-display text-lg text-primary">
          Situation actuelle des commandes
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Toutes les commandes consultables, indépendamment de la période
          d’activité. Les statuts décrivent la situation actuelle ; leur
          historique n’est pas enregistré.
        </p>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        {m.orderGroups.map((group) => {
          const total = group.entries.reduce((sum, e) => sum + e.count, 0)
          const overdue = group.entries.reduce(
            (sum, e) => sum + e.overdueCount,
            0
          )
          const pending = group.entries.reduce(
            (sum, e) => sum + e.pendingCount,
            0
          )
          return (
            <StatisticsPanel
              key={group.kind}
              title={
                group.kind === "client"
                  ? "Commandes clients"
                  : "Commandes fournisseurs"
              }
              description={`${formatNumber(total)} commande${total === 1 ? "" : "s"} au total`}
            >
              {total ? (
                <>
                  <StatisticsDistribution
                    label={
                      group.kind === "client"
                        ? "Répartition des commandes clients"
                        : "Répartition des commandes fournisseurs"
                    }
                    entries={group.entries.map((e) => ({
                      key: e.state,
                      label: statisticsOrderLabel(group.kind, e.state),
                      value: e.count,
                      color: {
                        open: "#1e374f",
                        ready: "#b18a4b",
                        unsettled: "#8a3e2f",
                        completed: "#456044",
                        cancelled: "#6b7480",
                      }[e.state],
                    }))}
                  />
                  <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border/60 pt-4 text-sm">
                    <p>
                      <strong className={overdue ? "text-destructive" : ""}>
                        {formatNumber(overdue)}
                      </strong>{" "}
                      en retard
                    </p>
                    <p>
                      <strong>{formatNumber(pending)}</strong> sans opération
                      financière
                    </p>
                  </div>
                  {m.showPrices ? (
                    <div className="mt-4 border-t border-border/60 pt-4">
                      <p className="text-sm text-muted-foreground">
                        {group.kind === "client"
                          ? "Montant prévu à encaisser"
                          : "Montant prévu à décaisser"}
                      </p>
                      <p className="mt-2 text-xl font-semibold text-primary tabular-nums">
                        {formatDecimalSeptims(
                          group.entries.reduce((sum, e) => sum + e.total, 0)
                        )}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Hors commandes annulées et paiements déjà enregistrés.
                        {group.entries.some((e) => e.unpricedCount)
                          ? " Valeur partielle : certaines commandes n’ont pas de montant renseigné."
                          : ""}
                      </p>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="py-8 text-sm text-muted-foreground">
                  Aucune commande{" "}
                  {group.kind === "client" ? "client" : "fournisseur"}{" "}
                  enregistrée.
                </p>
              )}
            </StatisticsPanel>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Une commande est terminée lorsque la livraison ou la réception et
        l’opération financière sont enregistrées. Les montants déjà
        comptabilisés apparaissent dans l’activité à la date du journal.
      </p>
    </div>
  )
}
