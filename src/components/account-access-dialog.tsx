import { useForm } from "@tanstack/react-form"
import { useMutation } from "convex/react"
import { api } from "../../convex/_generated/api"
import {
  defaultReaderAccess,
  type ReaderAccess,
} from "../../shared/reader-access"
import { ReaderAccessFields, readerAccessArgs } from "./reader-access-fields"
import { KeyRound, Power, PowerOff, Save, ShieldAlert } from "lucide-react"
import { useState, type ReactNode } from "react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth-client"
import { passwordResetFormSchema } from "@/lib/form-schemas"
import {
  accountRoleLabels,
  isAccountRole,
  type AccountRole,
} from "../../shared/account-roles"

export interface ManagedAccount {
  banned: boolean
  id: string
  identifier: string
  name: string
  role: AccountRole
  readerAccess?: ReaderAccess | null
}

interface AccountAccessDialogProps {
  account: ManagedAccount
  currentUserId?: string
  isLastActiveAdmin: boolean
  trigger: ReactNode
}

function resultError(
  error: { message?: string } | null | undefined,
  fallback: string
): string {
  const message = error?.message?.trim()
  if (!message) return fallback
  return message
}

export function AccountAccessDialog({
  account,
  currentUserId,
  isLastActiveAdmin,
  trigger,
}: Readonly<AccountAccessDialogProps>) {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<AccountRole>(account.role)
  const [access, setAccess] = useState<ReaderAccess>(
    account.readerAccess ?? defaultReaderAccess
  )
  const saveAccess = useMutation(api.administration.saveAccountAccess)
  const accessChanged =
    JSON.stringify(access) !==
    JSON.stringify(account.readerAccess ?? defaultReaderAccess)
  const [isSavingRole, setIsSavingRole] = useState(false)
  const [isChangingStatus, setIsChangingStatus] = useState(false)
  const [isSuspendConfirmationOpen, setIsSuspendConfirmationOpen] =
    useState(false)
  const isCurrentAccount = account.id === currentUserId
  const roleIsProtected = account.role === "admin" && isLastActiveAdmin
  const statusIsProtected = isCurrentAccount || isLastActiveAdmin
  const passwordForm = useForm({
    defaultValues: { confirmation: "", password: "" },
    onSubmit: async ({ value }) => {
      try {
        const passwordResult = await authClient.admin.setUserPassword({
          newPassword: value.password,
          userId: account.id,
        })
        if (passwordResult.error) {
          toast.error(
            resultError(
              passwordResult.error,
              "Impossible de remplacer le mot de passe."
            )
          )
          return
        }

        passwordForm.reset()
        const sessionsResult = await authClient.admin.revokeUserSessions({
          userId: account.id,
        })
        if (sessionsResult.error) {
          toast.warning(
            "Le mot de passe est remplacé, mais certaines sessions n’ont peut-être pas été fermées."
          )
          return
        }

        if (isCurrentAccount) {
          window.location.assign("/connexion")
          return
        }
        toast.success(
          `Le mot de passe de ${account.name} est remplacé et ses sessions sont fermées.`
        )
      } catch {
        toast.error("Impossible de remplacer le mot de passe.")
      }
    },
    validators: { onSubmit: passwordResetFormSchema },
  })

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) {
      setRole(account.role)
      setAccess(account.readerAccess ?? defaultReaderAccess)
    }
    if (!nextOpen) passwordForm.reset()
  }

  async function handleRoleSave() {
    if (role === account.role && !accessChanged) return
    setIsSavingRole(true)
    try {
      await saveAccess({
        role,
        userId: account.id,
        access: readerAccessArgs(access),
      })
      toast.success(
        `L’accès de ${account.name} est enregistré (${accountRoleLabels[role].toLowerCase()}).`
      )
    } catch {
      toast.error("Impossible de modifier cet accès.")
    } finally {
      setIsSavingRole(false)
    }
  }

  async function handleStatusChange() {
    setIsChangingStatus(true)
    try {
      const result = account.banned
        ? await authClient.admin.unbanUser({ userId: account.id })
        : await authClient.admin.banUser({
            banReason: "Accès suspendu par un administrateur",
            userId: account.id,
          })
      if (result.error) {
        toast.error(
          resultError(result.error, "Impossible de modifier cet accès.")
        )
        return
      }
      toast.success(
        account.banned
          ? `L’accès de ${account.name} est réactivé.`
          : `L’accès de ${account.name} est suspendu.`
      )
      setIsSuspendConfirmationOpen(false)
    } catch {
      toast.error("Impossible de modifier cet accès.")
    } finally {
      setIsChangingStatus(false)
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[92svh] overflow-y-auto rounded-[0.2rem] border-[#6a5436] bg-[#eee1c7] ring-0 sm:max-w-xl">
        <DialogHeader className="pr-8">
          <p className="text-[0.66rem] font-bold tracking-[0.2em] text-primary uppercase">
            Gestion d’accès
          </p>
          <DialogTitle className="font-display text-2xl">
            {account.name}
          </DialogTitle>
          <DialogDescription>
            Identifiant · {account.identifier}
          </DialogDescription>
        </DialogHeader>

        {isLastActiveAdmin ? (
          <Alert className="border-primary/25 bg-primary/5">
            <ShieldAlert aria-hidden="true" />
            <AlertTitle>Dernier administrateur actif</AlertTitle>
            <AlertDescription>
              Créez ou promouvez un autre administrateur avant de rétrograder ou
              suspendre ce compte.
            </AlertDescription>
          </Alert>
        ) : null}

        <section
          aria-labelledby={`role-title-${account.id}`}
          className="grid gap-3"
        >
          <div>
            <h3
              className="font-display text-base"
              id={`role-title-${account.id}`}
            >
              Rôle et permissions
            </h3>
            <p className="text-xs text-muted-foreground">
              Les employés gèrent les opérations de la boutique. Les
              administrateurs configurent en plus les personnages, les
              paramètres, les accès et l’historique d’audit.
            </p>
          </div>
          <div className="grid gap-2">
            <div className="grid flex-1 gap-2">
              <Label htmlFor={`account-role-${account.id}`}>Rôle</Label>
              <Select
                onValueChange={(value) => {
                  if (isAccountRole(value)) setRole(value)
                }}
                value={role}
              >
                <SelectTrigger
                  className="w-full"
                  id={`account-role-${account.id}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem disabled={roleIsProtected} value="reader">
                    Lecteur
                  </SelectItem>
                  <SelectItem disabled={roleIsProtected} value="user">
                    Employé
                  </SelectItem>
                  <SelectItem value="admin">Administrateur</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {role === "reader" ? (
            <ReaderAccessFields
              value={access}
              onChange={setAccess}
              disabled={isSavingRole}
            />
          ) : null}
          <Button
            className="w-full sm:w-fit sm:justify-self-end"
            disabled={
              isSavingRole ||
              (role === account.role && !accessChanged) ||
              (role !== "admin" && roleIsProtected)
            }
            onClick={handleRoleSave}
            type="button"
          >
            {isSavingRole ? (
              <Spinner
                aria-hidden="true"
                className="motion-reduce:animate-none"
              />
            ) : (
              <Save aria-hidden="true" />
            )}
            Enregistrer l’accès
          </Button>
        </section>

        <Separator />

        <section
          aria-labelledby={`status-title-${account.id}`}
          className="grid gap-3"
        >
          <div>
            <h3
              className="font-display text-base"
              id={`status-title-${account.id}`}
            >
              État de l’accès
            </h3>
            <p className="text-xs text-muted-foreground">
              Suspendre un accès déconnecte la personne sans supprimer son
              compte ni son historique.
            </p>
          </div>
          {account.banned ? (
            <Button
              className="w-fit"
              disabled={isChangingStatus}
              onClick={handleStatusChange}
              type="button"
              variant="outline"
            >
              {isChangingStatus ? (
                <Spinner
                  aria-hidden="true"
                  className="motion-reduce:animate-none"
                />
              ) : (
                <Power aria-hidden="true" />
              )}
              Réactiver l’accès
            </Button>
          ) : (
            <Button
              className="w-fit"
              disabled={statusIsProtected}
              onClick={() => setIsSuspendConfirmationOpen(true)}
              type="button"
              variant="destructive"
            >
              <PowerOff aria-hidden="true" />
              Suspendre l’accès
            </Button>
          )}
          {isCurrentAccount && !account.banned ? (
            <p className="text-xs text-muted-foreground">
              Vous ne pouvez pas suspendre le compte utilisé actuellement.
            </p>
          ) : null}
        </section>

        <Separator />

        <form
          className="grid gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void passwordForm.handleSubmit()
          }}
        >
          <div>
            <h3 className="font-display text-base">
              Réinitialiser le mot de passe
            </h3>
            <p className="text-xs text-muted-foreground">
              Le nouveau mot de passe est appliqué immédiatement et toutes les
              sessions de ce compte sont fermées.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <passwordForm.Field name="password">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={`account-password-${account.id}`}>
                      Nouveau mot de passe
                    </FieldLabel>
                    <Input
                      aria-invalid={invalid}
                      autoComplete="new-password"
                      id={`account-password-${account.id}`}
                      maxLength={128}
                      minLength={12}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      required
                      type="password"
                      value={field.state.value}
                    />
                    {invalid ? (
                      <FieldError errors={field.state.meta.errors} />
                    ) : null}
                  </Field>
                )
              }}
            </passwordForm.Field>
            <passwordForm.Field name="confirmation">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel
                      htmlFor={`account-password-confirm-${account.id}`}
                    >
                      Confirmer
                    </FieldLabel>
                    <Input
                      aria-invalid={invalid}
                      autoComplete="new-password"
                      id={`account-password-confirm-${account.id}`}
                      maxLength={128}
                      minLength={12}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      required
                      type="password"
                      value={field.state.value}
                    />
                    {invalid ? (
                      <FieldError errors={field.state.meta.errors} />
                    ) : null}
                  </Field>
                )
              }}
            </passwordForm.Field>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Entre 12 et 128 caractères.
            </p>
            <passwordForm.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button disabled={isSubmitting} type="submit" variant="outline">
                  {isSubmitting ? (
                    <Spinner
                      aria-hidden="true"
                      className="motion-reduce:animate-none"
                    />
                  ) : (
                    <KeyRound aria-hidden="true" />
                  )}
                  Remplacer le mot de passe
                </Button>
              )}
            </passwordForm.Subscribe>
          </div>
        </form>

        <DialogFooter>
          <Button onClick={() => setOpen(false)} type="button" variant="ghost">
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog
        onOpenChange={setIsSuspendConfirmationOpen}
        open={isSuspendConfirmationOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Suspendre l’accès de {account.name} ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              La personne sera déconnectée et ne pourra plus ouvrir
              l’application. Son compte et son historique seront conservés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={isChangingStatus}
              onClick={(event) => {
                event.preventDefault()
                void handleStatusChange()
              }}
              variant="destructive"
            >
              {isChangingStatus ? (
                <Spinner
                  aria-hidden="true"
                  className="motion-reduce:animate-none"
                />
              ) : (
                <PowerOff aria-hidden="true" />
              )}
              Suspendre
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
