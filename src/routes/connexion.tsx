import { createFileRoute, redirect } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { AlertCircle, KeyRound } from "lucide-react"
import { useState } from "react"

import { ShopMark } from "@/components/shop-mark"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth-client"
import { loginFormSchema } from "@/lib/form-schemas"
import { normalizeAccountIdentifier } from "../../shared/account-identifiers"

export const Route = createFileRoute("/connexion")({
  beforeLoad: ({ context }) => {
    if (context.isAuthenticated) {
      // TanStack Router redirects are throwable response descriptors, not Errors.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: "/" })
    }
  },
  component: AuthenticationPage,
  head: () => ({ meta: [{ title: "Connexion · L’eau d’Roche 2" }] }),
})

function AuthenticationPage() {
  const [error, setError] = useState<string>()
  const form = useForm({
    defaultValues: { identifier: "", password: "" },
    onSubmit: async ({ value }) => {
      setError(undefined)
      const rawIdentifier = value.identifier.trim()
      const result = rawIdentifier.includes("@")
        ? await authClient.signIn.email({
            email: rawIdentifier.toLowerCase(),
            password: value.password,
          })
        : await authClient.signIn.username({
            password: value.password,
            username: normalizeAccountIdentifier(rawIdentifier),
          })

      if (result.error) {
        setError("Identifiant ou mot de passe incorrect.")
        return
      }

      window.location.assign("/")
    },
    validators: { onSubmit: loginFormSchema },
  })

  return (
    <main className="grid min-h-svh grid-cols-[minmax(0,0.95fr)_minmax(28rem,1.05fr)] bg-[#181611] max-[60rem]:block">
      <div className="flex min-h-svh flex-col justify-center border-r border-[#4e4638] bg-[#1b1914] bg-[radial-gradient(circle_at_22%_34%,rgba(30,55,79,0.34),transparent_24rem)] p-[clamp(3rem,8vw,8rem)] max-[60rem]:hidden">
        <div className="max-w-lg">
          <ShopMark className="size-16 text-[#7895a8]" />
          <p className="mt-8 text-xs tracking-[0.3em] text-[#ad9d80] uppercase">
            Gestion de la boutique
          </p>
          <h1 className="mt-4 font-display text-4xl leading-tight text-[#f0e4ce] sm:text-6xl">
            L’eau d’Roche 2
          </h1>
          <p className="mt-6 max-w-md text-base leading-7 text-[#bcb09d]">
            Inventaire, ventes, achats, commandes et recettes dans un outil
            unique conçu pour la boutique.
          </p>
        </div>
        <p className="mt-14 text-sm text-[#837967] italic">
          Accès réservé aux employés
        </p>
      </div>

      <section className="grid min-h-svh place-items-center bg-[#eee1c7] bg-[radial-gradient(circle_at_70%_18%,rgba(30,55,79,0.10),transparent_20rem)] p-[clamp(1.5rem,6vw,6rem)] shadow-[inset_18px_0_45px_rgba(0,0,0,0.09)]">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 text-[#55452e] lg:hidden">
            <ShopMark />
            <p className="font-display tracking-wider">L’eau d’Roche 2</p>
          </div>
          <p className="text-[0.66rem] font-bold tracking-[0.2em] text-primary uppercase">
            Espace employés
          </p>
          <h2 className="mt-2 font-display text-3xl text-foreground">
            Connexion
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Saisissez l’identifiant et le mot de passe fournis par un
            administrateur. Les anciens comptes peuvent encore utiliser leur
            adresse e-mail.
          </p>

          <form
            className="mt-8 grid gap-5"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void form.handleSubmit()
            }}
          >
            <form.Field name="identifier">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor="login-identifier">
                      Identifiant
                    </FieldLabel>
                    <Input
                      aria-invalid={invalid}
                      autoCapitalize="none"
                      autoComplete="username"
                      id="login-identifier"
                      maxLength={254}
                      name="username"
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      placeholder="alixard"
                      required
                      spellCheck={false}
                      value={field.state.value}
                    />
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
                    <FieldLabel htmlFor={field.name}>Mot de passe</FieldLabel>
                    <Input
                      aria-invalid={invalid}
                      autoComplete="current-password"
                      id={field.name}
                      maxLength={128}
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
            </form.Field>

            {error ? (
              <Alert variant="destructive">
                <AlertCircle aria-hidden="true" />
                <AlertTitle>Connexion impossible</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button
                  className="mt-1 h-10"
                  disabled={isSubmitting}
                  type="submit"
                >
                  {isSubmitting ? (
                    <Spinner
                      aria-hidden="true"
                      className="motion-reduce:animate-none"
                    />
                  ) : (
                    <KeyRound aria-hidden="true" />
                  )}
                  Se connecter
                </Button>
              )}
            </form.Subscribe>
          </form>
        </div>
      </section>
    </main>
  )
}
