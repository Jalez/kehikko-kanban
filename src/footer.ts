import { LIMITS, footerItemsSchema, type FooterItem } from 'kehikot-module-protocol'

import type { ColumnId } from './board/columns.ts'

/**
 * What Kanban puts in its container's footer (`kehikot.footer`, protocol 2.38.0): what the board
 * holds now, so a container folded to its header and footer still says it. The header keeps how
 * the board is drawn (Cards, Show Done); the line the page drew under the board (moves stay on this
 * board) and the notes above it (what went wrong, refs the tracker did not have) are here instead.
 *
 * - how many cards stand in each column shown, after a pick of parts;
 * - how many cards were moved on this board, with Put all cards back beside it: it acts on that
 *   count, so it is here rather than in the header (never in both);
 * - whether the trackers are being read;
 * - the first of the notes, its level by what it is, the rest in its tooltip.
 */
export interface FooterState {
  columns: readonly { id: ColumnId; name: string; count: number }[]
  moves: number
  refreshing: boolean
  /** The page's notes, most pressing first: an error or a refusal, then the rest. */
  lines: readonly string[]
  /** The first line is an error, not a note. */
  trouble: boolean
}

export const MOVES_SAID = 'Moves stay on this board, kept in this project: GitHub and GitLab are not changed.'

const cut = (text: string, most: number) => (text.length > most ? `${text.slice(0, most - 1)}…` : text)

export function footerItems({ columns, moves, refreshing, lines, trouble }: FooterState): FooterItem[] {
  const items: unknown[] = []
  const counts = columns.map((one) => `${one.name} ${one.count}`).join(' · ')
  if (counts) items.push({ kind: 'text', id: 'columns', text: cut(counts, LIMITS.FOOTER_TEXT), tooltip: cut(counts, LIMITS.FOOTER_TOOLTIP) })
  if (refreshing) items.push({ kind: 'text', id: 'reading', text: 'Reading the trackers…', align: 'center', optional: true })
  if (lines.length) {
    items.push({
      kind: 'text',
      id: 'said',
      text: cut(lines[0]!, LIMITS.FOOTER_TEXT),
      level: trouble ? 'critical' : 'warn',
      align: 'center',
      tooltip: cut(lines.join(' '), LIMITS.FOOTER_TOOLTIP),
    })
  }
  items.push(
    { kind: 'text', id: 'moves', text: moves ? `${moves} moved` : 'None moved', align: 'end', optional: true, tooltip: `${MOVES_SAID} Alt+arrows move the focused card.` },
    {
      kind: 'run',
      id: 'reset',
      label: 'Put all cards back',
      icon: 'undo',
      align: 'end',
      confirm: true,
      disabled: moves ? null : 'No card on this board was moved: each is where the tracker has it.',
    },
  )
  return footerItemsSchema.parse(items)
}
