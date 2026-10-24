import type { TrackerRow } from 'kehikot-module-protocol'

import type { ColumnId } from './columns.ts'

/**
 * A tracker row as a card: what the board draws and what the MCP door says, worked out from the
 * host's reading alone. Pure, so the page and the server agree on every word.
 *
 * Where a card goes is the TRACKER's say (`tracked`), with the reason in a few words (`why`). A
 * person's or an agent's move is kept apart (`moves.ts`) and laid over it; nothing here knows
 * about moves.
 */

/** What kind of work a card is. GitLab's work item types (protocol 2.11.0) are their own. */
export type CardType =
  | 'issue'
  | 'pr'
  | 'mr'
  | 'task'
  | 'incident'
  | 'test_case'
  | 'requirement'
  | 'objective'
  | 'key_result'
  | 'epic'
  | 'ticket'

export const TYPE_WORDS: Record<CardType, string> = {
  issue: 'Issue',
  pr: 'Pull request',
  mr: 'Merge request',
  task: 'Task',
  incident: 'Incident',
  test_case: 'Test case',
  requirement: 'Requirement',
  objective: 'Objective',
  key_result: 'Key result',
  epic: 'Epic',
  ticket: 'Ticket',
}

/** Where a change's review stands, in the board's words. `asked`: somebody was asked and has not answered. */
export type ReviewWord = 'approved' | 'changes' | 'asked' | 'needed'

export const REVIEW_WORDS: Record<ReviewWord, string> = {
  approved: 'Approved',
  changes: 'Changes requested',
  asked: 'Review requested',
  needed: 'Needs review',
}

export interface CardPerson {
  /** The login on the tracker, when the row names one. */
  login: string | null
  /** Display name, else the login. */
  name: string
  /** An https picture the tracker gave; whether it may be loaded is the page's (`lib/faces.ts`). */
  avatarUrl: string | null
}

export interface Card {
  /** The ref as the epic (or a part) spells it: what a move is kept under. */
  ref: string
  /** Every spelling of it that was read, `ref` first: what ties it to a part. */
  refs: string[]
  /** The item however it is spelled: two spellings of one item are one card. */
  key: string
  tracker: TrackerRow['tracker']
  host: string
  repo: string
  number: number
  type: CardType
  /** `#12` for issues and GitHub pull requests, `!7` for GitLab merge requests. */
  short: string
  title: string
  url: string
  state: TrackerRow['state']
  draft: boolean
  labels: string[]
  assignees: CardPerson[]
  reviewers: Array<CardPerson & { state: NonNullable<TrackerRow['reviewers']>[number]['state'] }>
  review: ReviewWord | null
  /** When it closed or merged, when it did. */
  finishedAt: string | null
  updatedAt: string | null
  /** Where the tracker puts it, and why, in a few words. */
  tracked: ColumnId
  why: string
}

/** A row's identity: one item however it is spelled. GitHub numbers issues and pull requests from one sequence. */
export function keyOf(row: Pick<TrackerRow, 'tracker' | 'host' | 'repo' | 'kind' | 'number'>): string {
  return `${row.tracker}|${row.host}|${row.repo}|${row.tracker === 'github' ? 'n' : row.kind}|${row.number}`
}

export function typeOf(row: Pick<TrackerRow, 'kind' | 'tracker' | 'workItem'>): CardType {
  if (row.kind === 'change') return row.tracker === 'gitlab' ? 'mr' : 'pr'
  return row.workItem ?? 'issue'
}

function personOf(row: TrackerRow, login: string, name?: string): CardPerson {
  const people = row.people
  const known = people && Object.hasOwn(people, login) ? people[login] : undefined
  return { login, name: name || known?.name || login, avatarUrl: known?.avatarUrl ?? null }
}

function assigneesOf(row: TrackerRow): CardPerson[] {
  if (row.assigneeLogins?.length) return row.assigneeLogins.map((login) => personOf(row, login))
  return row.assignees.map((name) => ({ login: null, name, avatarUrl: null }))
}

/** A change's review in the board's words, or null for an issue or a change nobody has a word on. */
export function reviewOf(row: TrackerRow): ReviewWord | null {
  if (row.kind !== 'change') return null
  if (row.review === 'approved') return 'approved'
  if (row.review === 'changes-requested' || row.reviewers?.some((one) => one.state === 'changes')) return 'changes'
  if (row.reviewers?.some((one) => one.state === 'requested')) return 'asked'
  if (row.review === 'required' && row.state === 'open' && !row.draft) return 'needed'
  return null
}

const asked = (row: TrackerRow) => row.reviewers?.some((one) => one.state === 'requested') ?? false
const shortOf = (row: TrackerRow) => `${row.kind === 'change' && row.tracker === 'gitlab' ? '!' : '#'}${row.number}`

/**
 * Where the tracker puts an item, and why.
 *
 * - **Done**: closed or merged.
 * - **In review**: an open pull or merge request that is not a draft, or one whose review was asked
 *   for; an open issue whose change (one that says it closes the issue) is in review.
 * - **In progress**: a draft change nobody was asked to review; an open issue with a draft change,
 *   or with somebody assigned.
 * - **To do**: open, and nobody on it.
 *
 * `linked` holds the rows of the changes that say they close an issue (`links` with `closed-by`), by
 * the ref the link spells; one the reading does not hold is not counted.
 */
export function trackedOf(row: TrackerRow, linked: ReadonlyMap<string, TrackerRow> = new Map()): { column: ColumnId; why: string } {
  const change = row.kind === 'change' ? (row.tracker === 'gitlab' ? 'merge request' : 'pull request') : null
  if (row.state === 'merged') return { column: 'done', why: 'Merged' }
  if (row.state === 'closed') {
    if (row.stateReason === 'NOT_PLANNED') return { column: 'done', why: 'Closed as not planned' }
    if (row.stateReason === 'DUPLICATE') return { column: 'done', why: 'Closed as a duplicate' }
    return { column: 'done', why: change ? `Closed without merging` : 'Closed' }
  }
  if (change) {
    if (asked(row)) return { column: 'review', why: 'Review requested' }
    if (row.draft) return { column: 'progress', why: `Draft ${change}` }
    return { column: 'review', why: `Open ${change}` }
  }
  const changes = row.links
    .filter((link) => link.relation === 'closed-by')
    .map((link) => ({ ref: link.ref, row: linked.get(link.ref) }))
    .filter((one): one is { ref: string; row: TrackerRow } => one.row !== undefined && one.row.state === 'open')
  const reviewed = changes.find((one) => !one.row.draft || asked(one.row))
  if (reviewed) return { column: 'review', why: `${shortOf(reviewed.row)} is in review` }
  const drafted = changes[0]
  if (drafted) return { column: 'progress', why: `Draft ${shortOf(drafted.row)}` }
  const people = assigneesOf(row)
  if (people.length) return { column: 'progress', why: people.length === 1 ? `Assigned to ${people[0]!.name}` : `Assigned to ${people.length} people` }
  return { column: 'todo', why: 'Open, nobody on it' }
}

export function cardOf(row: TrackerRow, linked: ReadonlyMap<string, TrackerRow> = new Map()): Card {
  const { column, why } = trackedOf(row, linked)
  return {
    ref: row.ref,
    refs: [row.ref],
    key: keyOf(row),
    tracker: row.tracker,
    host: row.host,
    repo: row.repo,
    number: row.number,
    type: typeOf(row),
    short: shortOf(row),
    title: row.title,
    url: row.url,
    state: row.state,
    draft: row.draft === true,
    labels: row.labels,
    assignees: assigneesOf(row),
    reviewers: (row.reviewers ?? []).map((one) => ({ ...personOf(row, one.login, one.name), state: one.state })),
    review: reviewOf(row),
    finishedAt: row.mergedAt ?? row.closedAt ?? null,
    updatedAt: row.updatedAt ?? null,
    tracked: column,
    why,
  }
}

/**
 * The cards for a set of rows: one per item (the first spelling wins: the epic's own), in the order
 * the rows came. `linked` is every row read, so an issue can see its changes.
 */
export function cardsOf(rows: readonly TrackerRow[], linked: readonly TrackerRow[] = []): Card[] {
  const byRef = new Map<string, TrackerRow>()
  for (const row of [...linked, ...rows]) byRef.set(row.ref, row)
  const seen = new Map<string, Card>()
  for (const row of rows) {
    const key = keyOf(row)
    const was = seen.get(key)
    if (was) {
      if (!was.refs.includes(row.ref)) was.refs.push(row.ref)
      continue
    }
    seen.set(key, cardOf(row, byRef))
  }
  return [...seen.values()]
}
