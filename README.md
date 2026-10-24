# Kanban — a Kehikot module

The open epic's issues, pull requests and merge requests as a board: **To do**,
**In progress**, **In review** and **Done**. Each card is placed from what
GitHub and GitLab say, as Kehikot reads them for every module; Kanban holds no
login and never calls a tracker itself.

| Column | What the tracker says |
|---|---|
| To do | Open, and nobody is on it. |
| In progress | Open and assigned; a draft pull or merge request; an issue whose change is a draft. |
| In review | An open pull or merge request, or one whose review was asked for; an issue whose change is in review. |
| Done | Closed or merged, within the last 14 days (a setting). Foldable. |

- **Follows the parts you pick.** Pick parts in Kehikot's bar and the board
  shows only their cards; with none picked, the whole epic.
- **Cards.** Number, type (issue, task and the other GitLab work items, pull
  request, merge request), title, labels, who is assigned (their pictures, or
  initials), reviewers and where the review stands. Every state is an icon of
  its own shape and a word, never a colour alone. Pressing a card opens it on
  the canvas (a Browser there shows it), or in a new tab.
- **Moving a card changes this board only.** Drag a card, use its ⋯ menu, or
  press Alt+arrows on a focused card. The card is marked "Moved here by you"
  with **Put back** beside it, and the order you leave a column in is kept.
  Nothing is written to GitHub or GitLab. A move gives way by itself once the
  tracker moves the item.
- **Narrow.** Under 420 pixels, one column at a time with a switcher.
- **Header.** View › Cards (Compact / Comfortable) and Show Done; Run › Put all
  cards back (asks for a second press).
- **Settings** (the gear on the container): which columns show, and how many
  days a finished item stays in Done.

## Keyboard

With a card focused: **Enter** opens it, **↑ ↓ ← →** move the focus, **Alt+← →**
move the card to the column beside, **Alt+↑ ↓** move it up and down its column.
Every move is said aloud for a screen reader.

## Agents

The MCP door at `/mcp`:

- **`board`** (reads): every column and card of an epic — ref, type, title,
  where the tracker has it and why, review, assignees, labels, and any move.
  Whatever parts are picked. It answers from the board the Kanban page last
  drew: the tracker reading is handed to the page, not to this module's
  server, so with no page open on the epic since the module started it says so.
- **`move_card`** (writes, this board only): moves a card, marked "Moved here
  by an agent (<who>)". Moving it to the column the tracker has it in puts it
  back. Never a claim that work is done.

The header's view switches (Cards, Show Done) may be pressed by an agent; Put
all cards back is the person's.

## Skills

- **`/kanban`**: an agent reads the epic's board and tells you what is in each
  column, what looks stuck, and what was moved by hand. Offered in Kehikot's
  Settings › Skills like any module's.

## Data

- `<project>/.kehikot/kanban/moves.json` — the moves made on each epic's board,
  and the order within each column.
- `<project>/.kehikot/kanban/settings.json` — which columns show, and how long
  Done keeps items. Written by the settings form.

## Try it

1. `bun install`, then `bun run stub`: the module, framed the way Kehikot frames
   it, with a project, an epic, three parts and stand-in tracker rows (nothing
   is read from a tracker).
2. In Kehikot: the modules list › **Install from repository…** ›
   `Jalez/kehikko-kanban`. Kehikot reads it with your own `gh`, installs its
   newest release (or `main`, before the first), builds it and starts it.

## Development

```
bun test               # the board, the store, the doors, the header, the page
bun run typecheck
bun run check:door && bun run check:parts
bun run stub           # look at it, framed, without Kehikot
bun run build && bun run start   # the ready-built page on the same doors
```

How it is built and released, and the rules a change keeps: [CLAUDE.md](CLAUDE.md).
The whole guide: [Building a module](https://github.com/Jalez/kehikko-protocol/blob/main/docs/building-a-module.md).
