// Twilio SMS client. SERVER ONLY (reads auth token from env).
//
// Mirrors the Workyard/Monitask client shape: a thin fetch wrapper over the
// provider REST API, with a graceful fallback when the integration isn't
// configured. Here the fallback is a DRY RUN — the message is composed and
// returned (and the caller records it in the outbox) but nothing is actually
// sent. That lets the whole hold-and-notify feature work end-to-end today; going
// live is just a matter of putting TWILIO_* into Infisical.
//
// Config (all via env / Infisical):
//   TWILIO_ACCOUNT_SID   – account SID (starts AC…)
//   TWILIO_AUTH_TOKEN    – auth token
//   TWILIO_FROM_NUMBER   – E.164 sender, e.g. +15551234567 (or a Messaging
//                          Service SID via TWILIO_MESSAGING_SERVICE_SID)
//   TWILIO_MOCK=1        – force dry-run even when the above are set (for testing)

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER
const MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID

/** True only when we have everything needed to actually send a text. */
export function isTwilioConfigured(): boolean {
  return Boolean(ACCOUNT_SID && AUTH_TOKEN && (FROM_NUMBER || MESSAGING_SERVICE_SID))
}

/** Whether sends will be real, or dry-run (no creds, or TWILIO_MOCK forced). */
export function isTwilioLive(): boolean {
  return isTwilioConfigured() && process.env.TWILIO_MOCK !== '1'
}

/**
 * Normalize a phone to E.164 (the only format Twilio's `To` accepts). Employee
 * numbers are stored inconsistently — some already `+1XXXXXXXXXX`, many as
 * `(860) 555-1234` — so without this, ~1/3 of sends would fail at Twilio.
 * Returns null when the input can't be made a plausible US/E.164 number, so the
 * caller can record a clear 'failed' outbox row instead of firing a bad request.
 */
export function toE164(raw: string): string | null {
  const trimmed = raw.trim()
  if (/^\+[1-9]\d{6,14}$/.test(trimmed)) return trimmed // already E.164
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

export type SmsResult =
  | { status: 'sent'; provider: 'twilio'; providerRef: string }
  | { status: 'dry_run'; provider: 'mock'; providerRef: null }
  | { status: 'failed'; provider: 'twilio'; providerRef: null; error: string }

/**
 * Send one SMS. Returns a discriminated result instead of throwing, so the
 * caller can record an outbox row for every attempt (sent / dry_run / failed)
 * and keep processing the rest of the batch.
 */
export async function sendSms(to: string, body: string): Promise<SmsResult> {
  if (!isTwilioLive()) {
    return { status: 'dry_run', provider: 'mock', providerRef: null }
  }

  const e164 = toE164(to)
  if (!e164) {
    return { status: 'failed', provider: 'twilio', providerRef: null, error: `Unsendable phone number: ${to}` }
  }

  const form = new URLSearchParams({ To: e164, Body: body })
  if (MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', MESSAGING_SERVICE_SID)
  else form.set('From', FROM_NUMBER!)

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
        cache: 'no-store',
      },
    )
    const json = (await res.json().catch(() => null)) as { sid?: string; message?: string } | null
    if (!res.ok) {
      return { status: 'failed', provider: 'twilio', providerRef: null, error: json?.message ?? `Twilio ${res.status}` }
    }
    return { status: 'sent', provider: 'twilio', providerRef: json?.sid ?? '' }
  } catch (e: unknown) {
    return { status: 'failed', provider: 'twilio', providerRef: null, error: e instanceof Error ? e.message : 'Twilio request failed' }
  }
}
