import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { moveCard, resetCard } from '../src/board/moves.ts'
import { boardSettings, editMoves, readMoves, readSettingValues, writeSettingValue } from '../store.ts'

const home = mkdtempSync(join(tmpdir(), 'kehikko-kanban-store-'))
afterAll(() => rmSync(home, { recursive: true, force: true }))

function project(name: string): string {
  const dir = join(home, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

const at = '2026-10-24T12:00:00.000Z'
const move = (ref: string) => (moves: Parameters<typeof moveCard>[0]) => moveCard(moves, { ref, to: 'review', tracked: 'todo', by: { kind: 'person' }, at }, [], 0)

describe('the store', () => {
  test('moves are kept inside the project, under .kehikot/kanban/, per epic', () => {
    const dir = project('round-trip')
    expect(readMoves(dir, 'launch')).toEqual({ ok: true, value: { moved: {}, order: {} } })
    expect(editMoves(dir, 'launch', move('gh#1')).ok).toBe(true)
    expect(editMoves(dir, 'other', move('gh#9')).ok).toBe(true)
    const file = join(dir, '.kehikot', 'kanban', 'moves.json')
    expect(existsSync(file)).toBe(true)
    expect(readMoves(dir, 'launch').ok && readMoves(dir, 'launch')).toMatchObject({ value: { moved: { 'gh#1': { to: 'review', from: 'todo' } } } })
    /* A reset leaves the order, and the other epic, as they were. */
    expect(editMoves(dir, 'launch', (moves) => resetCard(moves, 'gh#1')).ok).toBe(true)
    const kept = JSON.parse(readFileSync(file, 'utf8'))
    expect(kept.epics.launch).toEqual({ moved: {}, order: { review: ['gh#1'] } })
    expect(Object.keys(kept.epics.other.moved)).toEqual(['gh#9'])
  })

  test('keys it does not know are kept', () => {
    const dir = project('unknown-keys')
    mkdirSync(join(dir, '.kehikot', 'kanban'), { recursive: true })
    writeFileSync(join(dir, '.kehikot', 'kanban', 'moves.json'), JSON.stringify({ version: 1, later: 'kept', epics: { launch: { moved: {}, order: {}, extra: 1 } } }))
    expect(editMoves(dir, 'launch', move('gh#1')).ok).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, '.kehikot', 'kanban', 'moves.json'), 'utf8')).later).toBe('kept')
  })

  test('with no project, or no epic, there is nowhere to read or write', () => {
    expect(readMoves(null, 'launch').ok).toBe(false)
    expect(editMoves(null, 'launch', move('gh#1')).ok).toBe(false)
    expect(editMoves('relative/path', 'launch', move('gh#1')).ok).toBe(false)
    expect(editMoves(project('no-epic'), null, move('gh#1')).ok).toBe(false)
    expect(editMoves(project('bad-epic'), '../up', move('gh#1')).ok).toBe(false)
  })

  test('a file that does not read is refused, not written over', () => {
    const dir = project('junk')
    mkdirSync(join(dir, '.kehikot', 'kanban'), { recursive: true })
    writeFileSync(join(dir, '.kehikot', 'kanban', 'moves.json'), '{ not json')
    expect(editMoves(dir, 'launch', move('gh#1')).ok).toBe(false)
    expect(readFileSync(join(dir, '.kehikot', 'kanban', 'moves.json'), 'utf8')).toBe('{ not json')
  })

  test('a .kehikot that points out of the project is refused', () => {
    const dir = project('escaping')
    const elsewhere = project('elsewhere')
    symlinkSync(elsewhere, join(dir, '.kehikot'))
    expect(editMoves(dir, 'launch', move('gh#1')).ok).toBe(false)
    expect(writeSettingValue(dir, 'doneDays', 3)).not.toBeNull()
    expect(existsSync(join(elsewhere, 'kanban'))).toBe(false)
  })

  test('settings round-trip, each value checked, the default for anything else', () => {
    const dir = project('settings')
    expect(boardSettings(readSettingValues(dir).values)).toEqual({ columns: { todo: true, progress: true, review: true, done: true }, doneDays: 14 })
    expect(writeSettingValue(dir, 'column.todo', false)).toBeNull()
    expect(writeSettingValue(dir, 'doneDays', 3)).toBeNull()
    expect(boardSettings(readSettingValues(dir).values)).toEqual({ columns: { todo: false, progress: true, review: true, done: true }, doneDays: 3 })
    expect(boardSettings({ 'column.done': 'no', doneDays: -1 })).toEqual({ columns: { todo: true, progress: true, review: true, done: true }, doneDays: 14 })
  })
})
