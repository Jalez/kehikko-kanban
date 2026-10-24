import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'

import { EPIC_SLUG, KEHIKOT_DIR, kehikotDir, moduleDir, moduleFile, within } from 'kehikot-module-protocol'

import { ID } from './manifest.ts'
import { COLUMN_IDS } from './src/board/columns.ts'
import { DEFAULT_SETTINGS, epicMovesOf, isEmpty, noMoves, type BoardSettings, type EpicMoves } from './src/board/moves.ts'

/**
 * Kanban's material, kept inside the project it is about, and nowhere else:
 *
 * - `<project>/.kehikot/kanban/moves.json`: the cards a person (or an agent) moved on each epic's
 *   board, and the order within each column. Nothing in it is written to a tracker.
 * - `<project>/.kehikot/kanban/settings.json`: which columns show, and how long Done keeps items.
 *
 * The folder and the join are the protocol's (`moduleDir`, `moduleFile`). With no project, every read
 * is empty and every write refused. Both sides are realpath'd before the containment check, so a
 * `.kehikot` that is a symlink out of the project is refused rather than followed.
 */
export const MOVES = 'moves'
export const SETTINGS = 'settings'
export const MOVES_FILE = `${KEHIKOT_DIR}/kanban/${MOVES}.json`
export const SETTINGS_FILE = `${KEHIKOT_DIR}/kanban/${SETTINGS}.json`
const FORMAT = 1

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

const NO_PROJECT = 'Nothing has said which project this is, so there is nowhere to keep anything. Open a project in Kehikot.'
const NO_EPIC = 'Say which epic: a board is one epic’s.'

/* ------------------------------------------------------------------ *
 * Moves.
 * ------------------------------------------------------------------ */

interface MovesFile {
  version: number
  epics: Record<string, unknown>
  [other: string]: unknown
}

function readMovesFile(projectPath: string | null | undefined): Result<MovesFile> {
  const file = fileFor(projectPath, MOVES, false)
  if (!file.ok) return file
  if (!existsSync(file.value)) return { ok: true, value: { version: FORMAT, epics: {} } }
  try {
    const parsed = JSON.parse(readFileSync(file.value, 'utf8')) as Partial<MovesFile> | null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    const epics = parsed.epics && typeof parsed.epics === 'object' && !Array.isArray(parsed.epics) ? parsed.epics : {}
    return { ok: true, value: { ...parsed, version: typeof parsed.version === 'number' ? parsed.version : FORMAT, epics: { ...epics } } }
  } catch {
    return { ok: false, error: `${MOVES_FILE} in this project is not readable JSON. Nothing was changed; fix or remove the file.` }
  }
}

/** The moves kept for one epic's board. */
export function readMoves(projectPath: string | null | undefined, epic: string | null | undefined): Result<EpicMoves> {
  if (!epic || !EPIC_SLUG.test(epic)) return { ok: false, error: NO_EPIC }
  const read = readMovesFile(projectPath)
  if (!read.ok) return read
  return { ok: true, value: Object.hasOwn(read.value.epics, epic) ? epicMovesOf(read.value.epics[epic]) : noMoves() }
}

/**
 * Change one epic's moves and keep the result. Every other epic, and every key this module does not
 * know, stays as it was. Written to a temporary file and renamed. No change: no write.
 */
export function editMoves(projectPath: string | null | undefined, epic: string | null | undefined, edit: (moves: EpicMoves) => EpicMoves): Result<EpicMoves> {
  if (!epic || !EPIC_SLUG.test(epic)) return { ok: false, error: NO_EPIC }
  const read = readMovesFile(projectPath)
  if (!read.ok) return read
  const was = Object.hasOwn(read.value.epics, epic) ? epicMovesOf(read.value.epics[epic]) : noMoves()
  const next = edit(was)
  if (JSON.stringify(next) === JSON.stringify(was)) return { ok: true, value: was }
  const epics = { ...read.value.epics }
  if (isEmpty(next)) delete epics[epic]
  else epics[epic] = next
  const written = writeJson(projectPath, MOVES, { ...read.value, version: FORMAT, epics })
  return written ? { ok: false, error: written } : { ok: true, value: next }
}

/* ------------------------------------------------------------------ *
 * Settings: the store behind the settings door (protocol 2.15.0).
 * ------------------------------------------------------------------ */

export const SETTING_KEYS = {
  column: (id: (typeof COLUMN_IDS)[number]) => `column.${id}`,
  doneDays: 'doneDays',
} as const

/** The raw values kept, by key, and a sentence when the file could not be read. */
export function readSettingValues(projectPath: string | null | undefined): { values: Record<string, unknown>; problem?: string } {
  const file = fileFor(projectPath, SETTINGS, false)
  if (!file.ok) return { values: {}, problem: file.error }
  if (!existsSync(file.value)) return { values: {} }
  try {
    const parsed = JSON.parse(readFileSync(file.value, 'utf8')) as { values?: unknown } | null
    const values = parsed?.values
    return { values: values && typeof values === 'object' && !Array.isArray(values) ? { ...(values as Record<string, unknown>) } : {} }
  } catch {
    return { values: {}, problem: `${SETTINGS_FILE} in this project is not readable JSON. The defaults are shown; fix or remove the file.` }
  }
}

/** Write one checked value, keeping every other key. A sentence to refuse, null when written. */
export function writeSettingValue(projectPath: string | null | undefined, key: string, value: unknown): string | null {
  const read = readSettingValues(projectPath)
  if (read.problem) return read.problem
  const file = fileFor(projectPath, SETTINGS, false)
  let whole: Record<string, unknown> = {}
  if (file.ok && existsSync(file.value)) {
    try {
      whole = JSON.parse(readFileSync(file.value, 'utf8')) as Record<string, unknown>
    } catch {
      return `${SETTINGS_FILE} in this project is not readable JSON. Nothing was changed.`
    }
  }
  return writeJson(projectPath, SETTINGS, { ...whole, version: FORMAT, values: { ...read.values, [key]: value } })
}

/** The board's settings, each value checked, the default where one is missing or of another type. */
export function boardSettings(values: Record<string, unknown>): BoardSettings {
  const columns = { ...DEFAULT_SETTINGS.columns }
  for (const id of COLUMN_IDS) {
    const one = values[SETTING_KEYS.column(id)]
    if (typeof one === 'boolean') columns[id] = one
  }
  const days = values[SETTING_KEYS.doneDays]
  const doneDays = typeof days === 'number' && Number.isFinite(days) && days >= 0 ? Math.min(Math.floor(days), 3650) : DEFAULT_SETTINGS.doneDays
  return { columns, doneDays }
}

/* ------------------------------------------------------------------ *
 * The files.
 * ------------------------------------------------------------------ */

function writeJson(projectPath: string | null | undefined, name: string, value: unknown): string | null {
  const file = fileFor(projectPath, name, true)
  if (!file.ok) return file.error
  const temporary = `${file.value}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(temporary, file.value)
  return null
}

/** A data file's path, checked to resolve inside the project. `make` creates the folder first. */
function fileFor(projectPath: string | null | undefined, name: string, make: boolean): Result<string> {
  const root = projectRoot(projectPath)
  if (!root.ok) return root
  const dir = moduleDir(root.value, ID)!
  const levels = [kehikotDir(root.value)!, dir]
  /* Checked before making anything, so a folder that escapes is never written into, and again after. */
  const escaped = escapesAny(root.value, levels)
  if (escaped) return { ok: false, error: escaped }
  if (make) {
    mkdirSync(dir, { recursive: true })
    const after = escapesAny(root.value, levels)
    if (after) return { ok: false, error: after }
  }
  const file = moduleFile(root.value, ID, name)!
  if (existsSync(file)) {
    const out = escapes(root.value, file)
    if (out) return { ok: false, error: out }
  }
  return { ok: true, value: file }
}

function projectRoot(projectPath: string | null | undefined): Result<string> {
  const raw = typeof projectPath === 'string' ? projectPath.trim() : ''
  if (!raw) return { ok: false, error: NO_PROJECT }
  if (!isAbsolute(raw)) return { ok: false, error: `"${raw}" is not an absolute path.` }
  try {
    const real = realpathSync(raw)
    if (!statSync(real).isDirectory()) return { ok: false, error: `"${raw}" is not a folder.` }
    return { ok: true, value: real }
  } catch {
    return { ok: false, error: `There is no folder at "${raw}" on this computer.` }
  }
}

function escapesAny(root: string, paths: string[]): string | null {
  for (const path of paths) {
    if (!existsSync(path)) continue
    const out = escapes(root, path)
    if (out) return out
  }
  return null
}

function escapes(root: string, child: string): string | null {
  let real: string
  try {
    real = realpathSync(child)
  } catch {
    return `${child} could not be resolved, so nothing is read or written through it.`
  }
  return within(root, real) ? null : `${child} resolves to ${real}, outside the project. Refused rather than followed.`
}
