import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import type { EpicPart, HeaderItem, TrackerRow } from 'kehikot-module-protocol'

import { Screen, handlers } from '../src/app.tsx'
import { moveCard, noMoves, resetCard, DEFAULT_SETTINGS, type EpicMoves } from '../src/board/moves.ts'
import type { CardSeen } from '../src/board/seen.ts'
import type { Api, MoveSent } from '../src/wire/api.ts'
import type { Host } from '../src/wire/use-kehikot.ts'
import { EPIC, NOW, PART_NAMES, PART_REFS, ROWS } from './fixtures.ts'

afterEach(cleanup)

const parts = (picked: string[] = []): EpicPart[] =>
  Object.entries(PART_REFS).map(([id, refs]) => ({ id, heading: PART_NAMES[id]!, refs, picked: picked.includes(id) }))

/** The host's reading, as `tracker.get` answers it: the epic names every stand-in ref but #7's closer. */
function reading(rows: TrackerRow[] = ROWS) {
  const answer = (found: TrackerRow[], missing: string[] = []) => ({
    at: '2026-10-24T11:00:00.000Z',
    refreshing: false,
    sources: [],
    rows: found,
    missing: missing.map((ref) => ({ ref, reason: 'pending' })),
  })
  return async (method: string, params?: Record<string, unknown>) => {
    if (method !== 'tracker.get') throw new Error(`not asked here: ${method}`)
    if (params?.epic) return answer(rows)
    const refs = (params?.refs as string[]) ?? []
    return answer(rows.filter((row) => refs.includes(row.ref)), refs.filter((ref) => !rows.some((row) => row.ref === ref)))
  }
}

function host(over: Partial<Host> = {}): Host {
  return {
    where: 'hosted',
    project: 'Demo',
    projectPath: '/work/demo',
    epic: EPIC,
    parts: parts(),
    theme: 'light',
    header: () => {},
    request: reading(),
    answers: ['tracker.get', 'tracker.refresh', 'address.open', 'state.set'],
    openAddress: async () => ({ outcome: 'opened' as const, by: 'kehikot.browser' }) as never,
    refreshable: () => {},
    remember: () => {},
    kept: null,
    tracker: { at: '2026-10-24T11:00:00.000Z', refreshing: false },
    content: '',
    ...over,
  }
}

function fakeApi(start: EpicMoves = noMoves()) {
  let moves = start
  const sent: Array<{ op: string; move?: MoveSent; ref?: string }> = []
  const seen: CardSeen[][] = []
  const changes: Array<() => void> = []
  const reads = { count: 0 }
  const api: Api = {
    read: async () => (reads.count++, { moves, settings: DEFAULT_SETTINGS }),
    /* As the stream does: once as it opens, then at each change the test sends. */
    changes: (_project, onChange) => {
      changes.push(onChange)
      onChange()
      return () => void changes.splice(changes.indexOf(onChange), 1)
    },
    move: async (_project, _epic, move) => {
      sent.push({ op: 'move', move })
      moves = moveCard(moves, { ...move, by: { kind: 'person' }, at: new Date(NOW).toISOString() }, move.refs, move.index)
      return moves
    },
    reset: async (_project, _epic, ref) => {
      sent.push({ op: 'reset', ref })
      moves = resetCard(moves, ref)
      return moves
    },
    resetAll: async () => {
      sent.push({ op: 'reset-all' })
      moves = noMoves()
      return moves
    },
    seen: async (_project, _epic, cards) => void seen.push(cards),
  }
  return { api, sent, seen, changes, reads, set: (next: EpicMoves) => void (moves = next) }
}

const column = (id: string) => document.querySelector<HTMLElement>(`[data-column="${id}"]`)!
const refsIn = (id: string) => [...column(id).querySelectorAll<HTMLElement>('[data-card]')].map((one) => one.dataset.card)
const card = (ref: string) => document.querySelector<HTMLElement>(`[data-card="${ref}"]`)!
const now = () => NOW

describe('the board', () => {
  test('the epic’s work in four columns, placed from what the trackers say', async () => {
    const { api } = fakeApi()
    render(<Screen host={host()} api={api} now={now} />)
    await waitFor(() => expect(refsIn('todo')).toEqual(['#12', 'gh#1']))
    expect(refsIn('progress')).toEqual(['gh#2', 'gh#5'])
    expect(refsIn('review')).toEqual(['!7', 'gh#4', 'gh#3'])
    expect(refsIn('done')).toEqual(['gh#6', 'gh#8'])
    expect(screen.getByText('1 finished more than 14 days ago is left off.')).toBeDefined()
    expect(screen.getByTestId('footnote').textContent).toContain('GitHub and GitLab are not changed')
  })

  test('a card says its number, type, title, labels and review in words, and its people by name', async () => {
    const { api } = fakeApi()
    render(<Screen host={host()} api={api} now={now} />)
    await waitFor(() => card('gh#4'))
    expect(card('gh#4').getAttribute('aria-label')).toBe('Pull request #4: CSV export. In In review. Review requested. Review requested')
    expect(within(card('gh#4')).getByText('CSV export')).toBeDefined()
    expect(within(card('gh#1')).getByText('p1')).toBeDefined()
    expect(within(card('gh#4')).getByLabelText('Reviewers: Hubot (asked to review)')).toBeDefined()
    expect(within(card('#12')).getByText('#12')).toBeDefined()
  })

  test('a title is drawn as text, never as markup', async () => {
    const { api } = fakeApi()
    const rows = [{ ...ROWS[0]!, title: '<b>bold</b>' }]
    render(<Screen host={host({ request: reading(rows) })} api={api} now={now} />)
    await waitFor(() => screen.getByText('<b>bold</b>'))
  })

  test('follows the parts picked, and says one sentence when they leave nothing', async () => {
    const { api } = fakeApi()
    render(<Screen host={host({ parts: parts(['docs']) })} api={api} now={now} />)
    await waitFor(() => expect(refsIn('review')).toEqual(['!7']))
    expect(refsIn('todo')).toEqual(['#12'])
    expect(refsIn('progress')).toEqual([])
    cleanup()
    const empty = [...parts(), { id: 'later', heading: 'Later', refs: ['gh#99'], picked: true }]
    render(<Screen host={host({ parts: empty })} api={api} now={now} />)
    await waitFor(() => screen.getByText('No card is in the picked part.'))
  })

  test('keeps the card the person is on in sight when the pick changes', async () => {
    const { api } = fakeApi()
    const { rerender } = render(<Screen host={host()} api={api} now={now} />)
    await waitFor(() => card('gh#1'))
    fireEvent.focus(card('gh#1'))
    rerender(<Screen host={host({ parts: parts(['docs']) })} api={api} now={now} />)
    await waitFor(() => expect(refsIn('todo')).toEqual(['#12', 'gh#1']))
    expect(refsIn('progress')).toEqual([])
  })

  test('tells its server every card it drew, before any part narrows them', async () => {
    const { api, seen } = fakeApi()
    render(<Screen host={host({ parts: parts(['docs']) })} api={api} now={now} />)
    await waitFor(() => expect(seen.at(-1)?.length).toBe(ROWS.length))
  })
})

describe('moving a card', () => {
  test('with the keyboard: Alt+→ moves it, marked as moved by you, and Put back puts it back', async () => {
    const { api, sent } = fakeApi()
    render(<Screen host={host()} api={api} now={now} />)
    await waitFor(() => card('gh#1'))
    card('gh#1').focus()
    fireEvent.keyDown(card('gh#1'), { key: 'ArrowRight', altKey: true })
    await waitFor(() => expect(refsIn('progress')).toContain('gh#1'))
    expect(sent[0]).toMatchObject({ op: 'move', move: { ref: 'gh#1', to: 'progress', tracked: 'todo' } })
    expect(within(card('gh#1')).getByText('Moved here by you')).toBeDefined()
    expect(screen.getByTestId('heard').textContent).toBe('#1 is in In progress. This board only: the tracker is not changed.')
    await waitFor(() => expect(document.activeElement).toBe(card('gh#1')))
    fireEvent.click(within(card('gh#1')).getByRole('button', { name: /Put #1 back in To do/ }))
    await waitFor(() => expect(refsIn('todo')).toContain('gh#1'))
    expect(sent.at(-1)).toEqual({ op: 'reset', ref: 'gh#1' })
  })

  test('with the keyboard: Alt+↓ moves it down its column, and the arrows alone move the focus', async () => {
    const { api, sent } = fakeApi()
    render(<Screen host={host()} api={api} now={now} />)
    await waitFor(() => card('!7'))
    card('!7').focus()
    fireEvent.keyDown(card('!7'), { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement).toBe(card('gh#4')))
    fireEvent.keyDown(card('gh#4'), { key: 'ArrowRight' })
    await waitFor(() => expect(document.activeElement).toBe(card('gh#8')))
    fireEvent.keyDown(card('gh#8'), { key: 'ArrowUp', altKey: true })
    await waitFor(() => expect(refsIn('done')).toEqual(['gh#8', 'gh#6']))
    expect(sent.at(-1)?.move).toMatchObject({ ref: 'gh#8', to: 'done', index: 0 })
  })

  test('a move the server refuses puts the board back and says why', async () => {
    const { api } = fakeApi()
    api.move = async () => {
      throw new Error('The project folder is read-only.')
    }
    render(<Screen host={host()} api={api} now={now} />)
    await waitFor(() => card('gh#1'))
    fireEvent.keyDown(card('gh#1'), { key: 'ArrowRight', altKey: true })
    await waitFor(() => screen.getByText('The project folder is read-only.'))
    expect(refsIn('todo')).toContain('gh#1')
  })

  test('a move an agent made says so, from what the server holds', async () => {
    const moves = moveCard(noMoves(), { ref: 'gh#1', to: 'done', tracked: 'todo', by: { kind: 'agent', name: 'Claude Code' }, at: new Date(NOW).toISOString() }, [], 0)
    const { api } = fakeApi(moves)
    render(<Screen host={host()} api={api} now={now} />)
    await waitFor(() => expect(refsIn('done')).toContain('gh#1'))
    expect(within(card('gh#1')).getByText('Moved here by an agent (Claude Code)')).toBeDefined()
  })
})

describe('the page around the board', () => {
  test('pressing a card hands its address to the canvas', async () => {
    const opened: string[] = []
    const { api } = fakeApi()
    render(<Screen host={host({ openAddress: async (url) => (opened.push(url), { outcome: 'opened' }) as never })} api={api} now={now} />)
    await waitFor(() => card('gh#1'))
    fireEvent.click(card('gh#1'))
    await waitFor(() => expect(opened).toEqual(['https://github.com/example-org/demo/issues/1']))
    fireEvent.keyDown(card('gh#2'), { key: 'Enter' })
    await waitFor(() => expect(opened).toHaveLength(2))
  })

  test('narrow, one column at a time with a switcher', async () => {
    const { api } = fakeApi()
    render(<Screen host={host()} api={api} now={now} width={320} />)
    await waitFor(() => screen.getByRole('tablist', { name: 'Column' }))
    expect(document.querySelectorAll('[data-column]')).toHaveLength(1)
    expect(refsIn('todo')).toEqual(['#12', 'gh#1'])
    fireEvent.click(screen.getByRole('tab', { name: /In review/ }))
    await waitFor(() => expect(refsIn('review')).toEqual(['!7', 'gh#4', 'gh#3']))
    expect(column('todo')).toBeNull()
  })

  test('the header: declared on every change, and its presses change the view', async () => {
    const declared: HeaderItem[][] = []
    const bound = handlers()
    const { api } = fakeApi()
    const remembered: unknown[] = []
    render(<Screen host={host({ header: (items) => void declared.push(items as HeaderItem[]), remember: (view) => void remembered.push(view) })} api={api} now={now} handlers={bound} />)
    await waitFor(() => card('gh#1'))
    expect(declared.at(-1)?.map((item) => item.id)).toEqual(['density', 'done', 'reset'])
    await act(async () => void (await bound.press.current?.({ item: 'density', value: 'compact' })))
    expect(declared.at(-1)?.[0]).toMatchObject({ value: 'compact' })
    expect(remembered.at(-1)).toMatchObject({ density: 'compact' })
    await act(async () => void (await bound.press.current?.({ item: 'done', value: false })))
    expect(refsIn('done')).toEqual([])
    expect(screen.getByRole('button', { name: 'Show Done' })).toBeDefined()
    expect(await bound.press.current?.({ item: 'nothing' })).toContain('nothing called')
  })

  test('each not-ready moment is the shared cover, and no epic says what to do', () => {
    const { api } = fakeApi()
    const none = { projectPath: null, project: null, epic: null }
    for (const [where, state] of [['listening', 'waiting'], ['unhosted', 'unhosted'], ['hosted', 'no-project']] as const) {
      const { container } = render(<Screen host={host({ ...none, where })} api={api} />)
      expect(container.querySelector('[data-cover]')?.getAttribute('data-cover')).toBe(state)
      cleanup()
    }
    render(<Screen host={host({ epic: null })} api={api} />)
    expect(screen.getByText(/Open an epic/)).toBeDefined()
  })

  test('an epic that names nothing says how to put work on it', async () => {
    const { api } = fakeApi()
    render(<Screen host={host({ request: reading([]) })} api={api} now={now} />)
    await waitFor(() => screen.getByText(/names no issue, pull request or merge request yet/))
  })
})

describe('the board is told, never asks on a clock', () => {
  test('an hour open reads the moves once, sets no timer, and reads again only when the stream says so', async () => {
    const realInterval = globalThis.setInterval
    let intervals = 0
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => (intervals++, realInterval(...args))) as typeof setInterval
    try {
      const fake = fakeApi()
      /* Counted before `waitFor`, which keeps an interval of its own. */
      render(<Screen host={host()} api={fake.api} now={now} />)
      await act(async () => {})
      expect(intervals).toBe(0)
      await waitFor(() => expect(refsIn('todo').length).toBeGreaterThan(0))
      expect(fake.reads.count).toBe(1)
      /* An agent's move_card, published by the server. */
      const ref = refsIn('todo')[0]!
      fake.set(moveCard(noMoves(), { ref, to: 'done', tracked: 'todo', by: { kind: 'agent', name: 'a' }, at: new Date(NOW).toISOString() }, [], 0))
      await act(async () => fake.changes.forEach((change) => change()))
      await waitFor(() => expect(refsIn('done')).toContain(ref))
      expect(fake.reads.count).toBe(2)
      cleanup()
      expect(fake.changes.length).toBe(0)
    } finally {
      globalThis.setInterval = realInterval
    }
  })
})
