import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SERVER_ASK_PATH, SERVER_PASS_PATH, SETTINGS_PATH, serverAskSchema, skillPath, skillTextIssue, trackerRowSchema, type TrackerRow } from 'kehikot-module-protocol'
import { serverPassReply } from 'kehikot-module-protocol/serve'

import { ASK, CLOCK, MANIFEST, TICKET, answer, forgetSeen, servingAt } from '../doors.ts'
import { ID } from '../manifest.ts'
import { cardsOf } from '../src/board/cards.ts'
import { seenOf } from '../src/board/seen.ts'
import { EPIC, NOW, ROWS } from './fixtures.ts'

const project = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-kanban-doors-')))
afterAll(() => rmSync(project, { recursive: true, force: true }))

/**
 * A host that holds exactly one project, and no conversation with a place: the door asks it, never a
 * real one. It answers this module's SERVER (`/host/server-ask`, protocol 2.19.0) as a host does:
 * first it asks the module whether it minted the question's pass — the protocol's doors answer that,
 * here `serverPassReply` in the same process — then it answers `tracker.get` from `HOST.rows`. With
 * `HOST.answers` false it is a host before 2.19.0, which has no such route.
 */
const HOST = { answers: true, rows: ROWS as TrackerRow[], asked: [] as Array<Record<string, unknown>>, refused: null as null | 'grant' }
ASK.options = {
  env: { KEHIKOT_ORIGINS: 'http://127.0.0.1:1' },
  fetch: (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === '/host/is-project') {
      const path = url.searchParams.get('path')
      return Response.json(path === project ? { ok: true, project: true, path } : { ok: true, project: false })
    }
    if (url.pathname === SERVER_ASK_PATH) {
      if (!HOST.answers) return new Response('Not here.', { status: 404 })
      const ask = serverAskSchema.parse(JSON.parse(String(init?.body)))
      const vouched = serverPassReply('GET', SERVER_PASS_PATH, new URLSearchParams({ pass: ask.pass }))
      if (ask.module !== ID || !(vouched?.body as { minted: boolean }).minted) return Response.json({ ok: false, reason: 'failed', error: 'Not vouched for.', refused: 'pass' })
      if (HOST.refused) return Response.json({ ok: false, reason: 'failed', error: 'This module’s manifest does not ask for trackers:read.', refused: HOST.refused })
      if (ask.project !== project) return Response.json({ ok: false, reason: 'failed', error: 'No project there.', refused: 'project' })
      HOST.asked.push(ask.params)
      const refs = ask.params.epic ? HOST.rows.map((one) => one.ref) : (ask.params.refs as string[])
      const rows = HOST.rows.filter((one) => refs.includes(one.ref))
      return Response.json({ ok: true, data: { at: new Date(NOW).toISOString(), refreshing: false, sources: [], rows, missing: [] } })
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
  HOST.answers = true
  HOST.rows = ROWS
  HOST.asked = []
  HOST.refused = null
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

  test('with no page open, board reads the host’s tracker reading itself: every column and card, the titles as quoted text', async () => {
    const said = await tool('board', { project, epic: EPIC })
    expect(said.error).toBe(false)
    expect(said.text).toContain('The Kanban board of the epic launch, from the host’s tracker reading of 2026-10-24 12:00 UTC')
    expect(said.text).toContain('## To do (todo): 2')
    expect(said.text).toContain('- gh#1 Issue "Sign-in page for the beta" — Open, nobody on it · labels: web, p1')
    expect(said.text).toContain('## Done (done): 2, and 1 finished more than 14 days ago left off')
    expect(said.text).not.toContain('page last drew')
    /* The epic with its parts, in one question; then the changes that close its open issues, already held. */
    expect(HOST.asked[0]).toEqual({ epic: EPIC, parts: true })
  })

  test('a branch linked to an issue moves its card to In progress', async () => {
    const linked = trackerRowSchema.parse({ ...ROWS[0]!, branches: [{ name: '1-sign-in-page', url: 'https://github.com/example-org/demo/tree/1-sign-in-page' }] })
    HOST.rows = [linked, ...ROWS.slice(1)]
    const said = await tool('board', { project, epic: EPIC })
    expect(said.text).toContain('## To do (todo): 1')
    expect(said.text).toContain('- gh#1 Issue "Sign-in page for the beta" — Branch 1-sign-in-page')
  })

  test('a host before the server’s question: the board as the page last drew it, said so; with no page either, it says why and move_card refuses', async () => {
    HOST.answers = false
    const none = await tool('board', { project, epic: EPIC })
    expect(none.error).toBe(false)
    expect(none.text).toContain('could not be read from the host’s tracker reading')
    expect(none.text).toContain('no Kanban page has drawn it')
    expect((await tool('move_card', { project, epic: EPIC, ref: 'gh#1', column: 'done' })).error).toBe(true)
    await write({ project, epic: EPIC, op: 'seen', cards })
    const page = await tool('board', { project, epic: EPIC })
    expect(page.text).toContain('as its page last drew it')
    expect(page.text).toContain('## To do (todo): 2')
  })

  test('a host that will not answer this module gets nothing past its refusal', async () => {
    HOST.refused = 'grant'
    const said = await tool('board', { project, epic: EPIC })
    expect(said.text).toContain('trackers:read')
    expect(said.text).not.toContain('## To do')
  })

  test('move_card moves a card on this board, marked as an agent’s, and back again', async () => {
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
