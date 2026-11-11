import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { addressesOf, SERVER_API, titleOf } from '../hooks/register'

type On = Parameters<TestBody>[1]

const SESSION = 'aaaaaaaa-1111-2222-3333-444444444444'
const CHAT = `/home/u/.claude/projects/-w-shop-api/${SESSION}.jsonl`

type World = { requests: Array<{ method: string; path: string; body: Record<string, unknown> | null }>; runs: string[][]; isServerUp: boolean; api: number; titles: string; actions: Array<{ id: number; at: number; data: unknown }>; upgradesOnRun: boolean }

/** The server, docker and the session's chat file, held in memory. */
const world = (on: On, given: Partial<World> = {}): World => {
  const held: World = { requests: [], runs: [], isServerUp: true, api: SERVER_API, titles: '"customTitle":"Checkout redesign"', actions: [], upgradesOnRun: false, ...given }
  on('session.id', () => ({ value: SESSION }))
  on('session.cwd', () => ({ value: '/w/shop/api' }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('clock.sleep', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    held.runs.push([...e.argv])
    held.isServerUp ||= e.argv[0] === 'docker' && e.argv[1] === 'run'
    held.api = held.upgradesOnRun && e.argv[1] === 'run' ? SERVER_API : held.api
    const stdout = e.argv[0] === 'find' ? `${CHAT}\n` : e.argv[0] === 'grep' ? held.titles : e.argv[0] === 'id' ? '1000\n' : e.argv[0] === 'git' ? '/w/shop\n' : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  on('http.fetch', (_, e) => {
    const url = new URL(e.url)
    const body = typeof e.init?.body === 'string' ? (JSON.parse(e.init.body) as Record<string, unknown>) : null
    held.requests.push({ method: e.init?.method ?? 'GET', path: `${url.pathname}${url.search}`, body })

    if (!held.isServerUp) {
      return { value: { status: 503, ok: false, headers: {}, text: '' } }
    }

    const answer =
      url.pathname === '/api/health' ? { ok: true, api: held.api, staticOk: true }
      : url.pathname === '/api/page' ? { path: `/#/${SESSION}/${String(body?.mod)}` }
      : url.pathname === '/api/pull' ? { actions: held.actions.filter(action => action.id > Number(url.searchParams.get('ack'))), registered: true }
      : url.pathname === '/api/state' && body === null ? { state: { n: 1 } }
      : { ok: true }

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(answer) } }
  })

  return held
}

const START = { cwd: '/w/shop/api', surface: 'desktop', isInteractive: true } as const

/** What a session's start needs beneath the plugin; the test's own `session.start` hook is where it calls `$.webhub`. */
const session = (on: On): void => {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('clock.every', () => ({ value: undefined }) as never)
}

test('the addresses follow the options, and a bad port falls back to 7777', async () => {
  expect(addressesOf({})).toEqual({ server: 'http://127.0.0.1:7777', publicUrl: 'http://localhost:7777', port: '7777' })
  expect(addressesOf({ port: '8123', publicUrl: 'https://hub.example.com/' })).toEqual({ server: 'http://127.0.0.1:8123', publicUrl: 'https://hub.example.com', port: '8123' })
  expect(addressesOf({ port: 'rm -rf' }).port).toBe('7777')
})

test('the name of a session is the one the person gave it, else the generated one', async () => {
  expect(titleOf('"aiTitle":"Fix the cart"\n"customTitle":"Old"\n"customTitle":"Checkout \\"v2\\""\n"aiTitle":"Later guess"')).toBe('Checkout "v2"')
  expect(titleOf('"aiTitle":"Fix the cart"\nbroken')).toBe('Fix the cart')
  expect(titleOf('')).toBe('')
})

test('a session tells the hub its name and folder at its start', async (engine, on) => {
  const held = world(on)
  session(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await engine.session.start(START)

  expect(held.requests.find(request => request.path === '/api/session')?.body).toEqual({ session: SESSION, label: 'shop/api', sessionTitle: 'Checkout redesign' })
  expect(held.runs.some(run => run[0] === 'docker')).toBe(false)
})

test('a server that does not answer is started in docker, bound to localhost, with the plugin files and the data folder', async (engine, on) => {
  const held = world(on, { isServerUp: false })
  session(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await engine.session.start(START)
  const run = held.runs.find(argv => argv[0] === 'docker' && argv[1] === 'run') ?? []

  expect(run.join(' ')).toMatch(/--name claude-webhub --restart unless-stopped --user 1000:1000 -p 127\.0\.0\.1:7777:7777 -v \S+\/server:\/app:ro -v \/home\/u\/\.claude\/mods-data\/webhub:\/data node:20-alpine node \/app\/server\.mjs$/)
  expect(held.runs.findIndex(argv => argv[1] === 'rm')).toBeLessThan(held.runs.findIndex(argv => argv[1] === 'run'))
  expect(held.requests.some(request => request.path === '/api/session')).toBe(true)
})

test('an older server is replaced, a current one is left alone', async (engine, on) => {
  const held = world(on, { api: SERVER_API - 1, upgradesOnRun: true })
  session(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await engine.session.start(START)

  expect(held.runs.filter(argv => argv[0] === 'docker' && argv[1] === 'run').length).toBe(1)
  expect((await engine.command.run({ command: 'hub', args: '' } as never)).text).toBe('Claude Hub: http://localhost:7777')
  expect(held.runs.filter(argv => argv[0] === 'docker' && argv[1] === 'run').length).toBe(1)
})

/** A mod of the project's page: it puts the page and takes the presses as a mod beside webhub does. */
const PROJECT_MOD = {
  name: 'tests-runner',
  register: ((on: On) => {
    on('session.start', async ($, e, next) => {
      const result = await next(e)
      await $.webhub.page({ mod: 'tests', scope: 'project', title: 'Tests', html: '<p>t</p>' })
      await $.webhub.pull({ mod: 'tests', scope: 'project', listener: 'L', isFirst: true, waitMs: 0 })

      return result
    })
  }) as never,
}

test('a project page is put under the git root of the session, and its presses are pulled and acknowledged there', { plugins: [PROJECT_MOD] }, async (engine, on) => {
  const held = world(on, { actions: [{ id: 7, at: 0, data: { type: 'run' } }] })
  session(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await engine.session.start(START)
  const page = held.requests.find(request => request.path === '/api/page')
  const pulled = held.requests.find(request => request.path.startsWith('/api/pull'))

  expect(page?.body).toMatchObject({ mod: 'tests', session: SESSION, scope: 'project', project: '/w/shop', title: 'Tests' })
  expect(pulled?.path).toMatch(/^\/api\/pull\?mod=tests&session=aaaa[^&]+&scope=project&project=%2Fw%2Fshop&listener=L&first=1&ack=0&wait=0$/)
  expect(held.requests.find(request => request.path === '/api/ack')?.body).toEqual({ mod: 'tests', session: SESSION, scope: 'project', project: '/w/shop', ack: 7 })
})

test('what the person writes marks the session as the one a project page talks to; a hidden prompt or a command does not', async (engine, on) => {
  const held = world(on)
  session(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await engine.session.start(START)
  await engine.prompt.submit({ text: 'run the tests' } as never)
  await engine.prompt.submit({ text: 'a reminder', isMeta: true } as never)
  await Promise.resolve()

  expect(held.requests.filter(request => request.path === '/api/activity').map(request => request.body)).toEqual([{ session: SESSION }])
})
