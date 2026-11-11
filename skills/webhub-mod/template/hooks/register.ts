import type { EngineInterface, Register } from 'claude-code'

import { PAGE } from './page'

/** The mod's name in the hub: letters, digits, `.`, `_`, `-`. Kept equal to `name` in plugin.json, so the tool below is `mcp__<MOD>__show`. */
const MOD = 'my-mod'
const TITLE = 'My mod'
const ICON = '✦'
/** `session`: a page per session, listed under its name. `project`: one page for the project, shared by its sessions; a press goes to the live one the person wrote in last. */
const SCOPE: 'session' | 'project' = 'session'
/** The tool `show` as the engine names it; a pattern, as a tool this mod registers is not in the types until the mod has loaded once. */
const SHOW = new RegExp(`^mcp__${MOD}__show$`)
const PULL_WAIT_MS = 5000
const PULL_STUCK_MS = PULL_WAIT_MS + 10_000

export type Item = { id: number; text: string }
export type State = { title: string; items: Item[] }

/** What the page passes to `hub.send`; the page in page.ts sends `{ type: 'send', picked, text }`. */
type PageAction = { type?: unknown; picked?: unknown; text?: unknown }

/** One load of this module: the hub hands the page's actions to the newest load only. */
const LISTENER = `${Date.now()}-${Math.random().toString(36).slice(2)}`

export const EMPTY: State = { title: TITLE, items: [] }

/** The tool's input as the page's state: blank lines dropped, ids from 1. */
export const stateOf = (input: { title?: unknown; items?: unknown }): State => ({
  title: typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim() : TITLE,
  items: (Array.isArray(input.items) ? input.items : [])
    .map(item => String((item as { text?: unknown } | null)?.text ?? '').trim())
    .filter(text => text !== '')
    .map((text, index) => ({ id: index + 1, text })),
})

/** The message one press on the page sends Claude; empty when there is nothing to send. */
export const messageOf = (state: State, action: unknown): string => {
  const { type, picked, text } = (action ?? {}) as PageAction

  if (type !== 'send') {
    return ''
  }

  const ids = Array.isArray(picked) ? picked.map(Number) : []
  const chosen = state.items.filter(item => ids.includes(item.id)).map(item => `- [${item.id}] ${item.text}`)
  const comment = typeof text === 'string' ? text.trim() : ''

  return [chosen.length > 0 ? `From the page «${state.title}», picked:\n${chosen.join('\n')}` : '', comment].filter(part => part !== '').join('\n\n')
}

/** This load's own values; a reload runs `register` again and starts them over. */
let last: State = EMPTY
let listening = { since: 0, isFirst: true, isStale: false }

/** Puts the page in the hub (again after the hub lost it) with the latest state. */
const show = async ($: EngineInterface): Promise<{ isUp: boolean; url: string }> => {
  const page = await $.webhub.page({ mod: MOD, scope: SCOPE, title: last.title, html: PAGE, icon: ICON })
  await $.webhub.push({ mod: MOD, scope: SCOPE, state: last, badge: last.items.length })

  return page
}

/** One long-poll for the page's presses; a pull still running is not doubled, one the engine dropped is given up after a while. */
const listen = async ($: EngineInterface): Promise<void> => {
  const now = Date.now()

  if (listening.isStale || (listening.since !== 0 && now - listening.since < PULL_STUCK_MS)) {
    return
  }

  listening = { ...listening, since: now }

  try {
    const pulled = await $.webhub.pull({ mod: MOD, scope: SCOPE, listener: LISTENER, isFirst: listening.isFirst, waitMs: PULL_WAIT_MS })
    listening = { ...listening, isStale: pulled.isStale, isFirst: listening.isFirst && !pulled.isUp }

    if (pulled.isUp && !pulled.isRegistered) {
      await show($)
    }

    for (const action of pulled.actions) {
      const text = messageOf(last, action.data)

      if (text !== '') {
        await $.prompt.submit({ text, asUser: true })
      }
    }
  } finally {
    listening = { ...listening, since: 0 }
  }
}

export const register: Register = on => {
  last = EMPTY
  listening = { since: 0, isFirst: true, isStale: false }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.tool.register({
      name: 'show',
      description: `Put a list on the "${TITLE}" page in the user's browser (replaces what is there). The user picks lines there, adds a comment and sends them back as a message.`,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'What the list is about' },
          items: { type: 'array', items: { type: 'object', properties: { text: { type: 'string', description: 'One short line' } }, required: ['text'] } },
        },
        required: ['items'],
      },
    })

    const { state } = await $.webhub.read({ mod: MOD, scope: SCOPE })
    last = state === null ? EMPTY : stateOf(state as State)
    await show($)
    $.clock.every(1000, () => void listen($).catch(() => undefined))

    return result
  })

  on('tool.call', { tool: SHOW }, async ($, e) => {
    const state = stateOf(e as unknown as { title?: unknown; items?: unknown })

    if (state.items.length === 0) {
      return { deny: 'No lines given: pass items as [{ text }].' }
    }

    last = state
    const { isUp, url } = await show($)

    return isUp
      ? { result: `${state.items.length} lines are on the page (ids 1-${state.items.length}). The user sees it at ${url}` }
      : { deny: 'The hub does not answer (is docker running?): the page was not updated.' }
  })
}
