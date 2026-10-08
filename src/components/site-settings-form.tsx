import { useForm } from "@tanstack/react-form"
import { useMutation } from "convex/react"
import { Save } from "lucide-react"
import { useId } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useSiteName } from "@/hooks/use-site-name"
import { getUserFacingErrorMessage } from "@/lib/errors"
import { siteNameFormSchema } from "@/lib/form-schemas"
import { api } from "../../convex/_generated/api"
import { SITE_NAME_MAX_LENGTH } from "../../shared/site-name"

export function SiteSettingsForm() {
  const siteName = useSiteName()
  const saveSiteName = useMutation(api.administration.saveSiteName)
  const fieldId = useId()
  const form = useForm({
    defaultValues: { name: siteName },
    validators: { onSubmit: siteNameFormSchema },
    onSubmit: async ({ value }) => {
      try {
        const name = await saveSiteName({ name: value.name.trim() })
        form.reset({ name })
        toast.success("Le nom du site a été mis à jour.")
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(
            error,
            "Impossible de modifier le nom du site."
          )
        )
      }
    },
  })

  return (
    <section className="mt-6 max-w-xl" aria-labelledby={`${fieldId}-title`}>
      <h2 className="font-display text-xl" id={`${fieldId}-title`}>
        Identité du site
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Ce nom apparaît dans la navigation, sur la page de connexion et dans le
        titre de l’onglet pour tous les utilisateurs.
      </p>
      <form
        className="mt-5 grid gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <>
              <form.Field name="name">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={fieldId}>Nom du site</FieldLabel>
                      <Input
                        aria-describedby={`${fieldId}-hint`}
                        aria-invalid={invalid}
                        disabled={isSubmitting}
                        id={fieldId}
                        maxLength={SITE_NAME_MAX_LENGTH}
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        required
                        value={field.state.value}
                      />
                      <FieldDescription id={`${fieldId}-hint`}>
                        {SITE_NAME_MAX_LENGTH} caractères maximum.
                      </FieldDescription>
                      {invalid ? (
                        <FieldError errors={field.state.meta.errors} />
                      ) : null}
                    </Field>
                  )
                }}
              </form.Field>
              <Button
                className="justify-self-start"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? (
                  <Spinner
                    aria-hidden="true"
                    className="motion-reduce:animate-none"
                  />
                ) : (
                  <Save aria-hidden="true" />
                )}
                Enregistrer
              </Button>
            </>
          )}
        </form.Subscribe>
      </form>
    </section>
  )
}
