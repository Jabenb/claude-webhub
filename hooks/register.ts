import type { Register } from 'claude-code'

import type { Webhub, WebhubAction, WebhubScope } from '../types'

/** What this plugin needs of the server; a running container whose number is lower is replaced. Kept equal to `API` in server/server.mjs. */
export const SERVER_API = 4
const CONTAINER = 'claude-webhub'
const IMAGE = 'node:20-alpine'
const COMMAND = 'hub'
const JSON_HEADERS = { 'content-type': 'application/json' }
const TITLE_EVERY_MS = 20_000
const RETRY_START_MS = 30_000

type Answer = Record<string, unknown> | null
type Hub = { server: string; publicUrl: string; port: string }

/** Where the engine reaches the server, and where the person's browser does. */
export const addressesOf = (options: Record<string, unknown>): Hub => {
  const port = /^\d{2,5}$/.test(String(options.port ?? '')) ? String(options.port) : '7777'
  const given = typeof options.publicUrl === 'string' ? options.publicUrl.trim().replace(/\/+$/, '') : ''

  return { server: `http://127.0.0.1:${port}`, publicUrl: given === '' ? `http://localhost:${port}` : given, port }
}

/** The name the app shows for a session, from the lines of its chat file that carry one: the person's own name wins over a generated one. */
export const titleOf = (lines: string): string => {
  const found = { customTitle: '', aiTitle: '' }

  for (const line of lines.split('\n')) {
    try {
      const entry = JSON.parse(`{${line.trim()}}`) as Record<string, unknown>

      for (const key of ['customTitle', 'aiTitle'] as const) {
        if (typeof entry[key] === 'string') {
          found[key] = entry[key]
        }
      }
    } catch {
      continue
    }
  }

  return found.customTitle !== '' ? found.customTitle : found.aiTitle
}

/** This load's state: the session as the hub lists it, the last action each mod's page was handed, and the server's start. */
let me = { session: '', label: '', title: '', chatFile: '', project: '' }
let acks = new Map<string, number>()
let starting: Promise<boolean> | null = null
let failedAt = 0

const isCurrent = (health: Answer): boolean => health !== null && Number(health.api) >= SERVER_API && health.staticOk !== false

/** What the session's own hooks use of the server, set while `$` is built: the closures there hold the engine's nouns. */
let own: { ensure: () => Promise<boolean>; announce: () => Promise<void>; activity: () => Promise<void> } | null = null

export const register: Register = (on, options) => {
  const hub = addressesOf(options)
  me = { session: '', label: '', title: '', chatFile: '', project: '' }
  acks = new Map()
  starting = null
  failedAt = 0
  own = null

  on('engine.create', async (_, e, next) => {
    const built = await next(e)

    const request = async (method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<Answer> => {
      try {
        const response = await built.http.fetch(`${hub.server}${path}`, body === undefined ? { method } : { method, headers: JSON_HEADERS, body: JSON.stringify(body) })

        return response.ok ? (JSON.parse(response.text) as Record<string, unknown>) : null
      } catch {
        return null
      }
    }

    const configDir = async (): Promise<string> => (await built.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await built.env.get('HOME')) ?? ''}/.claude`

    /** Starts the server's container, replacing one that is older or lost its files; resolves whether the server answers after it. */
    const start = async (): Promise<boolean> => {
      try {
        const data = `${await configDir()}/mods-data/webhub`
        const user = `${(await built.process.run(['id', '-u'])).stdout.trim()}:${(await built.process.run(['id', '-g'])).stdout.trim()}`
        await built.process.run(['mkdir', '-p', `${data}/pages`])
        await built.process.run(['docker', 'rm', '-f', CONTAINER])
        const ran = await built.process.run(
          ['docker', 'run', '-d', '--name', CONTAINER, '--restart', 'unless-stopped', '--user', user, '-p', `127.0.0.1:${hub.port}:7777`, '-v', `${built.plugin.root}/server:/app:ro`, '-v', `${data}:/data`, IMAGE, 'node', '/app/server.mjs'],
          { timeoutMs: 180_000 },
        )

        if (ran.exitCode !== 0) {
          built.ui.toast(`webhub: ${ran.stderr.trim().split('\n').at(-1) ?? 'docker run failed'}`, { timeoutMs: 8000 })

          return false
        }

        for (let attempt = 0; attempt < 20; attempt += 1) {
          if (isCurrent(await request('GET', '/api/health'))) {
            return true
          }

          await built.clock.sleep(250)
        }

        return false
      } catch {
        return false
      }
    }

    /** True once the server answers; starts it when it does not, one start at a time and not again right after a failed one. */
    const ensure = async (): Promise<boolean> => {
      if (isCurrent(await request('GET', '/api/health'))) {
        return true
      }

      if (starting === null) {
        if (Date.now() - failedAt < RETRY_START_MS) {
          return false
        }

        starting = start().then(isUp => {
          failedAt = isUp ? 0 : Date.now()
          starting = null

          return isUp
        })
      }

      return starting
    }

    /** The session as the hub lists it: its id, the last two folders of where it runs, its project's root and its name in the app. */
    const identify = async (): Promise<typeof me> => {
      if (me.session === '') {
        const session = await built.session.id()
        const cwd = await built.session.cwd()
        const label = cwd.split('/').filter(part => part !== '').slice(-2).join('/')
        me = { ...me, session, label, project: cwd }

        try {
          const root = await built.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel'])
          me = { ...me, project: root.exitCode === 0 && root.stdout.trim().startsWith('/') ? root.stdout.trim() : cwd }
        } catch {
          me = { ...me, project: cwd }
        }
      }

      try {
        if (me.chatFile === '') {
          const found = await built.process.run(['find', `${await configDir()}/projects`, '-maxdepth', '2', '-name', `${me.session}.jsonl`])
          me = { ...me, chatFile: found.stdout.split('\n')[0]?.trim() ?? '' }
        }

        if (me.chatFile !== '') {
          const named = await built.process.run(['grep', '-o', '-E', '"(customTitle|aiTitle)":"([^"\\\\]|\\\\.)*"', me.chatFile])
          const title = titleOf(named.stdout)
          me = { ...me, title: title === '' ? me.title : title }
        }
      } catch {
        return me
      }

      return me
    }

    /** Which page of `mod` a call means, as the server's requests name it: the session's own, or its project's. */
    const placeOf = (who: typeof me, mod: string, scope: WebhubScope | undefined): Record<string, string> =>
      scope === 'project' ? { mod, session: who.session, scope, project: who.project } : { mod, session: who.session }
    const queryOf = (place: Record<string, string>): string => Object.entries(place).map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&')

    const webhub: Webhub = {
      page: async ({ mod, scope, title, html, icon }) => {
        const isUp = await ensure()
        const who = await identify()
        const answer = isUp ? await request('POST', '/api/page', { ...placeOf(who, mod, scope), title, html, icon: icon ?? '', label: who.label, sessionTitle: who.title }) : null

        return { isUp: answer !== null, url: answer === null ? hub.publicUrl : `${hub.publicUrl}${String(answer.path)}` }
      },
      push: async ({ mod, scope, state, badge }) => {
        const who = await identify()

        return { isUp: (await request('POST', '/api/state', badge === undefined ? { ...placeOf(who, mod, scope), state } : { ...placeOf(who, mod, scope), state, badge })) !== null }
      },
      read: async ({ mod, scope }) => {
        const who = await identify()
        const answer = await request('GET', `/api/state?${queryOf(placeOf(who, mod, scope))}`)

        return { isUp: answer !== null, state: answer?.state ?? null }
      },
      pull: async ({ mod, scope, listener, isFirst, waitMs }) => {
        const who = await identify()
        const place = placeOf(who, mod, scope)
        const acked = `${mod}/${scope ?? 'session'}`
        const query = [
          queryOf(place),
          `listener=${encodeURIComponent(listener)}`,
          `first=${isFirst === true ? '1' : '0'}`,
          `ack=${acks.get(acked) ?? 0}`,
          `wait=${Math.max(0, Math.min(8000, waitMs ?? 5000))}`,
        ].join('&')
        const answer = await request('GET', `/api/pull?${query}`)
        const actions = Array.isArray(answer?.actions) ? (answer.actions as WebhubAction[]) : []

        if (actions.length > 0) {
          acks.set(acked, Math.max(acks.get(acked) ?? 0, ...actions.map(action => action.id)))
          await request('POST', '/api/ack', { ...place, ack: acks.get(acked) ?? 0 })
        }

        return { isUp: answer !== null, isStale: answer?.stale === true, isRegistered: answer?.registered !== false, actions }
      },
    }

    /** Tells the hub the session's name again: the app names a chat after its first turns, and the person may rename it. */
    const announce = async (): Promise<void> => {
      const who = await identify()
      await request('POST', '/api/session', { session: who.session, label: who.label, sessionTitle: who.title })
    }

    /** Tells the hub the person wrote in this session: a project page's presses go to the live session written in last. */
    const activity = async (): Promise<void> => {
      const who = await identify()
      await request('POST', '/api/activity', { session: who.session })
    }

    own = { ensure, announce, activity }

    return { ...built, webhub }
  })

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: COMMAND, description: 'Show the address of the hub with the pages of your mods' })

    if ((await own?.ensure()) === true) {
      await own?.announce()
    }

    $.clock.every(TITLE_EVERY_MS, () => void own?.announce().catch(() => undefined))

    return result
  })

  on('prompt.submit', async (_, e, next) => {
    if (e.isMeta !== true && e.command === undefined) {
      void own?.activity().catch(() => undefined)
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async () => {
    const isUp = (await own?.ensure()) === true

    return { text: isUp ? `Claude Hub: ${hub.publicUrl}` : `Claude Hub is not running (is docker available?). Its address would be ${hub.publicUrl}` }
  })
}
