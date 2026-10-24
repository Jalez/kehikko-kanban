import { LIMITS, trackerReadingResult, type EpicPart, type TrackerMissing, type TrackerReading, type TrackerRow } from 'kehikot-module-protocol'

/**
 * What the board is made of, asked of the host — never of a tracker. The host reads GitHub and
 * GitLab once for every module, with the person's own logins; this page holds no credential.
 *
 * Three questions, each answered at once from the host's reading (`tracker.get`):
 *
 * 1. `{ epic }`: the refs the epic names, in its steps and its umbrella.
 * 2. `{ refs }` for the refs the epic's parts hold that the epic does not name (another module filed
 *    them under a part), so a part's work is on its board.
 * 3. `{ refs }` for the changes that say they close an open issue on the board and are not on it, so
 *    the issue can follow its change into In progress or In review. These are not cards.
 *
 * What the host has not read yet comes back `pending`, and the host starts a read; the page asks
 * again when `context.tracker.at` moves.
 */

export type Request = (method: string, params?: Record<string, unknown>) => Promise<unknown>

export interface BoardReading {
  /** The rows that are cards: the epic's, then its parts'. */
  rows: TrackerRow[]
  /** Every row read, the linked changes included: what an issue looks its changes up in. */
  linked: TrackerRow[]
  missing: TrackerMissing[]
  at: string | null
  refreshing: boolean
  /** Sources whose last read failed, in the host's words. */
  failed: string[]
  /** Every tracker host the rows and sources name: whose avatar hosts the page may load from. */
  hosts: Array<{ tracker: TrackerRow['tracker']; host: string }>
}

const chunks = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = []
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size))
  return out
}

async function get(request: Request, params: Record<string, unknown>): Promise<TrackerReading> {
  return trackerReadingResult.parse(await request('tracker.get', params))
}

async function byRefs(request: Request, refs: readonly string[]): Promise<TrackerReading[]> {
  return Promise.all(chunks(refs, LIMITS.TRACKER_ASK).map((some) => get(request, { refs: some })))
}

export async function readBoard(request: Request, epic: string, parts: readonly EpicPart[]): Promise<BoardReading> {
  const first = await get(request, { epic })
  const named = new Set([...first.rows.map((row) => row.ref), ...first.missing.map((one) => one.ref)])
  const extra = [...new Set(parts.flatMap((part) => part.refs))].filter((ref) => !named.has(ref))
  const second = await byRefs(request, extra)
  const rows = [...first.rows, ...second.flatMap((one) => one.rows)]

  const held = new Set(rows.map((row) => row.ref))
  const closers = [
    ...new Set(
      rows
        .filter((row) => row.kind === 'issue' && row.state === 'open')
        .flatMap((row) => row.links.filter((link) => link.relation === 'closed-by').map((link) => link.ref)),
    ),
  ].filter((ref) => !held.has(ref))
  const third = await byRefs(request, closers)

  const readings = [first, ...second, ...third]
  const sources = readings.flatMap((one) => one.sources)
  return {
    rows,
    linked: [...rows, ...third.flatMap((one) => one.rows)],
    missing: [...first.missing, ...second.flatMap((one) => one.missing)],
    at: readings.map((one) => one.at).filter((at): at is string => at !== null).sort().at(-1) ?? null,
    refreshing: readings.some((one) => one.refreshing),
    failed: [...new Set(sources.filter((one) => one.error).map((one) => `${one.host}/${one.repo}: ${one.error}`))],
    hosts: [...sources, ...rows].map((one) => ({ tracker: one.tracker, host: one.host })),
  }
}

/** What the missing refs come to, in one sentence, or ''. Pending ones are being read now. */
export function missingSaid(missing: readonly TrackerMissing[]): string {
  const count = (reason: TrackerMissing['reason']) => missing.filter((one) => one.reason === reason).length
  const said: string[] = []
  const pending = count('pending')
  const notFound = count('not-found')
  const noTracker = count('no-tracker')
  const failed = count('failed')
  if (pending) said.push(`${pending} item${pending === 1 ? ' is' : 's are'} still being read`)
  if (notFound) said.push(`${notFound} ${notFound === 1 ? 'is' : 'are'} not on ${notFound === 1 ? 'its' : 'their'} tracker`)
  if (noTracker) said.push(`${noTracker} name${noTracker === 1 ? 's' : ''} no tracker this project reads`)
  if (failed) said.push(`${failed} could not be read`)
  if (!said.length) return ''
  const sentence = said.join(', ')
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}
