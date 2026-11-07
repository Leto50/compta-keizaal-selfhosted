import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { formatNumber } from "@/lib/format"

export interface ChartPoint {
  label: string
  values: number[]
}
const compactNumber = new Intl.NumberFormat("fr-FR", {
  notation: "compact",
  maximumFractionDigits: 1,
})

export function StatisticsChart({
  label,
  points,
  series,
  formatValue = formatNumber,
  allowDecimals = false,
  visual = "bar",
}: Readonly<{
  label: string
  points: ChartPoint[]
  series: { label: string; color: string }[]
  formatValue?: (value: number) => string
  allowDecimals?: boolean
  visual?: "bar" | "area"
}>) {
  if (!points.some((point) => point.values.some((value) => value !== 0)))
    return <EmptyChart />
  const config: ChartConfig = Object.fromEntries(
    series.map((entry, index) => [`series${index}`, entry])
  )
  const data = points.map((point) => ({
    label: point.label,
    ...Object.fromEntries(
      series.map((_, index) => [`series${index}`, point.values[index] ?? 0])
    ),
  }))
  return (
    <figure aria-label={label} className="min-w-0">
      <ChartContainer
        config={config}
        className="aspect-auto h-64 w-full sm:h-72"
      >
        <ComposedChart
          accessibilityLayer
          data={data}
          margin={{ top: 12, right: 4, left: 0, bottom: 0 }}
        >
          <CartesianGrid vertical={false} strokeDasharray="3 4" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={10}
            minTickGap={36}
          />
          <YAxis
            allowDecimals={allowDecimals}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => compactNumber.format(value)}
            width={allowDecimals ? 64 : 40}
          />
          <ReferenceLine y={0} stroke="var(--border)" />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, name) => (
                  <>
                    <span className="text-muted-foreground">
                      {config[String(name)]?.label}
                    </span>
                    <strong className="ml-auto tabular-nums">
                      {formatValue(Number(value))}
                    </strong>
                  </>
                )}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          {series.map((entry, index) =>
            visual === "area" ? (
              <Area
                key={entry.label}
                dataKey={`series${index}`}
                type="linear"
                baseValue={0}
                stroke={`var(--color-series${index})`}
                fill={`var(--color-series${index})`}
                fillOpacity={0.14}
                strokeWidth={2}
                dot={points.length === 1}
                isAnimationActive={false}
              />
            ) : (
              <Bar
                key={entry.label}
                dataKey={`series${index}`}
                fill={`var(--color-series${index})`}
                maxBarSize={32}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
            )
          )}
        </ComposedChart>
      </ChartContainer>
      <figcaption className="sr-only">
        {label}. Utilisez les flèches du clavier pour parcourir les valeurs du
        graphique.
        <ul>
          {points.map((point, index) => (
            <li key={index}>
              {point.label} :{" "}
              {series
                .map(
                  (entry, seriesIndex) =>
                    `${entry.label} ${formatValue(point.values[seriesIndex] ?? 0)}`
                )
                .join(" ; ")}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  )
}

export function StatisticsDistribution({
  label,
  entries,
}: Readonly<{
  label: string
  entries: { key: string; label: string; value: number; color?: string }[]
}>) {
  const total = entries.reduce((sum, entry) => sum + entry.value, 0)
  if (!total) return <EmptyChart />
  return (
    <figure aria-label={label} className="min-w-0">
      <ul className="space-y-4 py-2">
        {entries
          .filter((e) => e.value > 0)
          .map((entry) => (
            <li key={entry.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 break-words">{entry.label}</span>
                <span className="shrink-0 tabular-nums">
                  <strong>{formatNumber(entry.value)}</strong>
                  <span className="ml-3 text-xs text-muted-foreground">
                    {formatNumber((entry.value / total) * 100)} %
                  </span>
                </span>
              </div>
              <div
                aria-hidden="true"
                className="mt-1.5 h-1.5 bg-primary/[0.08]"
              >
                <div
                  className="h-full min-w-px"
                  style={{
                    width: `${(entry.value / total) * 100}%`,
                    backgroundColor: entry.color ?? "#1e374f",
                  }}
                />
              </div>
            </li>
          ))}
      </ul>
    </figure>
  )
}

export function StatisticsRanking({
  label,
  entries,
  formatValue = formatNumber,
}: Readonly<{
  label: string
  entries: { key: string; label: string; value: number }[]
  formatValue?: (value: number) => string
}>) {
  if (!entries.length) return <EmptyChart />
  const max = Math.max(...entries.map((entry) => entry.value))
  return (
    <figure aria-label={label} className="min-w-0">
      <ol className="space-y-4">
        {entries.map((entry, index) => (
          <li
            key={entry.key}
            className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3"
          >
            <span
              aria-hidden="true"
              className="pt-0.5 text-xs text-muted-foreground tabular-nums"
            >
              {index + 1}.
            </span>
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {entry.label}
                </span>
                <strong className="ml-auto shrink-0 tabular-nums">
                  {formatValue(entry.value)}
                </strong>
              </div>
              <div aria-hidden="true" className="mt-2 h-2 bg-primary/[0.08]">
                <div
                  className="h-full bg-primary/75"
                  style={{
                    width: `${max > 0 ? (entry.value / max) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </figure>
  )
}

function EmptyChart() {
  return (
    <p className="py-10 text-center text-sm text-muted-foreground">
      Aucune donnée pour ce graphique sur la période.
    </p>
  )
}
