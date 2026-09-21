import { type ReactNode } from "react"

export function PageHeader({
  action,
  eyebrow,
  title,
  children,
}: Readonly<{
  action?: ReactNode
  children: ReactNode
  eyebrow: string
  title: string
}>) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5 border-b border-[#5d492e]/45 pb-5 max-md:items-start">
      <div className="min-w-0">
        <p className="text-[0.66rem] font-bold tracking-[0.2em] text-primary uppercase">
          {eyebrow}
        </p>
        <h1 className="mt-1 font-display text-[clamp(1.75rem,3.25vw,2.65rem)] leading-[1.12] font-[570] tracking-[-0.025em] text-[#34291e]">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          {children}
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  )
}
