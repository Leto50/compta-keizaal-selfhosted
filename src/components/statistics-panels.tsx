import { type ReactNode } from "react"
import { statisticsChange } from "../../shared/statistics"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

export function StatisticsPanel({
  title,
  description,
  action,
  children,
  className,
}: Readonly<{
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}>) {
  return (
    <Card
      className={cn(
        "min-w-0 rounded-none border border-[#5b462b]/25 bg-[#fff8e7]/35 ring-0",
        className
      )}
    >
      <CardHeader className="gap-2 px-5 pt-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle className="font-display text-base text-primary">
            <h2>{title}</h2>
          </CardTitle>
          {action}
        </div>
        {description ? (
          <p className="max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="px-5">{children}</CardContent>
    </Card>
  )
}

export function StatisticsMetric({
  label,
  value,
  detail,
  icon,
  comparison,
  accent = false,
}: Readonly<{
  label: string
  value: string
  detail: string
  icon: ReactNode
  accent?: boolean
  comparison?: {
    current: number
    previous: number
    format: (value: number) => string
  }
}>) {
  const change = comparison
    ? statisticsChange(comparison.current, comparison.previous)
    : undefined
  return (
    <div
      className={cn(
        "min-w-0 border-t-2 border-[#5b462b]/30 bg-[#fff8e7]/30 p-4",
        accent && "border-primary bg-primary/[0.06]"
      )}
    >
      <dt className="flex items-center gap-2 text-sm text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
        {icon}
        {label}
      </dt>
      <dd className="mt-3 text-[clamp(1.25rem,2.1vw,1.875rem)] leading-tight font-semibold break-words text-primary tabular-nums">
        {value}
      </dd>
      <dd className="mt-2 text-xs text-muted-foreground">{detail}</dd>
      {comparison && change ? (
        <dd className="mt-3 border-t border-border/60 pt-2 text-xs tabular-nums">
          <span className="font-semibold text-foreground">
            {change.delta > 0 ? "+" : ""}
            {comparison.format(change.delta)}
            {change.percent !== undefined
              ? ` (${change.percent > 0 ? "+" : ""}${formatNumber(change.percent)} %)`
              : ""}
          </span>
          <span className="text-muted-foreground"> vs période précédente</span>
        </dd>
      ) : null}
    </div>
  )
}

export function StatisticsEmpty({
  title = "Aucune donnée sur cette période",
  children,
  action,
}: Readonly<{ title?: string; children: ReactNode; action?: ReactNode }>) {
  return (
    <div className="border border-dashed border-[#5b462b]/35 px-5 py-12 text-center">
      <h2 className="font-display text-lg text-primary">{title}</h2>
      <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
        {children}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
