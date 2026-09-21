import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { type FunctionReturnType } from "convex/server"
import {
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  ListChecks,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
} from "lucide-react"
import { useState } from "react"

import {
  AccountAccessDialog,
  type ManagedAccount,
} from "@/components/account-access-dialog"
import { AccountDialog } from "@/components/account-dialog"
import { PageHeader } from "@/components/page-header"
import { PageSkeleton } from "@/components/page-skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useHydrated } from "@/hooks/use-hydrated"
import { authClient } from "@/lib/auth-client"
import { formatDate } from "@/lib/format"
import { api } from "../../../convex/_generated/api"

const PAGE_SIZE = 30

type Account = FunctionReturnType<
  typeof api.administration.listAccounts
>[number]
type AuditEntry = FunctionReturnType<
  typeof api.administration.listAuditPage
>["page"][number]
type AdministrationView = "accounts" | "audit"

interface AdministrationSearch {
  view?: AdministrationView
}

interface PaginationState {
  cursor: string | null
  previousCursors: Array<string | null>
}

const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
})

const actionLabels: Readonly<Record<string, string>> = {
  "account.created": "Compte créé",
  "account.deleted": "Compte supprimé",
  "account.disabled": "Accès suspendu",
  "account.password_reset": "Mot de passe remplacé",
  "account.reactivated": "Accès réactivé",
  "account.role_updated": "Rôle modifié",
  "account.sessions_revoked": "Sessions fermées",
  "account.settings_updated": "Paramètres comptables modifiés",
  "bundle.archived": "Lot archivé",
  "bundle.created": "Lot créé",
  "bundle.reactivated": "Lot réactivé",
  "bundle.updated": "Lot modifié",
  "character.archived": "Personnage archivé",
  "character.created": "Personnage créé",
  "character.reactivated": "Personnage réactivé",
  "character.updated": "Personnage modifié",
  "contact.archived": "Contact archivé",
  "contact.reactivated": "Contact réactivé",
  "contact.renamed": "Contact renommé",
  "exchange.recorded": "Échange enregistré",
  "order.created": "Commande créée",
  "order.deleted": "Commande supprimée",
  "order.payment_recorded": "Paiement de commande enregistré",
  "order.payment_updated": "Paiement de commande modifié",
  "order.received": "Réception de commande enregistrée",
  "order.reception_updated": "Réception de commande modifiée",
  "order.status_updated": "Statut de commande modifié",
  "order.updated": "Commande modifiée",
  "product.archived": "Article archivé",
  "product.created": "Article créé",
  "product.reactivated": "Article réactivé",
  "product.stock_adjusted": "Stock ajusté",
  "product.updated": "Article modifié",
  "purchase.recorded": "Achat enregistré",
  "recipe.archived": "Recette archivée",
  "recipe.created": "Recette créée",
  "recipe.reactivated": "Recette réactivée",
  "recipe.updated": "Recette modifiée",
  "sale.recorded": "Vente enregistrée",
  "service.recorded": "Service enregistré",
  "transaction.deleted": "Opération supprimée",
  "transaction.recorded": "Opération enregistrée",
  "transaction.updated": "Opération modifiée",
}

const entityTypeLabels: Readonly<Record<string, string>> = {
  account: "Compte utilisateur",
  account_settings: "Paramètres comptables",
  bundle: "Lot",
  character: "Personnage",
  contact: "Contact",
  order: "Commande",
  product: "Article",
  recipe: "Recette",
  transaction: "Opération",
}

function validateAdministrationSearch(
  search: Record<string, unknown>
): AdministrationSearch {
  return search.view === "audit" ? { view: "audit" } : {}
}

export const Route = createFileRoute("/_app/administration")({
  component: AdministrationPage,
  validateSearch: validateAdministrationSearch,
})

function accountRoleLabel(role: Account["role"]): string {
  return role === "admin" ? "Administrateur" : "Employé"
}

function AccountStatusBadge({ banned }: Readonly<{ banned: boolean }>) {
  return banned ? (
    <Badge variant="destructive">Suspendu</Badge>
  ) : (
    <Badge
      className="border-[#405c43]/25 bg-[#405c43]/[0.08] text-[#405c43]"
      variant="outline"
    >
      Actif
    </Badge>
  )
}

function ManageAccountButton({
  account,
  currentUserId,
  isLastActiveAdmin,
  iconOnly = false,
}: Readonly<{
  account: Account
  currentUserId?: string
  iconOnly?: boolean
  isLastActiveAdmin: boolean
}>) {
  return (
    <AccountAccessDialog
      account={account as ManagedAccount}
      currentUserId={currentUserId}
      isLastActiveAdmin={isLastActiveAdmin}
      trigger={
        <Button
          aria-label={iconOnly ? `Gérer l’accès de ${account.name}` : undefined}
          size={iconOnly ? "icon" : "default"}
          variant="outline"
        >
          <Pencil aria-hidden="true" />
          {iconOnly ? null : "Gérer l’accès"}
        </Button>
      }
    />
  )
}

function AccountsPanel({
  accounts,
  currentUserId,
}: Readonly<{ accounts: Account[]; currentUserId?: string }>) {
  const activeAdminCount = accounts.filter(
    (account) => account.role === "admin" && !account.banned
  ).length

  if (accounts.length === 0) {
    return (
      <Alert className="mt-6 border-primary/20 bg-primary/[0.04]">
        <CircleUserRound aria-hidden="true" />
        <AlertTitle>Aucun compte à afficher</AlertTitle>
        <AlertDescription>
          Créez le premier accès pour commencer à gérer l’équipe.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <>
      <div className="mt-6 grid gap-3 md:hidden">
        {accounts.map((account) => {
          const isLastActiveAdmin =
            account.role === "admin" &&
            !account.banned &&
            activeAdminCount === 1
          return (
            <Card
              className="rounded-none border-[#5b462b]/30 bg-[#fff8e7]/30 ring-0"
              key={account.id}
            >
              <CardHeader>
                <CardTitle className="font-display text-base">
                  {account.name}
                </CardTitle>
                <CardDescription className="break-all">
                  Identifiant · {account.identifier}
                </CardDescription>
                <CardAction>
                  <AccountStatusBadge banned={account.banned} />
                </CardAction>
              </CardHeader>
              <CardContent className="grid gap-4">
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Rôle</dt>
                    <dd className="mt-0.5 font-medium">
                      {accountRoleLabel(account.role)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Créé le</dt>
                    <dd className="mt-0.5 font-medium">
                      {formatDate(account.createdAt)}
                    </dd>
                  </div>
                </dl>
                <ManageAccountButton
                  account={account}
                  currentUserId={currentUserId}
                  isLastActiveAdmin={isLastActiveAdmin}
                />
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="mt-6 hidden overflow-hidden border border-[#5b462b]/30 bg-[#fff8e7]/25 md:block">
        <Table>
          <TableHeader>
            <TableRow className="border-[#5b462b]/25 hover:bg-transparent">
              <TableHead className="pl-4">Compte</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead>État</TableHead>
              <TableHead>Créé le</TableHead>
              <TableHead className="pr-4 text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => {
              const isLastActiveAdmin =
                account.role === "admin" &&
                !account.banned &&
                activeAdminCount === 1
              return (
                <TableRow className="border-[#5b462b]/20" key={account.id}>
                  <TableCell className="max-w-72 pl-4">
                    <p className="truncate font-medium">{account.name}</p>
                    <p className="truncate text-[0.68rem] text-muted-foreground">
                      {account.identifier}
                    </p>
                  </TableCell>
                  <TableCell>{accountRoleLabel(account.role)}</TableCell>
                  <TableCell>
                    <AccountStatusBadge banned={account.banned} />
                  </TableCell>
                  <TableCell>{formatDate(account.createdAt)}</TableCell>
                  <TableCell className="pr-4 text-right">
                    <ManageAccountButton
                      account={account}
                      currentUserId={currentUserId}
                      iconOnly
                      isLastActiveAdmin={isLastActiveAdmin}
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </>
  )
}

function auditActionLabel(action: string): string {
  return actionLabels[action] ?? action.replaceAll(".", " · ")
}

function auditEntityLabel(
  entry: AuditEntry,
  accountsById: ReadonlyMap<string, Account>
): string {
  const account =
    entry.entityType === "account"
      ? accountsById.get(entry.entityId)
      : undefined
  if (account) return `${account.name} · ${account.identifier}`
  const detail = entry.detail?.trim()
  if (!detail) return entry.entityId
  return detail
}

function AuditPanel({
  accounts,
  auditPage,
  isLoading,
  onNext,
  onPrevious,
  previousPageCount,
}: Readonly<{
  accounts: Account[]
  auditPage:
    FunctionReturnType<typeof api.administration.listAuditPage> | undefined
  isLoading: boolean
  onNext: () => void
  onPrevious: () => void
  previousPageCount: number
}>) {
  const accountsById = new Map(
    accounts.map((account) => [account.id, account] as const)
  )
  const entries = auditPage?.page ?? []

  if (isLoading) {
    return (
      <div className="grid min-h-48 place-items-center" role="status">
        <Spinner
          aria-hidden="true"
          className="size-6 text-primary motion-reduce:animate-none"
        />
        <span className="sr-only">Chargement de l’historique d’audit</span>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <Alert className="mt-6 border-primary/20 bg-primary/[0.04]">
        <ListChecks aria-hidden="true" />
        <AlertTitle>Aucune action enregistrée</AlertTitle>
        <AlertDescription>
          Les actions sensibles apparaîtront ici au fil de l’utilisation.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <>
      <div className="mt-6 grid gap-3 md:hidden">
        {entries.map((entry) => (
          <Card
            className="rounded-none border-[#5b462b]/30 bg-[#fff8e7]/30 ring-0"
            key={entry._id}
          >
            <CardHeader>
              <CardTitle className="font-display text-base">
                {auditActionLabel(entry.action)}
              </CardTitle>
              <CardDescription>
                {dateTimeFormatter.format(new Date(entry.createdAt))}
              </CardDescription>
              <CardAction>
                <Badge variant="outline">
                  {entityTypeLabels[entry.entityType] ?? entry.entityType}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-xs">
                <div>
                  <dt className="text-muted-foreground">Par</dt>
                  <dd className="mt-0.5 font-medium">
                    {entry.actor?.name ??
                      entry.actor?.identifier ??
                      "Compte inconnu"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Sur</dt>
                  <dd className="mt-0.5 font-medium break-words">
                    {auditEntityLabel(entry, accountsById)}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 hidden overflow-hidden border border-[#5b462b]/30 bg-[#fff8e7]/25 md:block">
        <Table>
          <TableHeader>
            <TableRow className="border-[#5b462b]/25 hover:bg-transparent">
              <TableHead className="pl-4">Date</TableHead>
              <TableHead>Personne</TableHead>
              <TableHead>Action</TableHead>
              <TableHead className="pr-4">Élément concerné</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow className="border-[#5b462b]/20" key={entry._id}>
                <TableCell className="pl-4 text-muted-foreground">
                  {dateTimeFormatter.format(new Date(entry.createdAt))}
                </TableCell>
                <TableCell>
                  <p className="font-medium">
                    {entry.actor?.name ?? "Compte inconnu"}
                  </p>
                  {entry.actor?.identifier ? (
                    <p className="text-[0.68rem] text-muted-foreground">
                      {entry.actor.identifier}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell>
                  <p className="font-medium">
                    {auditActionLabel(entry.action)}
                  </p>
                  <p className="text-[0.68rem] text-muted-foreground">
                    {entityTypeLabels[entry.entityType] ?? entry.entityType}
                  </p>
                </TableCell>
                <TableCell className="max-w-80 pr-4 whitespace-normal">
                  <span className="break-words">
                    {auditEntityLabel(entry, accountsById)}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <nav
        aria-label="Pagination de l’historique"
        className="mt-4 flex items-center justify-between gap-3"
      >
        <Button
          disabled={previousPageCount === 0}
          onClick={onPrevious}
          variant="outline"
        >
          <ChevronLeft aria-hidden="true" />
          Précédent
        </Button>
        <span className="text-xs text-muted-foreground">
          Page {previousPageCount + 1}
        </span>
        <Button
          disabled={!auditPage || auditPage.isDone}
          onClick={onNext}
          variant="outline"
        >
          Suivant
          <ChevronRight aria-hidden="true" />
        </Button>
      </nav>
    </>
  )
}

function RestrictedAdministration() {
  return (
    <div className="animate-in duration-300 fade-in motion-reduce:animate-none">
      <PageHeader eyebrow="Administration" title="Accès réservé">
        Cette page contient les comptes de l’équipe et les actions sensibles de
        la boutique.
      </PageHeader>
      <Alert className="mt-7 border-destructive/25 bg-destructive/5">
        <ShieldAlert aria-hidden="true" />
        <AlertTitle>Autorisation administrateur requise</AlertTitle>
        <AlertDescription>
          Votre compte ne dispose pas des droits nécessaires pour consulter
          cette page.
        </AlertDescription>
      </Alert>
    </div>
  )
}

function AdministrationPage() {
  const { view = "accounts" } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: session, isPending: isSessionPending } = authClient.useSession()
  const isHydrated = useHydrated()
  const isAdmin = session?.user.role?.split(",").includes("admin") ?? false
  const [isAccountDialogOpen, setIsAccountDialogOpen] = useState(false)
  const [pagination, setPagination] = useState<PaginationState>({
    cursor: null,
    previousCursors: [],
  })
  const accounts = useQuery(
    api.administration.listAccounts,
    isHydrated && isAdmin ? {} : "skip"
  )
  const auditPage = useQuery(
    api.administration.listAuditPage,
    isHydrated && isAdmin && view === "audit"
      ? {
          paginationOpts: {
            cursor: pagination.cursor,
            numItems: PAGE_SIZE,
          },
        }
      : "skip"
  )

  if (!isHydrated || isSessionPending) return <PageSkeleton />
  if (!isAdmin) return <RestrictedAdministration />
  if (accounts === undefined) return <PageSkeleton />

  function showPreviousPage() {
    const previousCursor = pagination.previousCursors.at(-1)
    if (previousCursor === undefined) return
    setPagination({
      cursor: previousCursor,
      previousCursors: pagination.previousCursors.slice(0, -1),
    })
  }

  function showNextPage() {
    if (!auditPage || auditPage.isDone) return
    setPagination({
      cursor: auditPage.continueCursor,
      previousCursors: [...pagination.previousCursors, pagination.cursor],
    })
  }

  function setView(nextView: string) {
    if (nextView !== "accounts" && nextView !== "audit") return
    void navigate({
      replace: true,
      search: nextView === "audit" ? { view: "audit" } : {},
    })
  }

  return (
    <div className="animate-in duration-300 fade-in slide-in-from-bottom-1 motion-reduce:animate-none">
      <PageHeader
        action={
          <Button onClick={() => setIsAccountDialogOpen(true)} size="lg">
            <UserPlus aria-hidden="true" />
            Créer un compte
          </Button>
        }
        eyebrow="Administration"
        title="Accès & audit"
      >
        Gérez qui peut entrer dans l’application et retrouvez les actions
        sensibles réalisées dans la boutique.
      </PageHeader>

      <Tabs className="mt-6" onValueChange={setView} value={view}>
        <TabsList
          aria-label="Sections de l’administration"
          className="h-10 w-full border border-[#5b462b]/25 bg-[#e4d3b4]/55 p-1 sm:w-auto"
        >
          <TabsTrigger className="h-full px-4" value="accounts">
            <ShieldCheck aria-hidden="true" />
            Comptes
          </TabsTrigger>
          <TabsTrigger className="h-full px-4" value="audit">
            <ListChecks aria-hidden="true" />
            Historique d’audit
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {view === "accounts" ? (
        <AccountsPanel accounts={accounts} currentUserId={session?.user.id} />
      ) : (
        <AuditPanel
          accounts={accounts}
          auditPage={auditPage}
          isLoading={auditPage === undefined}
          onNext={showNextPage}
          onPrevious={showPreviousPage}
          previousPageCount={pagination.previousCursors.length}
        />
      )}

      <AccountDialog
        onOpenChange={setIsAccountDialogOpen}
        open={isAccountDialogOpen}
      />
    </div>
  )
}
