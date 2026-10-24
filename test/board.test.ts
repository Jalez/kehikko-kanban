import { describe, expect, test } from 'bun:test'

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
