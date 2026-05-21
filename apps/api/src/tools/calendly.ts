export async function bookCalendly(
  calendlyLink: string | undefined,
  name?: string,
  email?: string
): Promise<string> {
  if (!calendlyLink) return 'No scheduling link configured. Please contact us directly.'
  const url = new URL(calendlyLink)
  if (name) url.searchParams.set('name', name)
  if (email) url.searchParams.set('email', email)
  return `Book a time here: ${url.toString()}`
}
