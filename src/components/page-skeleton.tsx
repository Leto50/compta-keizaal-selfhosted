import { Skeleton } from "@/components/ui/skeleton"

export function PageSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Chargement de la page"
      className="animate-in duration-200 fade-in motion-reduce:animate-none"
      role="status"
    >
      <div className="border-b border-[#5d492e]/60 pb-6">
        <Skeleton className="h-2.5 w-32 rounded-none bg-[#73583a]/15 motion-reduce:animate-none" />
        <Skeleton className="mt-3 h-10 w-72 max-w-full rounded-none bg-[#4b3928]/15 motion-reduce:animate-none" />
        <Skeleton className="mt-4 h-4 w-[34rem] max-w-full rounded-none bg-[#73583a]/10 motion-reduce:animate-none" />
      </div>
      <div className="mt-7 grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-56 rounded-none border border-[#5b462b]/20 bg-[#73583a]/8 motion-reduce:animate-none" />
        <Skeleton className="h-56 rounded-none border border-[#5b462b]/20 bg-[#73583a]/8 motion-reduce:animate-none" />
      </div>
      <span className="sr-only">Les données sont en cours de chargement.</span>
    </div>
  )
}
