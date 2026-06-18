# Building Our Own Workyard Replacement — Feasibility Memo

| Field | Value |
|---|---|
| **Project** | Stanton Management Payroll & Invoicing System |
| **Status** | Feasibility assessment — not a build commitment |
| **Created** | 2026-06-18 |
| **Question** | "How hard is it to build our own app to replace Workyard? All we really need is employees taking a photo when they start work, geofencing, and time tracking." |

---

## The Short Answer

**The payroll/back-office half is largely done. The hard, expensive, never-finished half is the field clock-in app — and that's exactly the part you'd be replacing.** "All we really need is a photo and a geofence" is the trap: those two features are the *easy-sounding surface* of a problem (reliable mobile time capture for people who don't want to be tracked) that is genuinely hard to get right and never stops needing maintenance.

This is buildable. It is not a weekend project, and the ongoing cost is the real cost, not the build.

**Recommendation:** Don't replace Workyard to fix the trust problem. The "approved in Workyard ≠ what I got paid" complaint is solved by `IN_APP_TIME_APPROVAL_PRD.md` (move the approval gate in-house) at a tiny fraction of the cost. Replace Workyard only if the *interface itself* becomes an unfixable blocker — and if you do, scope it as a real mobile product, not a feature.

---

## What You Already Have (the back half)

Replacing Workyard is less daunting than it looks because the system it feeds already exists:

- **Property / project / geofence data** — already synced and modeled (`properties`, S-codes, geofence coords from `WORKYARD_API_REFERENCE.md:280-303`).
- **Employee roster with contact info** — `payroll_employees` (phone, email, pay rate, Workyard id).
- **Supabase backend + auth + storage** — photos have a home (Supabase Storage); data has a database.
- **Token-based employee access** — the portal already authenticates employees without full accounts (`/api/portal/token`, hex tokens). A clock-in app could reuse this pattern.
- **Twilio, the payroll math engine, invoicing, ADP export** — the entire downstream is built and would simply consume a new time feed instead of Workyard's.

So you are not starting from zero. You'd be building **one new producer** (the field app) for a consumer (payroll) that already works.

---

## What You'd Have to Build (the hard half)

The deceptively short feature list expands fast once it meets real field conditions:

### 1. A real mobile app
"Take a photo at start of work" + "geofence" means an app **on the worker's phone**, in their pocket, used by non-technical crews in the field. Options:

| Approach | Reality |
|---|---|
| **PWA (web app on phone)** | Cheapest. **But** background geofencing and reliable camera/GPS access are weak-to-impossible in a browser, especially on iOS. Geofence "auto clock-in when you arrive" basically doesn't work in a PWA. Probably a dealbreaker for the geofence requirement. |
| **Native / React Native / Expo** | The realistic path for GPS + camera + background location. Means app-store accounts (Apple $99/yr + Google), review cycles, signing, OTA updates, and supporting two OSes and a long tail of cheap Android phones. |

### 2. Geofencing that actually works
This is the deep end. Workyard's whole business is making this reliable. You'd inherit:
- **Battery vs. accuracy** tradeoffs — aggressive GPS drains batteries; workers turn off location; then you have no data.
- **GPS drift** in cities/near buildings — false "outside the geofence" reads create *new* disputes (the opposite of what you want).
- **Background location permissions** — iOS/Android actively fight persistent tracking; users must opt in repeatedly; "Always Allow" is a hard sell.
- **Spoofing / gaming** — fake-GPS apps, photos of photos, buddy-punching.
- **Offline capture + sync** — job sites have bad signal; the app must queue locally and reconcile later without losing or duplicating entries.

### 3. The clock-in photo pipeline
Capture, compress, upload (often offline-queued), store, and surface in review. Storage cost and a moderation/inspection UI for managers. The photo is evidence, which raises retention and privacy questions.

### 4. Cost allocation at the source
The single most important thing Workyard does for *your payroll* is force time onto a **project** (that's what becomes `property_id`). Your replacement must make on-site allocation effortless and hard to skip — otherwise you've rebuilt Workyard and **kept the unallocated-hours problem you're trying to kill.** This is a UX problem, and it's the one that actually matters for payroll.

### 5. The unglamorous rest
Push notifications, "you forgot to clock out" auto-handling, manager live-map/who's-on-site, edit/correction history, accessibility for a non-technical workforce in possibly multiple languages, and **payroll-grade audit trails** (this data pays people — errors are wage disputes, not bugs).

### 6. Forever-maintenance
iOS/Android break background location with most OS releases. This isn't build-once; it's a product with a permanent maintenance tax. That ongoing burden is precisely what a SaaS subscription buys you out of.

---

## Effort & Risk (rough order of magnitude)

| Scope | Rough effort | Confidence |
|---|---|---|
| PWA: manual clock-in + photo + GPS *snapshot* (no background geofence) | weeks | Medium — but likely fails the geofence requirement |
| Native app: manual clock-in + photo + on-demand GPS + project allocation | a few months | Low-Medium |
| Native app w/ reliable **background** geofencing at Workyard parity | many months + permanent maintenance | Low |

The jump from "GPS snapshot when they tap clock-in" to "automatic, reliable, low-battery background geofencing" is where most of the cost and nearly all the risk lives — and it's the feature you specifically named.

---

## The Decision That Actually Matters

Separate the two pains driving this:

1. **"What's approved in Workyard isn't what's paid."** → A **trust/process** problem. **Fixed cheaply** by `IN_APP_TIME_APPROVAL_PRD.md` — move the approval gate into our app so there's one authoritative number. No new mobile app required.
2. **"The Workyard interface is janky."** → A **product** problem. Only this justifies a replacement, and only if the jank is severe and unfixable via configuration/training.

Most of the frustration in the request is #1. **Build the in-app approval gate first.** It removes the disputes at a fraction of the cost and risk. Revisit a Workyard replacement only if, after that, the interface itself is still a genuine operational blocker.

### If you do decide to replace it
- **Phase it.** Manual clock-in + photo + GPS snapshot + mandatory project pick **first** (a PWA or thin native app). Add background geofencing later, as its own hard project — don't gate v1 on the hardest feature.
- **Run in parallel** with Workyard for at least a few pay cycles before cutting over. Field time capture is unforgiving; a bad week is a payroll incident.
- **Don't lose allocation-at-source.** If the new app makes it easy to clock in without picking a project, you've spent months to recreate your current problem.

---

## Bottom Line

Technically feasible, and your back-end gives you a real head start. But the field app — especially reliable geofencing — is a serious, ongoing mobile product, not a quick build, and it's the wrong tool for the trust problem that's generating most of the upset. **Fix approvals in-house first (cheap, high-impact); treat a Workyard replacement as a separate, deliberately-scoped product decision, not a fix for payday disputes.**
