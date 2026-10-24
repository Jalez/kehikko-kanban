import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SETTINGS_PATH, skillPath, skillTextIssue } from 'kehikot-module-protocol'

import { ASK, CLOCK, MANIFEST, TICKET, answer, forgetSeen, servingAt } from '../doors.ts'
import { ID } from '../manifest.ts'
import { cardsOf } from '../src/board/cards.ts'
import { seenOf } from '../src/board/seen.ts'
import { EPIC, NOW, ROWS } from './fixtures.ts'

const project = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-kanban-doors-')))
afterAll(() => rmSync(project, { recursive: true, force: true }))

/* A host that holds exactly one project, and no conversation with a place: the door asks it, never a real one. */
ASK.options = {
  env: { KEHIKOT_ORIGINS: 'http://127.0.0.1:1' },
  fetch: (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.pathname === '/host/is-project') {
      const path = url.searchParams.get('path')
      return Response.json(path === project ? { ok: true, project: true, path } : { ok: true, project: false })
    }
    return Response.json({ ok: true, place: null })
  }) as typeof fetch,
}
CLOCK.now = () => NOW

const none = new URLSearchParams()
const cards = cardsOf(ROWS, ROWS).map(seenOf)

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const reply = await answer('POST', '/mcp', none, { jsonrpc: '2.0', id: 1, method, params }, null)
  return reply?.body as {
    result: { tools?: { name: string; annotations?: { readOnlyHint?: boolean }; inputSchema: { properties: object } }[]; content?: { text: string }[]; isError?: boolean }
  }
}
const tool = async (name: string, args: Record<string, unknown>) => {
  const said = (await rpc('tools/call', { name, arguments: args })).result
  return { text: said.content?.[0]?.text ?? '', error: said.isError === true }
}
const write = (body: Record<string, unknown>, ticket: string | null = TICKET) => answer('POST', '/api/board', none, body, ticket)
const read = async () => (await answer('GET', '/api/board', new URLSearchParams({ project, epic: EPIC }), null, null))?.body as { moves: { moved: Record<string, { to: string; by: { kind: string; name?: string } }> } }

beforeEach(async () => {
  forgetSeen()
  await write({ project, epic: EPIC, op: 'reset-all' })
})

describe('the doors', () => {
  test('the health check says which module this is', async () => {
    const reply = await answer('GET', '/healthz', none, null, null)
    expect((reply?.body as { id: string }).id).toBe(ID)
  })

  test('a path that is not ours is left to Vite, and an unknown /api path is refused', async () => {
    expect(await answer('GET', '/src/main.tsx', none, null, null)).toBeNull()
    expect((await answer('GET', '/api/nothing', none, null, null))?.status).toBe(404)
  })

  test('only this page writes: without its ticket a move is refused, with it the move is kept', async () => {
    const body = { project, epic: EPIC, op: 'move', ref: 'gh#1', to: 'review', tracked: 'todo', refs: [], index: 0 }
    expect((await write(body, null))?.status).toBe(403)
    expect((await write(body, 'not-the-ticket'))?.status).toBe(403)
    expect((await write(body))?.status).toBe(200)
    expect((await read()).moves.moved['gh#1']).toMatchObject({ to: 'review', by: { kind: 'person' } })
    expect((await write({ project, epic: EPIC, op: 'reset', ref: 'gh#1' }))?.status).toBe(200)
    expect((await read()).moves.moved).toEqual({})
  })

  test('a malformed change is refused with a sentence', async () => {
    expect((await write({ project, epic: EPIC, op: 'move', ref: 'gh#1', to: 'nowhere' }))?.status).toBe(400)
    expect((await write({ project, epic: EPIC, op: 'seen', cards: [{ ref: 'gh#1' }] }))?.status).toBe(400)
  })
})

describe('the settings door', () => {
  test('reads the defaults, saves a change, and says where they are kept', async () => {
    const got = await answer('GET', SETTINGS_PATH, new URLSearchParams({ project }), null, null)
    expect(got?.body).toMatchObject({ ok: true, values: { 'column.todo': true, doneDays: 14 }, file: '.kehikot/kanban/settings.json' })
    const set = await answer('POST', SETTINGS_PATH, none, { project, key: 'doneDays', value: 3, by: 'person' }, TICKET)
    expect(set?.body).toMatchObject({ ok: true, outcome: 'saved', values: { doneDays: 3 } })
    const refused = await answer('POST', SETTINGS_PATH, none, { project, key: 'doneDays', value: 'soon', by: 'agent' }, null)
    expect(refused?.body).toMatchObject({ outcome: 'refused' })
    const elsewhere = await answer('POST', SETTINGS_PATH, none, { project: '/not/a/project', key: 'doneDays', value: 3, by: 'agent' }, null)
    expect(elsewhere?.body).toMatchObject({ outcome: 'refused' })
    expect(existsSync('/not/a/project')).toBe(false)
    /* The page reads them with its moves. */
    const board = (await answer('GET', '/api/board', new URLSearchParams({ project, epic: EPIC }), null, null))?.body as { settings: { doneDays: number } }
    expect(board.settings.doneDays).toBe(3)
    await answer('POST', SETTINGS_PATH, none, { project, key: 'doneDays', value: 14, by: 'person' }, TICKET)
  })
})

describe('the MCP door', () => {
  test('lists board, which reads, and move_card, which writes this board only', async () => {
    expect((await answer('GET', '/mcp', none, null, null))?.status).toBe(405)
    const tools = (await rpc('tools/list')).result.tools!
    expect(tools.map((one) => [one.name, one.annotations?.readOnlyHint])).toEqual([
      ['board', true],
      ['move_card', false],
    ])
    for (const one of tools) expect(Object.keys(one.inputSchema.properties).slice(0, 2)).toEqual(['project', 'epic'])
  })

  test('before any page drew the board, board says so, and move_card refuses', async () => {
    const said = await tool('board', { project, epic: EPIC })
    expect(said.error).toBe(false)
    expect(said.text).toContain('No Kanban page has drawn the board of the epic launch')
    expect((await tool('move_card', { project, epic: EPIC, ref: 'gh#1', column: 'done' })).error).toBe(true)
  })

  test('board says every column and card, the titles as quoted text', async () => {
    await write({ project, epic: EPIC, op: 'seen', cards })
    const said = await tool('board', { project, epic: EPIC })
    expect(said.text).toContain('## To do (todo): 2')
    expect(said.text).toContain('- gh#1 Issue "Sign-in page for the beta" — Open, nobody on it · labels: web, p1')
    expect(said.text).toContain('## Done (done): 2, and 1 finished more than 14 days ago left off')
  })

  test('move_card moves a card on this board, marked as an agent’s, and back again', async () => {
    await write({ project, epic: EPIC, op: 'seen', cards })
    const moved = await tool('move_card', { project, epic: EPIC, ref: 'gh#1', column: 'In review', by: 'Claude Code' })
    expect(moved.error).toBe(false)
    expect(moved.text).toContain('marked as an agent’s move (Claude Code)')
    expect(moved.text).toContain('nothing was written to GitHub or GitLab')
    expect((await read()).moves.moved['gh#1']).toMatchObject({ to: 'review', by: { kind: 'agent', name: 'Claude Code' } })
    expect((await tool('board', { project, epic: EPIC })).text).toContain('Moved here by an agent (Claude Code)')
    const back = await tool('move_card', { project, epic: EPIC, ref: 'gh#1', column: 'todo' })
    expect(back.text).toContain('where the tracker has it')
    expect((await read()).moves.moved).toEqual({})
  })

  test('move_card refuses a card that is not on the board, a column that is not one, and a project the host does not hold', async () => {
    await write({ project, epic: EPIC, op: 'seen', cards })
    expect((await tool('move_card', { project, epic: EPIC, ref: 'gh#99', column: 'done' })).error).toBe(true)
    expect((await tool('move_card', { project, epic: EPIC, ref: 'gh#1', column: 'later' })).error).toBe(true)
    expect((await tool('board', { project: '/not/a/project', epic: EPIC })).error).toBe(true)
    expect((await tool('board', {})).error).toBe(true)
  })

  test('each skill is served at its path, with the origin filled in and a text a host accepts', async () => {
    servingAt('http://127.0.0.1:9520')
    for (const skill of MANIFEST.declares.skills ?? []) {
      const reply = await answer('GET', skillPath(skill.name), none, null, null)
      const text = reply?.raw?.bytes as string
      expect(skillTextIssue(text, skill.name)).toBeNull()
      expect(text).not.toContain('{{origin}}')
      expect(text).toContain('http://127.0.0.1:9520')
      expect(text).toContain(`[skill ${skill.version}]`)
    }
  })
})
