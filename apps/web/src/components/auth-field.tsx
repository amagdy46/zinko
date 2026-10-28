import type { ComponentProps } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/** A labelled input whose error and hint are tied to it for assistive technology; same inline error as the New audit form. */
export function AuthField({
  id,
  label,
  error,
  hint,
  formError,
  ...props
}: Omit<ComponentProps<typeof Input>, "id"> & {
  id: string
  label: string
  error?: string
  hint?: string
  formError?: boolean
}) {
  const described = [
    error === undefined ? null : `${id}-error`,
    formError === true ? "form-error" : null,
    hint === undefined ? null : `${id}-hint`,
  ].filter((value) => value !== null)
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        aria-invalid={error !== undefined || formError === true}
        aria-describedby={described.length === 0 ? undefined : described.join(" ")}
        {...props}
      />
      {error === undefined ? null : (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}

export function FormError({ message }: { message: string | null }) {
  return message === null ? null : (
    <p id="form-error" role="alert" tabIndex={-1} className="text-sm text-destructive outline-none">
      {message}
    </p>
  )
}
