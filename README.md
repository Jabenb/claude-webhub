# Claude Hub (webhub) for Claude Code

English | [Русский](README.ru.md)

The side pane of the Claude Code app is small and plain. Claude Hub gives your mods a real browser page instead: any HTML, CSS and script you like, updated live, with buttons whose presses reach Claude as messages.

The hub is the base the mods plug into. It runs one small local server, hosts every mod's own page, lists the pages on its home page by session (with the session's name) and by project, streams each mod's state to its page and hands what you press there back to the mod. The hub itself shows nothing of its own: the mods bring the pages.

## What you get

- **One address for all mods.** `http://localhost:7777` lists every page your mods opened, grouped under **Projects**, **Live** and **Ended** sessions, with search, badges for what waits for you, and links that open a page in its own tab.
- **Session pages and project pages.** A session page belongs to one chat (questions Claude asked, a board for this task). A project page is shared by every session of the same git repository (a test runner, a monitor): a press goes to the session you wrote in last, or to the session the page names.
- **Live and reliable.** State reaches every open tab at once; a press is kept until the mod confirms it, and the page shows **Delivered**. Pages and their state survive a restart of the hub and of Claude.
- **Three languages and two themes.** English, Russian and Ukrainian; light, dark or as the system. Mod pages follow the choice.
- **Remote sessions.** Claude Code on a server over SSH works the same: forward the port and open the hub in your local browser.

## Requirements

- **Docker** on the machine where Claude Code runs. The mod starts the server itself in a container named `claude-webhub` (`node:20-alpine`, restarted with docker, bound to `127.0.0.1` only).
- A Claude Code build with mods (plugins with a hooks module).

## Install

At the prompt of a Claude Code session:

```
/plugin install webhub --marketplace jabenb/claude-webhub
```

From a shell:

```bash
claude plugin install webhub --marketplace jabenb/claude-webhub
```

In the Claude desktop app: **+** next to the prompt box, **Plugins**, **Add marketplace** with `jabenb/claude-webhub`, then **Add plugin**.

### Globally or for one project

| Scope | Runs in | Written to |
|---|---|---|
| `user` (default) | every project | `~/.claude/settings.json` |
| `project` | this repository, for everyone who clones it | `<project>/.claude/settings.json`, committed |
| `local` | this repository, only for you | `<project>/.claude/settings.local.json`, not committed |

```bash
claude plugin install webhub --marketplace jabenb/claude-webhub --scope user
claude plugin install webhub --marketplace jabenb/claude-webhub --scope project
```

Install the hub wherever you install a mod that uses it: such a mod names `webhub` as its dependency.

## Use

1. Start a session. The hub's server starts by itself on the first session (the first start pulls the `node:20-alpine` image).
2. Run `/hub` in the session to see the address, and open it in your browser.
3. Mods that use the hub put their pages there; open one from the list.

### Claude Code on a remote server

The server listens on the remote machine's `127.0.0.1:7777`. Forward it from your **local** machine and keep the command running:

```bash
ssh -N -L 7777:127.0.0.1:7777 <host>
```

Then open `http://localhost:7777` locally.

### Options

Set at install, or later under `/plugin`:

| Option | Default | What it is |
|---|---|---|
| `port` | `7777` | The local port of the server. |
| `publicUrl` | empty | Where your browser reaches the hub when that is not `http://localhost:<port>` (an SSH forward to another port, a tunnel). The links the mods show use it. |

## Writing a mod for the hub

The plugin ships the `webhub-mod` skill with a ready template mod: ask Claude "make a mod for the hub that …" and it starts from the template. In short:

- The mod names `"dependencies": ["webhub@claude-webhub"]` in its `plugin.json` (and `"allowCrossMarketplaceDependenciesOn": ["claude-webhub"]` in its `marketplace.json`) and gets `$.webhub`: `page` (register its page), `push` (send the page its state), `read` (get it back), `pull` (take the presses made on the page).
- The page is the mod's own whole HTML. It loads `/hub.js` for `window.hub` (`onState`, `send`, `onDelivered`, `onSessions`, `lang`, `theme`) and, if it likes, `/hub.css` for the hub's colours in both themes.
- `scope: 'project'` makes the page shared by the project's sessions; without it the page belongs to the session.

The full contract is in `types/index.d.ts`, `server/static/hub.js` and [`skills/webhub-mod/SKILL.md`](skills/webhub-mod/SKILL.md).

## Where the data lives

Pages and their state are kept in `~/.claude/mods-data/webhub/pages` (under `$CLAUDE_CONFIG_DIR` when set), one file per page. A page of an ended session stays in the list until you remove it (✕); pages unchanged for 30 days are dropped when the server restarts.

The server answers only on `127.0.0.1`. It has no login: anyone who can reach that port on the machine can see the pages and press their buttons.

## Stop or uninstall

```
/plugin uninstall webhub
```

The container keeps running after that; stop and remove it with:

```bash
docker rm -f claude-webhub
```

## License

MIT, see [LICENSE](LICENSE).
