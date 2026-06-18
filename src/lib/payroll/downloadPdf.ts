/**
 * Fetch a server-rendered PDF of an in-app print page and save it, with no
 * browser print dialog. `path` is the print page (e.g. the current pathname);
 * `name` is the download filename (no extension).
 */
export async function downloadPdf(path: string, name: string): Promise<void> {
  const res = await fetch(`/api/payroll/pdf?path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`)
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}))
    throw new Error(msg.error || `PDF failed (${res.status})`)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
