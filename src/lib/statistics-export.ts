import { statisticsChange, statisticsOrderLabel } from "../../shared/statistics"
import { type StatisticsModel } from "@/hooks/use-statistics"

type Cell = string | number

export function statisticsCsv(model: StatisticsModel) {
  const {
    tab,
    firstDate,
    lastDate,
    batch,
    totals,
    previousTotals,
    hasFinancial,
    hasHarvests,
    showPrices,
    showPurchasePrices,
    canWrite,
    comparisonReady,
    previousPeriod,
    products,
    metric,
    search,
    orderGroups,
  } = model
  const date = (value: number) => new Date(value).toISOString().slice(0, 10)
  const rows: Cell[][] =
    tab === "orders"
      ? [
          [
            "Situation actuelle des commandes",
            "Indépendante de la période",
            "Exporté le",
            new Date().toISOString(),
          ],
        ]
      : [
          [
            "Statistiques de la boutique",
            "Du (UTC)",
            date(firstDate),
            "Au (UTC)",
            date(lastDate - 1),
          ],
        ]

  if (tab === "products") {
    rows.push(
      ["Indicateur", metric.label],
      ["Recherche", search],
      [
        "Les parts portent sur toutes les références de la période, avant recherche. Les montants ventilés sont indicatifs, après remise.",
      ],
      ["Produit / lot", metric.label, "Part de la période (%)"]
    )
    for (const product of products)
      rows.push([product.label, product.value, product.share])
    if (showPrices && hasFinancial)
      rows.push(
        [],
        [
          "Montants sans ventilation (septims)",
          "Entrées",
          totals.unattributedIncoming,
          "Sorties",
          totals.unattributedOutgoing,
        ]
      )
  } else if (tab === "orders") {
    rows.push(
      [],
      [
        "Commandes",
        "État",
        "Nombre",
        "Sans opération financière",
        "En retard",
        ...(showPrices
          ? ["Montant prévu restant (septims)", "Sans montant"]
          : []),
      ]
    )
    for (const group of orderGroups)
      for (const entry of group.entries) {
        rows.push([
          group.kind === "client" ? "Clients" : "Fournisseurs",
          statisticsOrderLabel(group.kind, entry.state),
          entry.count,
          entry.pendingCount,
          entry.overdueCount,
          ...(showPrices ? [entry.total, entry.unpricedCount] : []),
        ])
      }
  } else if (tab === "harvests") {
    rows.push(
      [],
      [
        "Date (UTC)",
        "Récoltes",
        "Unités récoltées",
        ...(showPurchasePrices
          ? ["Valeur connue (septims)", "Lignes sans tarif"]
          : []),
      ]
    )
    for (const day of batch.days.filter((day) => day.harvestCount > 0)) {
      rows.push([
        date(day.startsAt),
        day.harvestCount,
        day.harvestQuantity,
        ...(showPurchasePrices ? [day.knownValue, day.unpricedLineCount] : []),
      ])
    }
    rows.push([], ["Ingrédient", "Unités récoltées"])
    for (const product of batch.products.filter(
      (product) => product.harvested > 0
    ))
      rows.push([product.name, product.harvested])
  } else {
    rows.push(
      [
        "Flux du journal avant charges ; aucune reconstitution du bénéfice ou de la caisse.",
      ],
      [],
      [
        "Date (UTC)",
        "Opérations",
        ...(hasFinancial
          ? [
              "Mouvements financiers",
              "Commandes comptabilisées",
              "Échanges aux flux incomplets",
            ]
          : []),
        ...(hasFinancial && showPrices
          ? [
              "Entrées (septims)",
              "Sorties (septims)",
              "Solde des mouvements (septims)",
            ]
          : []),
        ...(hasHarvests ? ["Récoltes", "Unités récoltées"] : []),
        ...(canWrite ? ["Unités fabriquées"] : []),
      ]
    )
    for (const day of batch.days)
      rows.push([
        date(day.startsAt),
        day.transactionCount,
        ...(hasFinancial
          ? [day.financialCount, day.orderCount, day.incompleteFlowCount]
          : []),
        ...(hasFinancial && showPrices
          ? [day.incoming, day.outgoing, day.incoming - day.outgoing]
          : []),
        ...(hasHarvests ? [day.harvestCount, day.harvestQuantity] : []),
        ...(canWrite ? [day.productionQuantity] : []),
      ])
    if (comparisonReady && previousPeriod) {
      rows.push(
        [],
        [
          "Comparaison",
          "Du (UTC)",
          date(previousPeriod.from),
          "Au (UTC)",
          date(previousPeriod.to - 1),
        ],
        [
          "Indicateur",
          "Période sélectionnée",
          "Période précédente",
          "Variation",
          "Variation (%)",
        ]
      )
      const comparisons = [
        {
          label: "Opérations",
          current: totals.transactionCount,
          previous: previousTotals.transactionCount,
        },
        ...(hasFinancial && showPrices
          ? [
              {
                label: "Entrées (septims)",
                current: totals.incoming,
                previous: previousTotals.incoming,
              },
              {
                label: "Sorties (septims)",
                current: totals.outgoing,
                previous: previousTotals.outgoing,
              },
              {
                label: "Solde des mouvements (septims)",
                current: totals.incoming - totals.outgoing,
                previous: previousTotals.incoming - previousTotals.outgoing,
              },
            ]
          : []),
      ]
      for (const entry of comparisons) {
        const change = statisticsChange(entry.current, entry.previous)
        rows.push([
          entry.label,
          entry.current,
          entry.previous,
          change.delta,
          change.percent ?? "",
        ])
      }
      if (previousTotals.incompleteFlowCount)
        rows.push([
          "Échanges aux flux incomplets dans la période précédente",
          previousTotals.incompleteFlowCount,
        ])
    }
  }
  const cell = (value: Cell) => {
    const safe =
      typeof value === "number"
        ? String(value).replace(".", ",")
        : /^[=+@-]/.test(value.trimStart())
          ? `'${value}`
          : value
    return `"${safe.replaceAll('"', '""')}"`
  }
  return "\uFEFF" + rows.map((row) => row.map(cell).join(";")).join("\r\n")
}

export function downloadStatistics(model: StatisticsModel) {
  const url = URL.createObjectURL(
    new Blob([statisticsCsv(model)], { type: "text/csv;charset=utf-8" })
  )
  const link = document.createElement("a")
  link.href = url
  const date = (value: number) => new Date(value).toISOString().slice(0, 10)
  link.download = model.ordersActive
    ? `commandes-situation-${date(Date.now())}.csv`
    : `statistiques-${model.tab}-${date(model.firstDate)}-${date(model.lastDate - 1)}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
