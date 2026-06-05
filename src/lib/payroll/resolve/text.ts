/**
 * Lightweight, dependency-free fuzzy matching for resolving human-typed names
 * ("stan", "park portfolio") to records. Deterministic and auditable — no LLM
 * involved in the actual match, only in extracting the query string.
 */

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(s: string): string[] {
  return normalize(s).split(' ').filter(Boolean)
}

/** Classic Levenshtein distance. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let curr = new Array<number>(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

function ratio(a: string, b: string): number {
  const max = Math.max(a.length, b.length)
  if (max === 0) return 1
  return 1 - levenshtein(a, b) / max
}

/**
 * Score a query against a candidate label in [0,1]. Rewards exact matches,
 * token-prefix matches ("stan" → "Stan Baldyga"), substring containment, and
 * per-token similarity for typos.
 */
export function scoreMatch(query: string, label: string): number {
  const q = normalize(query)
  const l = normalize(label)
  if (!q || !l) return 0
  if (q === l) return 1

  const qTokens = tokens(query)
  const lTokens = tokens(label)

  // Whole-query substring of the label (e.g. "park portfolio" in "park portfolio - stanton mgmt").
  if (l.includes(q)) return 0.95

  // Every query token matches the start of some label token (first-name / partial).
  const allTokensPrefix = qTokens.every((qt) =>
    lTokens.some((lt) => lt.startsWith(qt) || qt.startsWith(lt))
  )
  if (allTokensPrefix) return 0.9

  // Best average token similarity (handles typos like "stna").
  const tokenScores = qTokens.map((qt) =>
    Math.max(0, ...lTokens.map((lt) => ratio(qt, lt)))
  )
  const avgToken = tokenScores.length
    ? tokenScores.reduce((a, b) => a + b, 0) / tokenScores.length
    : 0

  // Whole-string similarity as a floor.
  return Math.max(avgToken, ratio(q, l))
}

export interface Candidate<T> {
  item: T
  label: string
  score: number
}

export type Resolution<T> =
  | { status: 'unique'; match: T; score: number }
  | { status: 'ambiguous'; candidates: Candidate<T>[] }
  | { status: 'none'; candidates: Candidate<T>[] }

/**
 * Resolve a query against items, returning a unique match only when one
 * candidate is both above the acceptance threshold and clearly ahead of the
 * runner-up. Otherwise returns ranked candidates for disambiguation.
 */
export function resolveOne<T>(
  query: string,
  items: T[],
  labelOf: (item: T) => string,
  opts: { accept?: number; margin?: number; limit?: number } = {}
): Resolution<T> {
  const accept = opts.accept ?? 0.6
  const margin = opts.margin ?? 0.12
  const limit = opts.limit ?? 5

  const ranked: Candidate<T>[] = items
    .map((item) => {
      const label = labelOf(item)
      return { item, label, score: scoreMatch(query, label) }
    })
    .sort((a, b) => b.score - a.score)

  const top = ranked[0]
  const second = ranked[1]

  if (!top || top.score < 0.3) {
    return { status: 'none', candidates: ranked.slice(0, limit) }
  }
  const clearWinner =
    top.score >= accept && (!second || top.score - second.score >= margin)
  if (clearWinner) {
    return { status: 'unique', match: top.item, score: top.score }
  }
  return { status: 'ambiguous', candidates: ranked.slice(0, limit) }
}
