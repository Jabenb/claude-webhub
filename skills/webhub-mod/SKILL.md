---
name: webhub-mod
description: Use when making, changing or debugging a mod (Claude Code plugin with a hooks module) that has its own browser page in the webhub hub — "мод с браузерной страницей", "мод для хаба", "страница мода в браузере", a page that shows live state and sends what the person presses back to Claude, per session or shared by a whole project (a test runner, a monitor). Not for a pane inside the app (that is the plugin-authoring skill alone).
---

# A mod with a browser page in the webhub hub

The webhub plugin runs one local server (docker container `claude-webhub`, `127.0.0.1:7777`) and adds `$.webhub` to every mod. A mod brings its **own whole HTML page**; the hub hosts it, lists it on its home page under the session it belongs to (with the session's name), streams the mod's state to it live and hands what the person presses back to the mod, which turns it into a message to Claude.

Load the `plugin-authoring` skill too: it says where a mod's files go, how hot reload works and where the engine's types are. This skill adds only the hub part.

## Start from the template

`template/` next to this file is a complete working mod (a list Claude puts on the page; the person picks lines, adds a comment, presses Send, and Claude gets it as a message). Its tests pass and it type-checks. Copy the whole folder to the new mod's folder, then rename:

0. `tests/mod.test.ts.template` → `tests/mod.test.ts` (it carries another extension here only so the hub's own test run skips it).
1. `MOD` in `hooks/register.ts` and `name` in `.claude-plugin/plugin.json`: the same string (letters, digits, `.`, `_`, `-`). Registered tools become `mcp__<MOD>__<tool>`; rename `my-mod` in `tests/mod.test.ts` too.
2. `TITLE`, `ICON` (one emoji or character) and `SCOPE` (below) in `hooks/register.ts`; `description` in plugin.json.
3. The page in `hooks/page.ts`: its `<title>`, and the `TEXTS` table (keep `en`, `ru`, `uk`: the hub's own languages).
4. Then change what the mod does: its state type, its tools, `messageOf` (what a press says to Claude), the page's markup.

Keep the template's skeleton: the listening loop, the re-registration when the hub lost the page, the `LISTENER` id. They are the parts that are easy to get wrong.

## Session page or project page

Decide first whom the page belongs to, and pass that `scope` to **every** `$.webhub` call for it (a call without one means the session's page):

- `scope: 'session'` (the default): one page per session, listed in the hub under the session's name. For what lives and dies with one conversation: questions Claude asked, a review of this session's diff, a board of this task.
- `scope: 'project'`: one page for the project (the session's git root, else its folder), listed under **Projects**. Every session of that project that has the mod listens to the same page; any of them may `push` to it. For what belongs to the codebase, not to a chat: a test runner, a migrations or queue monitor, a deploy panel.

Where a press on a project page goes:

- With no address, to the **active** session: the live one the person wrote in last (the hub learns that from every prompt the person sends; a message a mod submits counts too). A press made while no session lives waits and goes to the first one that listens.
- `hub.send(data, { to: sessionId })` sends it to that session alone, e.g. to the session that started a test run when the press asks Claude about that run. For that the mod puts its own `await $.session.id()` into the state (`owner` of the run), and the page uses it as `to`.
- A press addressed to the active session that died before taking it goes to the next active one; a press addressed to a session by id waits for that session.

A project page's work still runs in a session: the mod in the session that took a press does it (`$.process.run`, a message to Claude). With no live session in the project the page shows, but nothing happens until one starts.

On the page, show where a press will go: `hub.onSessions` lists the listening sessions with `isActive`, so a button can say "Run tests → «Geo migration»" (the template does this once more than one session listens). Keep presses that only run something (start the tests) apart from presses that write to Claude (ask about the failures): the first fit any session, the second belong in the session whose work they are about.

## The contract

### Mod side (`$.webhub`, typed by `webhub`'s own contract)

`.claude-plugin/plugin.json` has `"dependencies": ["webhub@claude-webhub"]`: the engine then loads the hub first and lays its types for the mod (`.claude-plugin/types/webhub`). Name the hub with its marketplace: a bare `"webhub"` is looked up in the mod's own marketplace, so an install from there fails with `dependency "webhub@<your marketplace>" was not installed`. Loaded from a folder (`--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`), both spellings work.

| Call | What it does |
| --- | --- |
| `$.webhub.page({ mod, scope?, title, html, icon? })` → `{ isUp, url }` | Registers (or replaces) the page of this session or project; starts the hub's container when it is not running. `url` is what to show the person. |
| `$.webhub.push({ mod, scope?, state, badge? })` → `{ isUp }` | Sends the page its state (any JSON); every open tab gets it at once. `badge`: how many things wait for the person, shown in the hub's list. |
| `$.webhub.read({ mod, scope? })` → `{ isUp, state }` | The state the hub holds for the page (it survives a mod reload and a hub restart). |
| `$.webhub.pull({ mod, scope?, listener, isFirst?, waitMs? })` → `{ isUp, isStale, isRegistered, actions }` | Long-poll for the presses meant for this session, `waitMs` ≤ 8000. `isStale`: a newer load of the mod in this session took over, stop. `isRegistered: false`: the hub lost the page, call `page` and `push` again. Delivery is confirmed to the page automatically. |

Each action is `{ id, at, data }`, `data` being exactly what the page passed to `hub.send`. Turn it into a message with `$.prompt.submit({ text, asUser: true })`.

### Page side (`/hub.js`, `/hub.css`)

The page is plain HTML with inline script and style (no build step, no CDN needed). It loads `<script src="/hub.js"></script>`, which gives `window.hub`:

| | |
| --- | --- |
| `hub.onState(fn)` | the state the mod pushed; called at load with the latest, and on every push |
| `hub.send(data, { to }?)` → `Promise<{ id, online, to }>` | hands the mod an action (any JSON); `to`: a session's id, or `'active'` (the default); `to` in the answer is the session it went to, `null` while none listens |
| `hub.onDelivered(fn)` | `ids` of actions the mod has received: show "Delivered" |
| `hub.onOnline(fn)` | `{ hub, session }`: whether the hub answers and a session listens |
| `hub.onSessions(fn)` | `[{ id, title, label, isLive, isActive }]`: the sessions listening to the page (a session page: its own) |
| `hub.onMeta(fn)` | `{ title, scope, sessionTitle, label }`; on a project page `sessionTitle` is the project's name, `label` its root |
| `hub.lang`, `hub.onLang(fn)` | `en` / `ru` / `uk`, as chosen in the hub |
| `hub.theme`, `hub.onTheme(fn)` | `auto` / `light` / `dark`; `hub.js` keeps `data-theme` on `<html>` |
| `hub.mod`, `hub.session` | the page's address |

`<link rel="stylesheet" href="/hub.css">` gives the hub's colours for both themes as variables, styling nothing by itself: `--hub-bg`, `--hub-surface`, `--hub-raised`, `--hub-line`, `--hub-text`, `--hub-dim`, `--hub-accent`, `--hub-accent-soft`, `--hub-ok`, `--hub-warn`, `--hub-danger`, `--hub-info`, `--hub-radius`, `--hub-shadow`, `--hub-font`. Use them so the page looks at home in the hub in light and dark.

The page shows inside the hub's frame; never link back to the hub's home from it.

## Engine rules that break a hub mod

- Spell every hub call `$.webhub.<method>(...)` in the hooks module itself. Do not store `$.webhub` in a variable or pass it around; a function in the same file may take `$` (as `show` and `listen` in the template do).
- `$.http.fetch` gives up after about 10 s: that is why `pull` waits 8 s at most.
- Listen with `$.clock.every(1000, …)` and an in-flight guard. A `while` loop started in the background stops listening.
- A tool the mod registers is not in the engine's types until the mod has loaded once: match it in `on('tool.call', { tool }, …)` with a `RegExp`, as the template does.
- `page.ts` is a template string: no `${` and no backticks inside the page's own script.
- Module variables start over on every reload (`register` runs again); the page's state lives in the hub, read it back with `$.webhub.read` at `session.start`.
- Files changed during a turn reload when the turn ends: try the change in the next turn.

## Checking it

- `claude plugin test <mod folder>`: the template's `tests/mod.test.ts` shows how to stand in for the hub (`on('engine.create', …)` adding a `webhub` object) and drive the listening loop (`mock.clock(on)` + `advance(1000)`).
- `claude plugin validate <mod folder>`.
- Type-check once the mod has loaded (its `.claude-plugin/types/` exists): `tsc -p <mod folder>`; with no node on the host, `docker run --rm -v <mod folder>:/mod -w /mod node:20-alpine npx -y -p typescript@5.6 tsc -p /mod/tsconfig.json`.
- Live: the hub's home page (`/hub` in the session prints its address) lists the page under this session; press Send and the message arrives in the chat.

## Shipping

The mod is an ordinary plugin: its own repository with `.claude-plugin/marketplace.json`, installed with `/plugin`. It works only where `webhub` is installed too (globally or in the same project). The hub comes from another marketplace, so the mod's `marketplace.json` must allow it at its top level, or the install refuses the dependency:

```json
"allowCrossMarketplaceDependenciesOn": ["claude-webhub"]
```
