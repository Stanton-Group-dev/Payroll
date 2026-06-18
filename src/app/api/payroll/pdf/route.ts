import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { renderPagePdf } from '@/lib/payroll/pdf'

// Headless Chrome needs the Node runtime and time to render multi-page statements.
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/payroll/pdf?path=/payroll/<week>/statement/print&name=statement
 * Renders one of the app's own print pages to a downloadable PDF — no browser
 * print dialog. The path must be an in-app print page; we only ever render this
 * deployment's own origin (no arbitrary URLs), so it can't be used to fetch
 * anything else.
 */
export async function GET(req: NextRequest) {
  // Auth: /api isn't covered by the /payroll middleware matcher, so gate here.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const path = req.nextUrl.searchParams.get('path') ?? ''
  const name = (req.nextUrl.searchParams.get('name') ?? 'statement').replace(/[^a-z0-9_-]/gi, '')

  // Only render in-app print/preview pages on our own origin — never an external URL.
  if (!path.startsWith('/payroll/') || !(path.includes('/print') || path.includes('/preview'))) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  const proto = req.headers.get('x-forwarded-proto') ?? 'http'
  const host = req.headers.get('host') ?? req.nextUrl.host
  const origin = `${proto}://${host}`

  try {
    const pdf = await renderPagePdf({
      url: `${origin}${path}`,
      cookieHeader: req.headers.get('cookie') ?? '',
      origin,
    })
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${name}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[payroll/pdf] render failed', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'PDF render failed' },
      { status: 500 },
    )
  }
}
