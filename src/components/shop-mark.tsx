import { cn } from "@/lib/utils"

export function ShopMark({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-11", className)}
      fill="none"
      viewBox="0 0 64 64"
    >
      <path
        d="M32 3 56 16v32L32 61 8 48V16L32 3Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M32 14c-5 8-11 15-11 23a11 11 0 0 0 22 0c0-8-6-15-11-23Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2.5"
      />
      <path
        d="M25 41c2 3 4 4 7 4 4 0 7-3 8-7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <circle cx="32" cy="32" r="24" stroke="currentColor" opacity=".3" />
    </svg>
  )
}
