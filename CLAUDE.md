# Kanban — notes for agents

A Kehikot module: a program with its own server, page and MCP door that a
Kehikot host frames in a container. The whole guide is
[Building a module](https://github.com/Jalez/kehikko-protocol/blob/main/docs/building-a-module.md);
what follows is how THIS repository is built, and the rules a change here keeps.

## Where things are

| | |
|---|---|
| `manifest.ts` | Who the module is. `DECLARED`, `SETTING_FIELDS`; the version is package.json's. |
| `doors.ts` | Every door but the page: `/healthz`, `/mcp` (`board`, `move_card`), `/api/board`, the settings door, the skills. Pure `answer()`; tests call it directly. |
| `store.ts` | The only code that touches project data: `.kehikot/kanban/moves.json` and `settings.json`. |
| `src/board/` | Pure and shared by the page and the server: `cards.ts` (a row → a card, and where the TRACKER puts it), `moves.ts` (moves laid over that, the order, placing), `seen.ts` (a card as the door says it, and the board in lines). |
| `src/wire/reading.ts` | What the page AND the server ask the host: `tracker.get` for the epic with its parts' refs, the parts' refs an older host did not cover, and the changes that close its issues. |
| `src/view/` | The board (`board.tsx`), a card (`card.tsx`), faces, and `use-board.ts` (reading, polling, moves). |
| `src/header.ts` | The header items: pure functions of state. |
| `src/app.tsx` | The page. `Screen` renders from a plain `Host`, so tests need no host. |
| `serve.ts`, `build.ts`, `run.sh` | Ready-built: `bun run build` stamps `dist/`, `run.sh` serves it when the stamp is HEAD, Vite otherwise. |
| `dev/stub-host.ts` | `bun run stub`: frames the module with stand-in rows (`test/fixtures.ts`). |

## The rules

- **Storage.** A project's data lives only under `<project>/.kehikot/<folder>/`,
  built with the protocol's `moduleDir`/`moduleFile` in `store.ts`. No `data/`
  folder, nothing under the home folder, nothing beside the code.
  `test/storage-boundary.test.ts` and Kehikot's `check:storage` both fail on it.
- **The header is the host's to draw.** Declare items (`src/header.ts`), handle
  presses in one handler, own all the state, and declare the whole list again on
  every change. It is one row at 380, 280 and 200 pixels: short labels (`LABEL_FIT`).
- **A module's strings are text.** Labels, notes and reasons are drawn as text,
  never as markup or links.
- **Page-only writes.** Every write to `/api` carries the page's ticket
  (`refuseTicket`). The MCP door reads, except `move_card`
  (`readOnlyHint: false`), which only moves a card on this board.
- **Agents never press what is a person's.** `agents: true` goes only on a
  harmless switch, toggle or jump; never on a run that writes, sends or
  deletes, never on a `confirm` run.
- **No tracker but the host's.** Every row comes from `tracker.get`; this
  module holds no credential and runs no `gh`/`glab`. Refreshing is the host's
  control, on the person's press only (`trackers:refresh`).
- **A move never leaves the board.** Moves are kept in `moves.json` and never
  written to a tracker; every place a move is made or said says so. A move
  stands only while the tracker still has the card where it was moved from.
- **The door reads the host's reading itself.** `board`/`move_card` ask the
  host through `askHost` (protocol 2.19.0, held to `trackers:read`), the same
  `readBoard` the page uses, un-narrowed, page open or not. Only from a host too
  old to answer a module's server do they fall back to what the page last drew
  (`op: 'seen'`, in memory only), and say so.
- **No Inbox items.** Nothing here needs the person; it declares no
  `activity:report`.
- **Ask only for what is called.** Each method needs its capability in
  `declares.uses`; nothing else goes there.
- **Plain language.** Every sentence a person reads says what happened and
  what to do, in their words: no ids, codes or stack traces.

## Working on it

```
bun test && bun run typecheck   # before every commit
bun run check:door              # what the MCP door says about its tools
bun run check:parts             # how the module follows the parts of an epic
bun run stub                    # look at it, framed, without Kehikot
```

Write the test first. Starting `./run.sh` or `bun run dev` from a checkout
registers that checkout with Kehikot on this computer when nothing else is
registered under the id; `bun run stub` never does.

## Releasing

Kehikot installs and updates this module from its GitHub releases, not from `main`.
Nobody tags by hand: merging the version bump is the release.

1. Bump `version` in `package.json` (semver). It is the only place the version
   is written: the manifest reads it.
2. Write `notes/<version>.md`: what a person notices (see `notes/README.md`).
3. Open a PR with both; merge it.
4. On that push to `main`, `.github/workflows/release.yml` (the shared
   `module-release.yml` in Jalez/kehikko-desktop) sees that `package.json`'s
   version is newer than the latest `v*` tag and that the notes exist, creates
   the annotated tag `v<version>` on the merge commit, checks the notes,
   typechecks and tests, then publishes the release "Kanban <version>" in the
   same run. A push that keeps the version releases nothing; a newer version
   without notes fails the run. If a check fails nothing is published: fix it
   in a PR with a newer version.
