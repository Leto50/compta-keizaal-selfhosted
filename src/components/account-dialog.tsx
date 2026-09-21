import { useForm } from "@tanstack/react-form"
import { UserPlus, UserRoundCheck } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { authClient } from "@/lib/auth-client"
import { accountFormSchema } from "@/lib/form-schemas"
import {
  internalAccountEmail,
  normalizeAccountIdentifier,
} from "../../shared/account-identifiers"

type AccountRole = "admin" | "user"

function isAccountRole(value: string): value is AccountRole {
  return value === "admin" || value === "user"
}

interface AccountDialogProps {
  onOpenChange: (open: boolean) => void
  open: boolean
}

export function AccountDialog({
  onOpenChange,
  open,
}: Readonly<AccountDialogProps>) {
  const form = useForm({
    defaultValues: {
      identifier: "",
      name: "",
      password: "",
      role: "user" as AccountRole,
    },
    onSubmit: async ({ value }) => {
      const normalizedName = value.name.trim()
      const identifier = normalizeAccountIdentifier(value.identifier)
      try {
        const result = await authClient.admin.createUser({
          data: { username: identifier },
          email: internalAccountEmail(identifier),
          name: normalizedName,
          password: value.password,
          role: value.role,
        })
        if (result.error) {
          toast.error(
            "Impossible de créer le compte. Vérifiez l’identifiant et le mot de passe."
          )
          return
        }

        toast.success(`Le compte de ${normalizedName} a été créé.`)
        handleOpenChange(false)
      } catch {
        toast.error("Impossible de créer le compte.")
      }
    },
    validators: { onSubmit: accountFormSchema },
  })

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) form.reset()
    onOpenChange(nextOpen)
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="max-h-[92svh] overflow-y-auto rounded-[0.2rem] border-[#6a5436] bg-[#eee1c7] ring-0 sm:max-w-lg">
        <DialogHeader className="pr-8">
          <p className="text-[0.66rem] font-bold tracking-[0.2em] text-primary uppercase">
            Administration
          </p>
          <DialogTitle className="font-display text-2xl">
            Créer un compte
          </DialogTitle>
          <DialogDescription>
            Créez un accès employé ou administrateur pour la boutique.
          </DialogDescription>
        </DialogHeader>

        <Alert className="border-primary/25 bg-primary/5">
          <UserRoundCheck aria-hidden="true" />
          <AlertTitle>Accès créé par l’administrateur</AlertTitle>
          <AlertDescription>
            Communiquez le mot de passe initial à la personne concernée par un
            moyen sûr.
          </AlertDescription>
        </Alert>

        <form
          className="grid gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <form.Field name="name">
            {(field) => {
              const invalid =
                field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="account-name">Nom affiché</FieldLabel>
                  <Input
                    aria-invalid={invalid}
                    autoComplete="off"
                    id="account-name"
                    maxLength={100}
                    name="rp-display-name"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Alixard"
                    required
                    value={field.state.value}
                  />
                  {invalid ? (
                    <FieldError errors={field.state.meta.errors} />
                  ) : null}
                </Field>
              )
            }}
          </form.Field>
          <form.Field name="identifier">
            {(field) => {
              const invalid =
                field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="account-identifier">
                    Identifiant de connexion
                  </FieldLabel>
                  <Input
                    aria-invalid={invalid}
                    autoCapitalize="none"
                    autoComplete="username"
                    id="account-identifier"
                    maxLength={30}
                    name="new-username"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="alixard"
                    required
                    spellCheck={false}
                    value={field.state.value}
                  />
                  <FieldDescription>
                    3 à 30 caractères : lettres sans accent, chiffres, points,
                    tirets ou tirets bas.
                  </FieldDescription>
                  {invalid ? (
                    <FieldError errors={field.state.meta.errors} />
                  ) : null}
                </Field>
              )
            }}
          </form.Field>
          <form.Field name="role">
            {(field) => {
              const invalid =
                field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="account-role">Rôle</FieldLabel>
                  <Select
                    name={field.name}
                    onValueChange={(value) => {
                      if (isAccountRole(value)) field.handleChange(value)
                    }}
                    value={field.state.value}
                  >
                    <SelectTrigger
                      aria-invalid={invalid}
                      className="w-full"
                      id="account-role"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">Employé</SelectItem>
                      <SelectItem value="admin">Administrateur</SelectItem>
                    </SelectContent>
                  </Select>
                  {invalid ? (
                    <FieldError errors={field.state.meta.errors} />
                  ) : null}
                </Field>
              )
            }}
          </form.Field>
          <form.Field name="password">
            {(field) => {
              const invalid =
                field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="account-password">
                    Mot de passe initial
                  </FieldLabel>
                  <Input
                    aria-invalid={invalid}
                    autoComplete="new-password"
                    id="account-password"
                    maxLength={128}
                    minLength={12}
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    required
                    type="password"
                    value={field.state.value}
                  />
                  <FieldDescription>
                    Entre 12 et 128 caractères.
                  </FieldDescription>
                  {invalid ? (
                    <FieldError errors={field.state.meta.errors} />
                  ) : null}
                </Field>
              )
            }}
          </form.Field>

          <DialogFooter className="mt-2">
            <Button
              onClick={() => handleOpenChange(false)}
              type="button"
              variant="ghost"
            >
              Annuler
            </Button>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button disabled={isSubmitting} type="submit">
                  {isSubmitting ? (
                    <Spinner
                      aria-hidden="true"
                      className="motion-reduce:animate-none"
                    />
                  ) : (
                    <UserPlus aria-hidden="true" />
                  )}
                  Créer le compte
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
