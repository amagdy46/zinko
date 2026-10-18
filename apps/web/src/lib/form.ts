/** A text field from a submitted form; `FormData.get` may also hold a file, or nothing. */
export const formField = (form: FormData, name: string): string => {
  const value = form.get(name)
  return typeof value === "string" ? value : ""
}
