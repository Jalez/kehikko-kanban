import { COLUMN_IDS, COLUMN_NAMES, isColumn, type ColumnId } from './columns.ts'

/**
 * A person's (or an agent's) moves on one epic's board, laid over where the tracker puts each card.
 *
 * Nothing here is written to a tracker. A move is a note in the project — "show this card in In
 * review" — kept under the ref, with the column the tracker had it in when it was moved (`from`).
 * A move stands only while the tracker still says `from`: once the tracker itself moves the item
 * (somebody assigns it, its change merges), the tracker's word is newer than the move and the card
 * goes where the tracker says. A move to the column the tracker says IS no move, and is taken off.
 *
 * The order within a column is kept too: `order[column]` is the refs as they were last arranged,
 * and a card it does not name (new to the column) comes first, newest first.
 */

export type Mover = { kind: 'person' } | { kind: 'agent'; name: string }

export interface Move {
  to: ColumnId
  /** Where the tracker put the card when it was moved. */
  from: ColumnId
  by: Mover
  /** When, as an ISO time. */
  at: string
}

export interface EpicMoves {
  moved: Record<string, Move>
  order: Partial<Record<ColumnId, string[]>>
}

export const noMoves = (): EpicMoves => ({ moved: {}, order: {} })

/** How many moves one epic keeps, and how many refs one column's order names. */
export const MOVED_MAX = 1000
export const ORDER_MAX = 1000
/** A ref as kept: a qualified GitLab spelling can be long, never a document. */
export const REF_MAX = 200
/** An agent names itself in a few words. */
export const AGENT_NAME_MAX = 60

const own = <T>(record: Record<string, T>, key: string): T | undefined => (Object.hasOwn(record, key) ? record[key] : undefined)

export function isRef(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= REF_MAX && !/[\u0000-\u001f]/.test(value)
}

/** A mover read back from a file, or null. */
export function moverOf(value: unknown): Mover | null {
  const one = value as { kind?: unknown; name?: unknown } | null
  if (one?.kind === 'person') return { kind: 'person' }
  if (one?.kind === 'agent' && typeof one.name === 'string' && one.name.trim()) {
    return { kind: 'agent', name: one.name.trim().slice(0, AGENT_NAME_MAX) }
  }
  return null
}

/** One epic's moves read back from a file: anything that does not read is left out, never guessed. */
export function epicMovesOf(value: unknown): EpicMoves {
  const raw = (value ?? {}) as { moved?: unknown; order?: unknown }
  const out = noMoves()
  if (raw.moved && typeof raw.moved === 'object') {
    for (const [ref, one] of Object.entries(raw.moved as Record<string, unknown>).slice(0, MOVED_MAX)) {
      const move = one as Partial<Move> | null
      const by = moverOf(move?.by)
      if (isRef(ref) && move && isColumn(move.to) && isColumn(move.from) && move.to !== move.from && by && typeof move.at === 'string') {
        out.moved[ref] = { to: move.to, from: move.from, by, at: move.at }
      }
    }
  }
  if (raw.order && typeof raw.order === 'object') {
    for (const column of COLUMN_IDS) {
      const list = own(raw.order as Record<string, unknown>, column)
      if (Array.isArray(list)) out.order[column] = [...new Set(list.filter(isRef))].slice(0, ORDER_MAX)
    }
  }
  return out
}

/** The move that stands for a card, or null: none kept, or the tracker has moved the item since. */
export function standingMove(moves: EpicMoves, card: { ref: string; tracked: ColumnId }): Move | null {
  const move = own(moves.moved, card.ref)
  return move && move.from === card.tracked && move.to !== card.tracked ? move : null
}

/** Where a card is shown: where its standing move put it, else where the tracker has it. */
export function columnOf(moves: EpicMoves, card: { ref: string; tracked: ColumnId }): ColumnId {
  return standingMove(moves, card)?.to ?? card.tracked
}

/** "Moved here by you", "Moved here by an agent (Claude Code)": the mark on a moved card. */
export function movedSaid(move: Move): string {
  return move.by.kind === 'person' ? 'Moved here by you' : `Moved here by an agent (${move.by.name})`
}

export interface MoveAsked {
  ref: string
  to: ColumnId
  /** Where the tracker has the card now. */
  tracked: ColumnId
  by: Mover
  at: string
}

/**
 * Move a card to `to`, at `index` among `columnRefs` — the refs of the cards shown in `to` now, in
 * order, the moved card left out or not. A move to where the tracker has it takes any move off; a
 * move within the column it is shown in keeps the move it had (and who made it). Pure.
 */
export function moveCard(moves: EpicMoves, asked: MoveAsked, columnRefs: readonly string[], index: number): EpicMoves {
  const moved = { ...moves.moved }
  const was = own(moved, asked.ref)
  const standing = was && was.from === asked.tracked && was.to !== asked.tracked ? was : null
  if (asked.to === asked.tracked) delete moved[asked.ref]
  else if (!(standing && standing.to === asked.to)) moved[asked.ref] = { to: asked.to, from: asked.tracked, by: asked.by, at: asked.at }

  const order: EpicMoves['order'] = {}
  for (const column of COLUMN_IDS) {
    const list = moves.order[column]
    if (list && column !== asked.to) order[column] = list.filter((ref) => ref !== asked.ref)
  }
  const rest = columnRefs.filter((ref) => ref !== asked.ref)
  const at = Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : rest.length, rest.length))
  order[asked.to] = [...rest.slice(0, at), asked.ref, ...rest.slice(at)].slice(0, ORDER_MAX)

  const kept = Object.entries(moved)
  return { moved: kept.length > MOVED_MAX ? Object.fromEntries(kept.slice(-MOVED_MAX)) : moved, order }
}

/** Put one card back where the tracker has it. Its place in the order is left to the order. */
export function resetCard(moves: EpicMoves, ref: string): EpicMoves {
  if (!Object.hasOwn(moves.moved, ref)) return moves
  const moved = { ...moves.moved }
  delete moved[ref]
  return { moved, order: moves.order }
}

/** Every card back where the tracker has it, and every column in its own order again. */
export const resetAll = (): EpicMoves => noMoves()

export const isEmpty = (moves: EpicMoves): boolean =>
  Object.keys(moves.moved).length === 0 && COLUMN_IDS.every((column) => !moves.order[column]?.length)

/* ------------------------------------------------------------------ *
 * The board, placed.
 * ------------------------------------------------------------------ */

export interface BoardSettings {
  /** Which columns are shown. */
  columns: Record<ColumnId, boolean>
  /** How many days a closed or merged item stays in Done. 0: every one. */
  doneDays: number
}

export const DEFAULT_SETTINGS: BoardSettings = {
  columns: { todo: true, progress: true, review: true, done: true },
  doneDays: 14,
}

/** What placing needs of a card. */
export interface Placeable {
  ref: string
  tracked: ColumnId
  finishedAt: string | null
  updatedAt: string | null
  number: number
}

export interface Placed<C extends Placeable> {
  card: C
  column: ColumnId
  move: Move | null
}

export interface BoardColumn<C extends Placeable> {
  id: ColumnId
  name: string
  /** Whether the settings show it. */
  shown: boolean
  cards: Placed<C>[]
  /** Finished items older than the settings keep, left off Done. */
  older: number
}

const DAY_MS = 86_400_000
const time = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0)

/** Whether a card shown in Done is recent enough to stay. One with no time it finished stays: when is unknown. */
export function recentEnough(card: Placeable, column: ColumnId, settings: BoardSettings, now: number): boolean {
  if (column !== 'done' || settings.doneDays <= 0 || !card.finishedAt) return true
  return now - time(card.finishedAt) <= settings.doneDays * DAY_MS
}

/**
 * Every column with its cards in order: those the kept order does not name first (newest first:
 * finished last for Done, updated last for the rest), then the kept order. Every column is there,
 * shown or not, so a caller says what a hidden column holds.
 */
export function place<C extends Placeable>(cards: readonly C[], moves: EpicMoves, settings: BoardSettings, now: number): BoardColumn<C>[] {
  return COLUMN_IDS.map((id) => {
    const here: Placed<C>[] = []
    let older = 0
    for (const card of cards) {
      const move = standingMove(moves, card)
      const column = move?.to ?? card.tracked
      if (column !== id) continue
      if (!recentEnough(card, column, settings, now)) {
        older += 1
        continue
      }
      here.push({ card, column, move })
    }
    const kept = moves.order[id] ?? []
    const rank = new Map(kept.map((ref, at) => [ref, at]))
    const newest = (a: Placed<C>, b: Placed<C>) =>
      (id === 'done' ? time(b.card.finishedAt) - time(a.card.finishedAt) : 0) ||
      time(b.card.updatedAt) - time(a.card.updatedAt) ||
      b.card.number - a.card.number
    here.sort((a, b) => {
      const ra = rank.get(a.card.ref)
      const rb = rank.get(b.card.ref)
      if (ra === undefined && rb === undefined) return newest(a, b)
      if (ra === undefined) return -1
      if (rb === undefined) return 1
      return ra - rb
    })
    return { id, name: COLUMN_NAMES[id], shown: settings.columns[id], cards: here, older }
  })
}

/** The refs shown in one column, in order: what `moveCard` places among. */
export function refsIn<C extends Placeable>(board: readonly BoardColumn<C>[], column: ColumnId): string[] {
  return board.find((one) => one.id === column)?.cards.map((one) => one.card.ref) ?? []
}

/**
 * Where a drop among the cards a person SEES lands among all the column's cards. With parts picked
 * the column shows some of its cards; a drop before a seen card goes before it, and a drop at the
 * end goes after the last seen one, so the cards out of sight keep their places.
 */
export function indexAmong(all: readonly string[], seen: readonly string[], seenIndex: number, moving: string): number {
  const rest = all.filter((ref) => ref !== moving)
  const shown = seen.filter((ref) => ref !== moving)
  const before = shown[seenIndex]
  if (before !== undefined && rest.includes(before)) return rest.indexOf(before)
  const last = shown.at(-1)
  return last !== undefined && rest.includes(last) ? rest.indexOf(last) + 1 : rest.length
}
