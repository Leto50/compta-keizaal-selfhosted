import { authClient } from "@/lib/auth-client"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  BookOpenText,
  Boxes,
  ClipboardList,
  Landmark,
  LayoutDashboard,
  Leaf,
  LogOut,
  ScrollText,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from "lucide-react"
import { type ReactNode, useLayoutEffect, useRef } from "react"

import { ShopMark } from "@/components/shop-mark"
import { Button } from "@/components/ui/button"
import { useHydrated } from "@/hooks/use-hydrated"
import { usePermissions } from "@/hooks/use-permissions"
import { useSiteName } from "@/hooks/use-site-name"
import { type ReaderSection } from "../../shared/reader-access"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"

interface NavigationItem {
  writersOnly?: boolean
  sections?: ReaderSection[]
  icon: LucideIcon
  label: string
  to:
    | "/"
    | "/administration"
    | "/commandes"
    | "/compte"
    | "/inventaire"
    | "/journal"
    | "/personnages"
    | "/recoltes"
    | "/recettes"
}

const navigation: readonly NavigationItem[] = [
  { icon: LayoutDashboard, label: "Aujourd’hui", to: "/" },
  {
    icon: Boxes,
    label: "Inventaire",
    to: "/inventaire",
    sections: ["inventory"],
  },
  {
    icon: ScrollText,
    label: "Transactions",
    to: "/journal",
    sections: ["transactions"],
  },
  { icon: Leaf, label: "Récoltes", to: "/recoltes", writersOnly: true },
  { icon: Landmark, label: "Compte", to: "/compte", sections: ["account"] },
  {
    icon: ClipboardList,
    label: "Commandes",
    to: "/commandes",
    sections: ["orders"],
  },
  {
    icon: BookOpenText,
    label: "Recettes & lots",
    to: "/recettes",
    sections: ["recipes", "bundles"],
  },
]

function Navigation() {
  const { canRead, canWrite } = usePermissions()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const { setOpenMobile } = useSidebar()

  return (
    <SidebarGroup className="px-3">
      <SidebarGroupLabel className="font-semibold tracking-[0.18em] uppercase">
        Gestion
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-1">
          {navigation
            .filter(
              (item) =>
                (!item.writersOnly || canWrite) &&
                (!item.sections || item.sections.some(canRead))
            )
            .map((item) => {
              const Icon = item.icon
              const isActive =
                item.to === "/"
                  ? pathname === item.to
                  : pathname.startsWith(item.to)

              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    className="h-10 text-sm tracking-[0.02em] data-active:border data-active:border-sidebar-border data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
                    isActive={isActive}
                    tooltip={item.label}
                  >
                    <Link onClick={() => setOpenMobile(false)} to={item.to}>
                      <Icon aria-hidden="true" strokeWidth={1.7} />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function Brand() {
  const siteName = useSiteName()
  const brandRef = useRef<HTMLDivElement>(null)
  const logoRef = useRef<HTMLDivElement>(null)
  const copyRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLParagraphElement>(null)
  const subtitleRef = useRef<HTMLParagraphElement>(null)

  useLayoutEffect(() => {
    const brand = brandRef.current
    const logo = logoRef.current
    const copy = copyRef.current
    const title = titleRef.current
    const subtitle = subtitleRef.current
    if (!brand || !logo || !copy || !title || !subtitle) return

    const fit = () => {
      brand.style.removeProperty("flex-direction")
      brand.style.removeProperty("align-items")
      brand.style.removeProperty("gap")
      logo.style.removeProperty("width")
      logo.style.removeProperty("height")
      copy.style.removeProperty("width")
      title.style.removeProperty("font-size")
      title.style.removeProperty("line-height")
      subtitle.style.removeProperty("line-height")
      subtitle.style.removeProperty("letter-spacing")
      if (!copy.clientWidth) return

      let lineHeight = Number.parseFloat(getComputedStyle(title).lineHeight)
      const resizeLogo = () => {
        const size = copy.getBoundingClientRect().height
        logo.style.width = `${size}px`
        logo.style.height = `${size}px`
      }

      if (title.getBoundingClientRect().height > lineHeight + 0.5) {
        title.style.fontSize = "0.9375rem"
        brand.style.gap = "0.5rem"
      }

      if (title.getBoundingClientRect().height > lineHeight + 0.5) {
        title.style.lineHeight = "1.125rem"
        const context = document.createElement("canvas").getContext("2d")
        if (context) {
          const style = getComputedStyle(title)
          context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
          const metrics = context.measureText(siteName)
          // Leave space between lines even for taller fallback glyphs.
          title.style.lineHeight = `${Math.max(Number.parseFloat(style.fontSize) * 1.2, metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent + 2)}px`
        }
        subtitle.style.lineHeight = "0.75rem"
        lineHeight = Number.parseFloat(getComputedStyle(title).lineHeight)
        resizeLogo()
      }

      // Give tall names the full width instead of narrowing them further.
      if (title.getBoundingClientRect().height > lineHeight * 2 + 0.5) {
        brand.style.flexDirection = "column"
        brand.style.alignItems = "flex-start"
        brand.style.removeProperty("gap")
        copy.style.width = "100%"
        resizeLogo()
      }

      const range = document.createRange()
      range.selectNodeContents(subtitle)
      const excess = range.getBoundingClientRect().width - subtitle.clientWidth
      if (excess > 0) {
        const tracking = Number.parseFloat(
          getComputedStyle(subtitle).letterSpacing
        )
        subtitle.style.letterSpacing = `${Math.max(0, tracking - (excess + 1) / (subtitle.textContent?.length || 1))}px`
      }
    }

    const observer = new ResizeObserver(fit)
    observer.observe(brand)
    document.fonts.addEventListener("loadingdone", fit)
    fit()
    return () => {
      observer.disconnect()
      document.fonts.removeEventListener("loadingdone", fit)
    }
  }, [siteName])

  return (
    <div
      className="flex items-center gap-3 overflow-hidden px-1 py-2"
      ref={brandRef}
    >
      <div className="size-9 shrink-0" ref={logoRef}>
        <ShopMark className="size-full text-sidebar-primary" />
      </div>
      <div
        className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden"
        ref={copyRef}
      >
        <p
          className="font-display text-base leading-6 tracking-[0.12em] text-balance [overflow-wrap:anywhere] text-sidebar-foreground"
          ref={titleRef}
          title={siteName}
        >
          {siteName}
        </p>
        <p
          className="text-[0.62rem] tracking-[0.22em] whitespace-nowrap text-sidebar-foreground/60 uppercase"
          ref={subtitleRef}
        >
          Gestion de boutique
        </p>
      </div>
    </div>
  )
}

function Administration() {
  const { isAdmin } = usePermissions()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const { setOpenMobile } = useSidebar()
  const isHydrated = useHydrated()

  if (!isHydrated || !isAdmin) return null

  return (
    <SidebarGroup className="px-3">
      <SidebarGroupLabel className="font-semibold tracking-[0.18em] uppercase">
        Administration
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-1">
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="h-10 text-sm tracking-[0.02em] data-active:border data-active:border-sidebar-border data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
              isActive={pathname.startsWith("/personnages")}
              tooltip="Personnages"
            >
              <Link onClick={() => setOpenMobile(false)} to="/personnages">
                <UsersRound aria-hidden="true" strokeWidth={1.7} />
                <span>Personnages</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="h-10 text-sm tracking-[0.02em]"
              isActive={pathname.startsWith("/administration")}
              tooltip="Accès et réglages"
            >
              <Link onClick={() => setOpenMobile(false)} to="/administration">
                <ShieldCheck aria-hidden="true" strokeWidth={1.7} />
                <span>Accès & réglages</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function SignOutButton() {
  const { data: session } = authClient.useSession()
  const isHydrated = useHydrated()
  const { isReader } = usePermissions()

  async function handleSignOut() {
    await authClient.signOut()
    window.location.assign("/connexion")
  }

  return (
    <>
      <p className="truncate px-2 text-xs text-sidebar-foreground/65 group-data-[collapsible=icon]:hidden">
        {isHydrated ? (session?.user.name ?? "Employé") : "Employé"}
      </p>
      {isReader ? (
        <p className="px-2 text-xs text-sidebar-foreground/65 group-data-[collapsible=icon]:hidden">
          Lecteur · lecture seule
        </p>
      ) : null}
      <Button
        className="w-full justify-start text-sidebar-foreground/80 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:p-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        onClick={handleSignOut}
        size="sm"
        variant="ghost"
      >
        <LogOut aria-hidden="true" />
        <span className="group-data-[collapsible=icon]:hidden">
          Se déconnecter
        </span>
      </Button>
    </>
  )
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const siteName = useSiteName()
  return (
    <SidebarProvider
      className="bg-[#181611] bg-[radial-gradient(circle_at_20%_10%,rgba(30,55,79,0.28),transparent_29rem),radial-gradient(circle_at_90%_75%,rgba(50,75,97,0.14),transparent_32rem)] [--sidebar-width-icon:4rem] [--sidebar-width:17rem]"
      open
    >
      <Sidebar
        className="border-sidebar-border bg-[linear-gradient(150deg,rgba(48,44,35,0.96),rgba(25,24,20,0.99))]"
        collapsible="icon"
      >
        <SidebarHeader className="px-4 pt-5 group-data-[collapsible=icon]:px-2">
          <Brand />
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent className="pt-3">
          <Navigation />
          <Administration />
        </SidebarContent>
        <SidebarFooter className="gap-3 p-4 group-data-[collapsible=icon]:p-2">
          <p className="border-l border-sidebar-primary/50 pl-3 text-xs leading-relaxed text-sidebar-foreground/55 italic group-data-[collapsible=icon]:hidden">
            Inventaire, ventes, achats et commandes.
          </p>
          <SidebarSeparator className="mx-0" />
          <SignOutButton />
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 bg-transparent">
        <header className="sticky top-0 z-30 flex min-h-14 items-center gap-2 border-b border-[#544b3b] bg-[#1e1c17]/95 px-3 py-2 text-[#eee2cc] backdrop-blur-xl sm:px-5 md:hidden">
          <SidebarTrigger
            aria-label="Afficher ou masquer le menu"
            className="text-[#eee2cc] hover:bg-white/5 hover:text-white"
          />
          <span
            className="min-w-0 font-display text-sm tracking-[0.12em] text-balance [overflow-wrap:anywhere]"
            title={siteName}
          >
            {siteName}
          </span>
        </header>

        <main className="p-2 sm:p-5 lg:p-7 xl:p-9">
          <div className="relative mx-auto min-h-[calc(100svh-7rem)] max-w-[92rem] overflow-clip rounded-[0.2rem] border border-[#88775d] bg-[#eee1c7] bg-[radial-gradient(circle_at_12%_18%,rgba(139,102,55,0.08),transparent_23rem),radial-gradient(circle_at_86%_82%,rgba(100,84,49,0.08),transparent_27rem)] p-[clamp(1.25rem,3.4vw,3.5rem)] shadow-[0_24px_70px_rgba(0,0,0,0.34),inset_0_0_70px_rgba(104,76,42,0.08)] before:pointer-events-none before:absolute before:inset-2 before:z-[1] before:border before:border-[#5b462b]/20 max-md:p-4 max-md:before:inset-1 md:min-h-[calc(100svh-4rem)]">
            <div
              aria-hidden="true"
              className="absolute -right-4 -bottom-28 rotate-[-8deg] font-serif text-[clamp(18rem,38vw,36rem)] leading-none text-[#574629]/[0.038] select-none"
            >
              ᚲ
            </div>
            <div className="relative z-10">{children}</div>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
