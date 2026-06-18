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

  const form = new URLSearchParams({ To: to, Body: body })
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
