import 'server-only'
import puppeteer, { type Browser } from 'puppeteer-core'

/**
 * Render a page of THIS app to a PDF, server-side, with no browser print dialog.
 *
 * The print pages live behind the /payroll auth gate, so we forward the caller's
 * Supabase session cookies into headless Chrome before navigating — the rendered
 * page sees the same authenticated user and the same data the analyst would.
 *
 * Local dev uses the Chrome already installed on the machine (`channel: 'chrome'`);
 * on Vercel/Lambda we use the bundled @sparticuz/chromium binary.
 */

const isServerless = !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.VERCEL

async function launch(): Promise<Browser> {
  if (isServerless) {
    const chromium = (await import('@sparticuz/chromium')).default
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1280, height: 1696 },
      executablePath: await chromium.executablePath(),
      headless: true,
    })
  }
  // Local: drive the system Chrome install (no bundled download).
  return puppeteer.launch({ channel: 'chrome', headless: true })
}

interface RenderOpts {
  /** Absolute URL of the print page to render, e.g. https://host/payroll/<week>/statement/print */
  url: string
  /** Raw `Cookie` header from the incoming request, forwarded to the headless session. */
  cookieHeader: string
  /** Origin used to scope the forwarded cookies, e.g. https://host */
  origin: string
}

export async function renderPagePdf({ url, cookieHeader, origin }: RenderOpts): Promise<Uint8Array> {
  const browser = await launch()
  try {
    const page = await browser.newPage()

    // @supabase/ssr stores the session in document.cookie (not http-only), so the
    // browser Supabase client reads it directly — we must seed page cookies, not
    // just the request header.
    const cookies = cookieHeader
      .split(';')
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => {
        const eq = p.indexOf('=')
        return { name: p.slice(0, eq), value: p.slice(eq + 1), url: origin }
      })
      .filter(c => c.name)
    if (cookies.length) await page.setCookie(...cookies)

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45_000 })

    const pdf = await page.pdf({
      format: 'letter',
      printBackground: true,
      margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
    })
    return pdf
  } finally {
    await browser.close()
  }
}
