import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cardsOf, type Card } from '../board/cards.ts'
import type { ColumnId } from '../board/columns.ts'
import { indexAmong, moveCard, place, refsIn, resetAll, resetCard, standingMove, type BoardColumn, type EpicMoves } from '../board/moves.ts'
import { seenOf } from '../board/seen.ts'
import { pinImagePolicy, avatarHostsOf } from '../lib/faces.ts'
import type { Api, Kept } from '../wire/api.ts'
import { readBoard, type BoardReading } from '../wire/reading.ts'
import type { Host } from '../wire/use-kehikot.ts'

/**
 * The board's material and its changes, for one project and epic:
 *
 * - the host's tracker reading (`wire/reading.ts`), asked again when the reading moves, when the
 *   epic's material changes, and when the parts' refs change;
 * - this module's own moves and settings, from its server, asked again every couple of seconds while
 *   the page is visible — an agent's `move_card` and a change in the host's settings form arrive that
 *   way;
 * - what the page drew, told to its server for the MCP door when the host is too old to answer the
 *   server itself (protocol before 2.19.0).
 *
 * A move is drawn at once and sent after; a refusal puts the board back and says why.
 */

export const POLL_MS = 2000

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export interface BoardState {
  reading: BoardReading | null
  readError: string | null
  kept: Kept | null
  /** The last write that was refused, in the server's words. */
  said: string | null
  cards: Card[]
  board: BoardColumn<Card>[] | null
  moves: number
  move(card: Card, to: ColumnId, seenIndex: number, seenRefs: readonly string[]): void
  reset(card: Card): void
  resetAll(): Promise<string | undefined>
}

export function useBoard(host: Pick<Host, 'projectPath' | 'epic' | 'parts' | 'request' | 'tracker' | 'content'>, api: Api, now: () => number = Date.now): BoardState {
  const { projectPath, epic, parts, request, tracker, content } = host
  const [reading, setReading] = useState<BoardReading | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [kept, setKept] = useState<Kept | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const partRefs = parts.map((part) => `${part.id}:${part.refs.join(' ')}`).join('|')
  const partsNow = useRef(parts)
  partsNow.current = parts

  /* The epic changed: what was drawn is another epic's. */
  useEffect(() => {
    setReading(null)
    setKept(null)
    setReadError(null)
    setSaid(null)
  }, [projectPath, epic])

  useEffect(() => {
    if (!epic) return
    let live = true
    readBoard(request, epic, partsNow.current)
      .then((read) => {
        if (!live) return
        pinImagePolicy(avatarHostsOf(read.hosts))
        setReading(read)
        setReadError(null)
      })
      .catch((error: unknown) => live && setReadError(message(error)))
    return () => {
      live = false
    }
  }, [request, epic, projectPath, tracker.at, content, partRefs])

  useEffect(() => {
    if (!projectPath || !epic) return
    let live = true
    let last = ''
    const tick = () =>
      api
        .read(projectPath, epic)
        .then((next) => {
          const json = JSON.stringify(next)
          if (!live || json === last) return
          last = json
          setKept(next)
        })
        .catch((error: unknown) => live && setSaid(message(error)))
    void tick()
    const every = setInterval(() => {
      if (globalThis.document?.visibilityState !== 'hidden') void tick()
    }, POLL_MS)
    return () => {
      live = false
      clearInterval(every)
    }
  }, [api, projectPath, epic])

  const cards = useMemo(() => (reading ? cardsOf(reading.rows, reading.linked) : []), [reading])

  /* What the page drew, for the MCP door on a host before 2.19.0: every card, before any part narrows it. */
  const seenJson = useMemo(() => JSON.stringify(cards.map(seenOf)), [cards])
  useEffect(() => {
    if (!projectPath || !epic || !reading) return
    api.seen(projectPath, epic, JSON.parse(seenJson)).catch(() => {})
  }, [api, projectPath, epic, reading, seenJson])

  const board = useMemo(() => (kept && reading ? place(cards, kept.moves, kept.settings, now()) : null), [cards, kept, reading, now])
  const moves = useMemo(() => (kept ? cards.filter((card) => standingMove(kept.moves, card)).length : 0), [cards, kept])

  const keptNow = useRef(kept)
  keptNow.current = kept
  const boardNow = useRef(board)
  boardNow.current = board

  const settle = useCallback(
    (before: Kept, after: EpicMoves, send: () => Promise<EpicMoves>) => {
      setKept({ ...before, moves: after })
      setSaid(null)
      send()
        .then((moves) => setKept((was) => (was ? { ...was, moves } : was)))
        .catch((error: unknown) => {
          setKept(before)
          setSaid(message(error))
        })
    },
    [],
  )

  const move = useCallback(
    (card: Card, to: ColumnId, seenIndex: number, seenRefs: readonly string[]) => {
      const before = keptNow.current
      const placed = boardNow.current
      if (!before || !placed || !projectPath || !epic) return
      const all = refsIn(placed, to)
      const index = indexAmong(all, seenRefs, seenIndex, card.ref)
      const refs = all.filter((ref) => ref !== card.ref)
      const asked = { ref: card.ref, to, tracked: card.tracked, by: { kind: 'person' as const }, at: new Date(now()).toISOString() }
      settle(before, moveCard(before.moves, asked, refs, index), () => api.move(projectPath, epic, { ref: card.ref, to, tracked: card.tracked, refs, index }))
    },
    [api, projectPath, epic, settle, now],
  )

  const reset = useCallback(
    (card: Card) => {
      const before = keptNow.current
      if (!before || !projectPath || !epic) return
      settle(before, resetCard(before.moves, card.ref), () => api.reset(projectPath, epic, card.ref))
    },
    [api, projectPath, epic, settle],
  )

  const resetEvery = useCallback(async () => {
    const before = keptNow.current
    if (!before || !projectPath || !epic) return 'There is no board open to put back.'
    try {
      const moves = await api.resetAll(projectPath, epic)
      setKept((was) => (was ? { ...was, moves } : { ...before, moves: resetAll() }))
      setSaid(null)
      return undefined
    } catch (error) {
      setSaid(message(error))
      return message(error)
    }
  }, [api, projectPath, epic])

  return { reading, readError, kept, said, cards, board, moves, move, reset, resetAll: resetEvery }
}
