/**
 * The board's four columns, in order. The ids are what is kept (in `.kehikot/kanban/moves.json`
 * and in the settings' keys); the names are what a person reads.
 */
export const COLUMN_IDS = ['todo', 'progress', 'review', 'done'] as const
export type ColumnId = (typeof COLUMN_IDS)[number]

export const COLUMN_NAMES: Record<ColumnId, string> = {
  todo: 'To do',
  progress: 'In progress',
  review: 'In review',
  done: 'Done',
}

/** What each column holds, said once: the page's tooltips, the MCP door and the README say this. */
export const COLUMN_MEANS: Record<ColumnId, string> = {
  todo: 'Open, and nobody is on it.',
  progress: 'Open and assigned, or with a draft change.',
  review: 'An open pull or merge request, or one whose review was asked for.',
  done: 'Closed or merged, recently.',
}

export function isColumn(value: unknown): value is ColumnId {
  return typeof value === 'string' && (COLUMN_IDS as readonly string[]).includes(value)
}

/** The column to the left (-1) or right (+1) of `from` among `shown`, or null at an end. */
export function neighbour(shown: readonly ColumnId[], from: ColumnId, step: -1 | 1): ColumnId | null {
  const at = shown.indexOf(from)
  if (at < 0) return null
  return shown[at + step] ?? null
}
