import { describe, expect, test } from 'bun:test'
import { trackerRowSchema, type TrackerRow } from 'kehikot-module-protocol'

import { cardsOf, type Card } from '../src/board/cards.ts'
import { neighbour } from '../src/board/columns.ts'
import {
  DEFAULT_SETTINGS,
  columnOf,
  epicMovesOf,
  indexAmong,
  moveCard,
  movedSaid,
  noMoves,
  place,
  refsIn,
  resetCard,
  standingMove,
  type Mover,
} from '../src/board/moves.ts'
import { NOW, ROWS } from './fixtures.ts'

const cards = cardsOf(ROWS, ROWS)
const card = (ref: string): Card => cards.find((one) => one.ref === ref)!
const you: Mover = { kind: 'person' }
const when = new Date(NOW).toISOString()

describe('where the tracker puts a card', () => {
  test('open and nobody on it is To do; assigned is In progress', () => {
    expect([card('gh#1').tracked, card('gh#1').why]).toEqual(['todo', 'Open, nobody on it'])
    expect([card('gh#2').tracked, card('gh#2').why]).toEqual(['progress', 'Assigned to Mona Lisa'])
  })

  test('an open issue with a branch linked to it is In progress: somebody started', () => {
    const branched = cardsOf([{ ...ROWS[0]!, branches: [{ name: '1-sign-in-page' }] }])[0]!
    expect([branched.tracked, branched.why]).toEqual(['progress', 'Branch 1-sign-in-page'])
    /* Assigned says who; a branch is the reason only when nobody is. */
    const both = cardsOf([{ ...ROWS[1]!, branches: [{ name: '2-limits' }] }])[0]!
    expect([both.tracked, both.why]).toEqual(['progress', 'Assigned to Mona Lisa'])
    /* Read and none, or not read at all: To do as before. */
    expect(cardsOf([{ ...ROWS[0]!, branches: [] }])[0]!.tracked).toBe('todo')
    /* A closed issue with a branch left behind is Done. */
    expect(cardsOf([{ ...ROWS[6]!, branches: [{ name: '7-logo' }] }])[0]!.tracked).toBe('done')
  })

  test('an open change is In review, a draft In progress, and an issue follows the change that closes it', () => {
    expect([card('gh#4').tracked, card('gh#4').why]).toEqual(['review', 'Review requested'])
    expect([card('gh#5').tracked, card('gh#5').why]).toEqual(['progress', 'Draft pull request'])
    expect([card('gh#3').tracked, card('gh#3').why]).toEqual(['review', '#4 is in review'])
    expect([card('!7').tracked, card('!7').why]).toEqual(['review', 'Open merge request'])
  })

  test('closed and merged are Done, with the reason the tracker gave', () => {
    expect([card('gh#6').tracked, card('gh#6').why]).toEqual(['done', 'Merged'])
    expect(card('gh#8').why).toBe('Closed as not planned')
  })

  test('each card says its type, its number as the tracker spells it, and its review', () => {
    expect([card('#12').type, card('#12').short]).toEqual(['task', '#12'])
    expect([card('!7').type, card('!7').short, card('!7').review]).toEqual(['mr', '!7', 'approved'])
    expect([card('gh#4').type, card('gh#4').review]).toEqual(['pr', 'asked'])
    expect(card('gh#2').assignees).toEqual([{ login: 'octocat', name: 'Mona Lisa', avatarUrl: 'https://avatars.githubusercontent.com/u/583231?v=4' }])
  })

  test('two spellings of one item are one card, with both spellings', () => {
    const twice = cardsOf([ROWS[0]!, { ...ROWS[0]!, ref: 'gh:example-org/demo#1' }])
    expect(twice.map((one) => one.refs)).toEqual([['gh#1', 'gh:example-org/demo#1']])
  })
})

describe('a move', () => {
  test('stands over the tracker, marked with who made it', () => {
    const moves = moveCard(noMoves(), { ref: 'gh#1', to: 'review', tracked: 'todo', by: you, at: when }, [], 0)
    expect(columnOf(moves, card('gh#1'))).toBe('review')
    expect(movedSaid(standingMove(moves, card('gh#1'))!)).toBe('Moved here by you')
    expect(movedSaid({ to: 'done', from: 'todo', by: { kind: 'agent', name: 'Claude Code' }, at: when })).toBe('Moved here by an agent (Claude Code)')
  })

  test('to where the tracker has it is no move, and a reset puts a card back', () => {
    let moves = moveCard(noMoves(), { ref: 'gh#1', to: 'review', tracked: 'todo', by: you, at: when }, [], 0)
    moves = moveCard(moves, { ref: 'gh#1', to: 'todo', tracked: 'todo', by: you, at: when }, [], 0)
    expect(moves.moved).toEqual({})
    moves = moveCard(moves, { ref: 'gh#1', to: 'done', tracked: 'todo', by: you, at: when }, [], 0)
    expect(resetCard(moves, 'gh#1').moved).toEqual({})
  })

  test('gives way when the tracker moves the item itself', () => {
    const moves = moveCard(noMoves(), { ref: 'gh#1', to: 'review', tracked: 'todo', by: you, at: when }, [], 0)
    expect(columnOf(moves, { ref: 'gh#1', tracked: 'progress' })).toBe('progress')
    expect(standingMove(moves, { ref: 'gh#1', tracked: 'progress' })).toBeNull()
  })

  test('within the column it is in keeps who moved it there', () => {
    const agent: Mover = { kind: 'agent', name: 'Claude Code' }
    let moves = moveCard(noMoves(), { ref: 'gh#1', to: 'review', tracked: 'todo', by: agent, at: when }, ['gh#4'], 0)
    moves = moveCard(moves, { ref: 'gh#1', to: 'review', tracked: 'todo', by: you, at: when }, ['gh#1', 'gh#4'], 1)
    expect(moves.moved['gh#1']?.by).toEqual(agent)
    expect(moves.order.review).toEqual(['gh#4', 'gh#1'])
  })

  test('a file that does not read is read as no moves, one entry at a time', () => {
    const read = epicMovesOf({
      moved: { 'gh#1': { to: 'done', from: 'todo', by: { kind: 'person' }, at: when }, 'gh#2': { to: 'nowhere' }, 'gh#3': { to: 'todo', from: 'todo', by: you, at: when } },
      order: { todo: ['gh#1', 'gh#1', 5], bogus: ['x'] },
    })
    expect(Object.keys(read.moved)).toEqual(['gh#1'])
    expect(read.order).toEqual({ todo: ['gh#1'] })
    expect(epicMovesOf('junk')).toEqual(noMoves())
  })
})

describe('the board, placed', () => {
  test('every column, newest first, and Done keeps only the recent', () => {
    const board = place(cards, noMoves(), DEFAULT_SETTINGS, NOW)
    expect(board.map((column) => column.cards.map((one) => one.card.ref))).toEqual([
      ['#12', 'gh#1'],
      ['gh#2', 'gh#5'],
      ['!7', 'gh#4', 'gh#3'],
      ['gh#6', 'gh#8'],
    ])
    expect(board.find((column) => column.id === 'done')?.older).toBe(1)
    expect(place(cards, noMoves(), { ...DEFAULT_SETTINGS, doneDays: 0 }, NOW).at(-1)?.cards).toHaveLength(3)
  })

  test('a kept order holds, and a card it does not name comes first', () => {
    const moves = moveCard(noMoves(), { ref: 'gh#3', to: 'review', tracked: 'review', by: you, at: when }, ['!7', 'gh#4', 'gh#3'], 0)
    expect(refsIn(place(cards, moves, DEFAULT_SETTINGS, NOW), 'review')).toEqual(['gh#3', '!7', 'gh#4'])
  })

  test('a drop among the cards in sight keeps the ones out of sight in their places', () => {
    expect(indexAmong(['a', 'b', 'c', 'd'], ['b', 'd'], 1, 'x')).toBe(3)
    expect(indexAmong(['a', 'b', 'c', 'd'], ['b', 'd'], 2, 'x')).toBe(4)
    expect(indexAmong(['a', 'b', 'c', 'd'], ['b', 'd'], 0, 'b')).toBe(2)
  })

  test('a column hidden in the settings is still placed, and says so', () => {
    const board = place(cards, noMoves(), { ...DEFAULT_SETTINGS, columns: { ...DEFAULT_SETTINGS.columns, todo: false } }, NOW)
    expect(board[0]?.shown).toBe(false)
    expect(board[0]?.cards).toHaveLength(2)
    expect(neighbour(['progress', 'review'], 'progress', 1)).toBe('review')
    expect(neighbour(['progress', 'review'], 'progress', -1)).toBeNull()
  })
})

/**
 * Jalez/kehikko#187: a merge request that says "Part of #3912" delivers part of the issue. It keeps
 * the issue In progress, open or merged, and never moves it to In review or Done; "Closes #2638"
 * still does what it did.
 */
describe('a change that is only part of an issue', () => {
  const gl = (fields: Pick<TrackerRow, 'ref' | 'number' | 'kind' | 'state' | 'title'> & Partial<TrackerRow>): TrackerRow =>
    trackerRowSchema.parse({ tracker: 'gitlab', host: 'gitlab.example.org', repo: 'group/app', readAt: when, url: 'u', ...fields })
  const issue = gl({ ref: '#3912', number: 3912, kind: 'issue', state: 'open', title: 'Partly delivered', contributedBy: ['!3907'] })
  const part = (state: 'open' | 'merged' | 'closed') => gl({ ref: '!3907', number: 3907, kind: 'change', state, title: 'One part', contributes: ['#3912'] })

  test('open, it keeps the issue In progress, not In review', () => {
    const [card] = cardsOf([issue], [issue, part('open')])
    expect([card!.tracked, card!.why]).toEqual(['progress', 'Part of it in !3907'])
  })

  test('merged, the issue is still In progress, not Done', () => {
    const [card] = cardsOf([issue], [issue, part('merged')])
    expect([card!.tracked, card!.why]).toEqual(['progress', 'Part of it merged in !3907'])
  })

  test('closed without merging, it says nothing', () => {
    const [card] = cardsOf([issue], [issue, part('closed')])
    expect(card!.tracked).toBe('todo')
  })

  test('a change that closes the issue still leads it into In review', () => {
    const closing = gl({ ref: '!3251', number: 3251, kind: 'change', state: 'open', title: 'The whole', links: [{ ref: '#3912', relation: 'closes' }] })
    const both: TrackerRow = { ...issue, links: [{ ref: '!3251', relation: 'closed-by' }] }
    const [card] = cardsOf([both], [both, part('open'), closing])
    expect([card!.tracked, card!.why]).toEqual(['review', '!3251 is in review'])
  })
})
