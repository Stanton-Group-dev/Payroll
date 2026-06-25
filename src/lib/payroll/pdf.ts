import 'server-only'
import puppeteer, { type Browser } from 'puppeteer-core'

/**
 * Render a page of THIS app to a PDF, server-side, with no browser print dialog.
 *
 * The print pages live behind the /payroll auth gate, so we forward the caller's
 * Supabase session cookies into headless Chrome before navigating — the rendered
 * page sees the same authenticated user and the same data the analyst would.
 *
 * Three launch paths, in priority order:
 *   1. A system Chromium pointed to by PUPPETEER_EXECUTABLE_PATH — this is the production
 *      container path (Railway installs Debian's `chromium` and sets the env var). Most
 *      reliable in a long-running container: apt pulls every shared-lib dependency.
 *   2. AWS Lambda / Vercel — the bundled @sparticuz/chromium binary.
 *   3. Local dev — the Chrome already installed on the machine (`channel: 'chrome'`).
 */

const isServerless = !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.VERCEL

async function launch(): Promise<Browser> {
  // (1) Production container with a system Chromium (Railway).
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
  if (executablePath) {
    return puppeteer.launch({
      executablePath,
      // Flags for headless Chromium as a non-root user in a container:
      //  --no-sandbox / --disable-setuid-sandbox : no user namespaces available.
      //  --disable-dev-shm-usage                 : small /dev/shm would crash the renderer.
      //  --disable-gpu                           : no GPU in the container.
      //  --disable-crash-reporter / --no-zygote  : stop the crashpad handler that fails with
      //                                            "--database is required" and kills launch.
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-crash-reporter',
        '--no-zygote',
      ],
      defaultViewport: { width: 1280, height: 1696 },
      headless: true,
    })
  }
  // (2) Serverless (AWS Lambda / Vercel): bundled chromium.
  if (isServerless) {
    const chromium = (await import('@sparticuz/chromium')).default
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1280, height: 1696 },
      executablePath: await chromium.executablePath(),
      headless: true,
    })
  }
  // (3) Local: drive the system Chrome install (no bundled download).
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
