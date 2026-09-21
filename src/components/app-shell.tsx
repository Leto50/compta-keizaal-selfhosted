import { authClient } from "@/lib/auth-client"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  BookOpenText,
  Boxes,
  ClipboardList,
  Landmark,
  LayoutDashboard,
  LogOut,
  ScrollText,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from "lucide-react"
import { type ReactNode } from "react"

import { ShopMark } from "@/components/shop-mark"
import { Button } from "@/components/ui/button"
import { useHydrated } from "@/hooks/use-hydrated"
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
    | "/recettes"
}

const navigation: readonly NavigationItem[] = [
  { icon: LayoutDashboard, label: "Aujourd’hui", to: "/" },
  { icon: Boxes, label: "Inventaire", to: "/inventaire" },
  { icon: ScrollText, label: "Transactions", to: "/journal" },
  { icon: Landmark, label: "Compte", to: "/compte" },
  { icon: ClipboardList, label: "Commandes", to: "/commandes" },
  { icon: BookOpenText, label: "Recettes & lots", to: "/recettes" },
]

function Navigation() {
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
          {navigation.map((item) => {
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
  return (
    <div className="flex items-center gap-3 overflow-hidden px-1 py-2">
      <ShopMark className="size-9 shrink-0 text-sidebar-primary" />
      <div className="min-w-0 group-data-[collapsible=icon]:hidden">
        <p className="truncate font-display text-base tracking-[0.12em] text-sidebar-foreground">
          L’eau d’Roche
        </p>
        <p className="truncate text-[0.62rem] tracking-[0.22em] text-sidebar-foreground/60 uppercase">
          Gestion de boutique
        </p>
      </div>
    </div>
  )
}

function Administration() {
  const { data: session } = authClient.useSession()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const { setOpenMobile } = useSidebar()
  const isHydrated = useHydrated()
  const isAdmin = session?.user.role?.split(",").includes("admin") ?? false

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
              tooltip="Accès et audit"
            >
              <Link onClick={() => setOpenMobile(false)} to="/administration">
                <ShieldCheck aria-hidden="true" strokeWidth={1.7} />
                <span>Accès & audit</span>
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

  async function handleSignOut() {
    await authClient.signOut()
    window.location.assign("/connexion")
  }

  return (
    <>
      <p className="truncate px-2 text-xs text-sidebar-foreground/65 group-data-[collapsible=icon]:hidden">
        {isHydrated ? (session?.user.name ?? "Employé") : "Employé"}
      </p>
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
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-[#544b3b] bg-[#1e1c17]/95 px-3 text-[#eee2cc] backdrop-blur-xl sm:px-5 md:hidden">
          <SidebarTrigger
            aria-label="Afficher ou masquer le menu"
            className="text-[#eee2cc] hover:bg-white/5 hover:text-white"
          />
          <span className="font-display text-sm tracking-[0.12em]">
            L’eau d’Roche
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
