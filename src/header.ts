import { headerItemsSchema, type HeaderItem } from 'kehikot-module-protocol'

/**
 * What Kanban puts in its container's header. The host draws it (View and Run menus) and relays a
 * press; the page owns the state and declares the whole list again whenever it changes.
 *
 * - **Cards** (View): compact or comfortable. A view switch: `agents: true`.
 * - **Show Done** (View): Done open or folded. A toggle that loses nothing: `agents: true`. Left out
 *   while the settings turn the Done column off.
 * - **Put all cards back** (Run): takes every move of this board off. It writes, so it is the
 *   person's alone, and it asks for the host's second press (`confirm`).
 *
 * Labels are a few words: under 300 pixels the menus become icons, under 220 one "⋯".
 */
export type Density = 'compact' | 'comfortable'
export const DENSITIES: readonly Density[] = ['compact', 'comfortable']

/** How long a label may be and still read in a menu 200 pixels wide. The protocol's bound is 48. */
export const LABEL_FIT = 24

export interface HeaderState {
  density: Density
  showDone: boolean
  /** Whether the Done column exists at all (the settings). */
  doneColumn: boolean
  /** How many moves stand on this board. */
  moves: number
}

export function headerItems(state: HeaderState): HeaderItem[] {
  return headerItemsSchema.parse([
    {
      kind: 'switch',
      id: 'density',
      label: 'Cards',
      agents: true,
      options: [
        { id: 'compact', label: 'Compact' },
        { id: 'comfortable', label: 'Comfortable' },
      ],
      value: state.density,
    },
    ...(state.doneColumn ? [{ kind: 'toggle', id: 'done', label: 'Show Done', agents: true, checked: state.showDone }] : []),
    {
      kind: 'run',
      id: 'reset',
      label: 'Put all cards back',
      icon: 'undo',
      confirm: true,
      disabled: state.moves ? null : 'No card on this board was moved: each is where the tracker has it.',
    },
  ])
}

export type Pressed = { density: Density } | { showDone: boolean } | { reset: true } | string

/** What a press asks for, or a sentence saying why it was not taken. */
export function pressed(item: string, value: unknown): Pressed {
  if (item === 'density') return DENSITIES.includes(value as Density) ? { density: value as Density } : `"${String(value).slice(0, 40)}" is not a way Kanban draws cards.`
  if (item === 'done') return typeof value === 'boolean' ? { showDone: value } : 'Show Done is on or off.'
  if (item === 'reset') return { reset: true }
  return `Kanban has nothing called "${item.slice(0, 40)}" to press.`
}
