import { answered, ask, subscribe } from 'kehikot-module-protocol/client'

import type { ColumnId } from '../board/columns.ts'
import type { BoardSettings, EpicMoves } from '../board/moves.ts'
import type { CardSeen } from '../board/seen.ts'

/**
 * This module's own `/api`, as the page calls it. `ask` carries the write ticket and turns every
 * failure into one sentence: the server stopped, the server said no (in its own words), or this page
 * is older than its server.
 */
export interface Kept {
  moves: EpicMoves
  settings: BoardSettings
  problem?: string
}

export interface MoveSent {
  ref: string
  to: ColumnId
  tracked: ColumnId
  /** The refs of the column it goes to, in order, before it lands. */
  refs: string[]
  index: number
}

export interface Api {
  read(project: string, epic: string): Promise<Kept>
  move(project: string, epic: string, move: MoveSent): Promise<EpicMoves>
  reset(project: string, epic: string, ref: string): Promise<EpicMoves>
  resetAll(project: string, epic: string): Promise<EpicMoves>
  /**
   * Hear when the project's board changed: once as the stream opens (and again each time it
   * reopens: after a drop, or when the page is shown again), then at every change. Never on a clock.
   * Returns the function that stops it.
   */
  changes(project: string, onChange: () => void): () => void
  /** Tell the server what the page drew, for the MCP door on a host too old to answer the server itself. */
  seen(project: string, epic: string, cards: CardSeen[]): Promise<void>
}

const post = async (body: Record<string, unknown>) => answered(await ask<{ moves?: EpicMoves }>('./api/board', { body })).moves ?? { moved: {}, order: {} }

export const api: Api = {
  async read(project, epic) {
    return answered(await ask<Kept>('./api/board', { query: { project, epic } }))
  },
  changes: (project, onChange) => subscribe('./api/board/events', () => onChange(), { query: { project }, probe: true }),
  move: (project, epic, move) => post({ project, epic, op: 'move', ...move }),
  reset: (project, epic, ref) => post({ project, epic, op: 'reset', ref }),
  resetAll: (project, epic) => post({ project, epic, op: 'reset-all' }),
  async seen(project, epic, cards) {
    await post({ project, epic, op: 'seen', cards })
  },
}
