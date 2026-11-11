import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Raised when the mod must replace a running server: the mod restarts a container whose number is lower than its own. */
const API = 4
const PORT = Number(process.env.PORT ?? 7777)
const DATA = process.env.WEBHUB_DATA ?? '/data'
const STATIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'static')
const PULL_WAIT_MS = 8_000
const ONLINE_MS = 12_000
const KEEP_MS = 30 * 24 * 60 * 60 * 1000

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }

/**
 * key "mod/place" -> page. A page's place is its session's id, or for a page of a whole project the project's key
 * (`prj-` and a hash of its root): every session of that project listens to it and the person's presses go to one.
 */
const pages = new Map()
/** session id -> { title, label, seenAt, activeAt } */
const sessions = new Map()
const indexClients = new Set()
let actionNo = Date.now()
let lastIndex = ''

const keyOf = (mod, place) => `${mod}/${place}`
const fileOf = page => path.join(DATA, 'pages', `${encodeURIComponent(page.mod)}__${encodeURIComponent(page.session)}.json`)
const isName = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(value)
const projectKeyOf = root => `prj-${crypto.createHash('sha1').update(root).digest('hex').slice(0, 12)}`
const labelOf = root => root.split('/').filter(part => part !== '').slice(-2).join('/')

const blank = (mod, place) => ({
  mod, session: place, scope: 'session', root: '', label: '', title: mod, icon: '', html: '', state: null, badge: 0, actions: [], updatedAt: Date.now(),
  listeners: new Map(), clients: new Set(), lastSessions: '',
})

const pageOf = (mod, place) => {
  if (!isName(mod) || !isName(place)) {
    throw new Error('bad mod or session name')
  }

  const key = keyOf(mod, place)

  if (!pages.has(key)) {
    pages.set(key, blank(mod, place))
  }

  return pages.get(key)
}

/** The page a mod's request names: its session's own, or with `scope: 'project'` the one of the project at `project` (an absolute path). */
const placedOf = ({ mod, session, scope, project }) => {
  if (scope !== 'project') {
    return pageOf(mod, session)
  }

  if (typeof project !== 'string' || !project.startsWith('/')) {
    throw new Error('a project page needs the project\'s root')
  }

  const page = pageOf(mod, projectKeyOf(project))
  Object.assign(page, { scope: 'project', root: project, label: labelOf(project) })

  return page
}

const paramsOf = url => Object.fromEntries(['mod', 'session', 'scope', 'project'].map(name => [name, url.searchParams.get(name) ?? undefined]))

const sessionOf = id => {
  if (!sessions.has(id)) {
    sessions.set(id, { title: '', label: '', seenAt: 0, activeAt: 0 })
  }

  return sessions.get(id)
}

const save = page => {
  try {
    const { mod, session, scope, root, label, title, icon, html, state, badge, actions, updatedAt } = page
    const known = sessionOf(session)
    const file = fileOf(page)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ mod, session, scope, root, label, title, icon, html, state, badge, actions, updatedAt, sessionTitle: known.title, sessionLabel: known.label }))
    fs.renameSync(`${file}.tmp`, file)
  } catch (error) {
    console.error(`not saved: ${error.message}`)
  }
}

const forget = page => {
  pages.delete(keyOf(page.mod, page.session))
  page.clients.forEach(res => res.end())
  page.listeners.forEach(listening => listening.waiter?.())

  try {
    fs.rmSync(fileOf(page), { force: true })
  } catch (error) {
    console.error(`not removed: ${error.message}`)
  }
}

const load = () => {
  let names = []

  try {
    names = fs.readdirSync(path.join(DATA, 'pages')).filter(name => name.endsWith('.json'))
  } catch {
    return
  }

  for (const name of names) {
    try {
      const file = path.join(DATA, 'pages', name)
      const held = JSON.parse(fs.readFileSync(file, 'utf8'))

      if (Date.now() - (held.updatedAt ?? 0) > KEEP_MS) {
        fs.rmSync(file, { force: true })
        continue
      }

      const page = Object.assign(pageOf(held.mod, held.session), {
        scope: held.scope === 'project' ? 'project' : 'session', root: held.root ?? '', label: held.label ?? '',
        title: held.title, icon: held.icon ?? '', html: held.html ?? '', state: held.state ?? null, badge: held.badge ?? 0, updatedAt: held.updatedAt ?? 0,
        /** A page saved by the server before API 4 marked a handed action `isHanded`: handed to its own session. */
        actions: (held.actions ?? []).map(action => (action.isHanded === true && action.handedTo === undefined ? { ...action, handedTo: held.session } : action)),
      })

      if (page.scope === 'session') {
        const known = sessionOf(page.session)
        known.title ||= held.sessionTitle ?? ''
        known.label ||= held.sessionLabel ?? ''
      }
    } catch (error) {
      console.error(`skipped ${name}: ${error.message}`)
    }
  }
}

const isLive = listening => listening !== undefined && (listening.waiter !== null || Date.now() - listening.seenAt < ONLINE_MS)
const liveOf = page => [...page.listeners].filter(([, listening]) => isLive(listening)).map(([session]) => session)
const isOnline = page => liveOf(page).length > 0

/** The live session a press with no address goes to: the one the person wrote in last, else the one that joined last. */
const activeOf = page => {
  const live = liveOf(page)
  live.sort((a, b) => sessionOf(b).activeAt - sessionOf(a).activeAt || page.listeners.get(b).since - page.listeners.get(a).since)

  return live[0] ?? null
}

/** Whether `session`'s pull gets the action: the session it was handed or sent to; one for whoever is active once that session is gone. */
const isFor = (page, action, session) => {
  const owner = action.handedTo ?? (action.to === undefined || action.to === 'active' ? null : action.to)

  if (owner === session) {
    return true
  }

  if (owner !== null && (action.via !== 'active' || isLive(page.listeners.get(owner)))) {
    return false
  }

  return activeOf(page) === session
}

/** The sessions listening to a project page, as its page shows them. */
const sessionsOf = page => {
  const active = activeOf(page)

  return [...page.listeners.keys()].map(id => {
    const known = sessionOf(id)

    return { id, title: known.title, label: known.label, isLive: isLive(page.listeners.get(id)), isActive: id === active, activeAt: known.activeAt }
  }).sort((a, b) => Number(b.isLive) - Number(a.isLive) || b.activeAt - a.activeAt)
}

/** Every session with its pages, and every project with its: projects, then live sessions, then the most recently used. */
const summary = () => {
  const byPlace = new Map()

  for (const page of pages.values()) {
    if (page.html === '') {
      continue
    }

    const isProject = page.scope === 'project'
    const known = sessionOf(page.session)
    const entry = byPlace.get(page.session) ?? {
      id: page.session, kind: page.scope, title: isProject ? page.label : known.title, label: isProject ? page.root : known.label, online: false, updatedAt: 0, pages: [], sessions: [],
    }
    const online = isOnline(page)
    entry.pages.push({ mod: page.mod, title: page.title, icon: page.icon, badge: page.badge, online, queued: page.actions.length, updatedAt: page.updatedAt })
    entry.online ||= online
    entry.updatedAt = Math.max(entry.updatedAt, page.updatedAt)

    if (isProject) {
      const seen = new Set(entry.sessions.map(one => one.id))
      entry.sessions.push(...sessionsOf(page).filter(one => one.isLive && !seen.has(one.id)).map(({ id, title, label, isActive }) => ({ id, title, label, isActive })))
    }

    byPlace.set(page.session, entry)
  }

  return [...byPlace.values()]
    .map(entry => ({ ...entry, pages: entry.pages.sort((a, b) => a.mod.localeCompare(b.mod)) }))
    .sort((a, b) => Number(b.kind === 'project') - Number(a.kind === 'project') || Number(b.online) - Number(a.online) || b.updatedAt - a.updatedAt)
}

const sse = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
const broadcast = (page, event, data) => page.clients.forEach(res => sse(res, event, data))

const broadcastIndex = (isForced = false) => {
  const next = JSON.stringify(summary())

  if (isForced || next !== lastIndex) {
    lastIndex = next
    indexClients.forEach(res => res.write(`event: sessions\ndata: ${next}\n\n`))
  }
}

/** Tells a page's tabs which sessions listen to it and which one a press goes to, when that changed. */
const broadcastSessions = page => {
  const next = JSON.stringify(sessionsOf(page))

  if (next !== page.lastSessions) {
    page.lastSessions = next
    page.clients.forEach(res => res.write(`event: sessions\ndata: ${next}\n\n`))
  }
}

const metaOf = page => {
  const known = sessionOf(page.session)

  return page.scope === 'project'
    ? { title: page.title, scope: 'project', sessionTitle: page.label, label: page.root }
    : { title: page.title, scope: 'session', sessionTitle: known.title, label: known.label }
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

const readBody = req =>
  new Promise((resolve, reject) => {
    let text = ''
    req.on('data', chunk => {
      text += chunk

      if (text.length > 4_000_000) {
        reject(new Error('body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(text === '' ? {} : JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })

const openStream = (req, res, clients) => {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' })
  res.write('retry: 1000\n\n')
  clients.add(res)
  req.on('close', () => clients.delete(res))
}

const serveStatic = (res, name) => {
  const file = path.join(STATIC, path.normalize(name).replace(/^(\.\.[/\\])+/, ''))

  if (!file.startsWith(STATIC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return json(res, 404, { error: 'not found' })
  }

  res.writeHead(200, { 'content-type': `${TYPES[path.extname(file)] ?? 'application/octet-stream'}; charset=utf-8`, 'cache-control': 'no-store' })

  return res.end(fs.readFileSync(file))
}

/** Notes what a mod's request says of its session; true when the name shown for it changed. */
const touchSession = body => {
  const known = sessionOf(body.session)
  const before = `${known.title}|${known.label}`
  known.title = typeof body.sessionTitle === 'string' ? body.sessionTitle : known.title
  known.label = typeof body.label === 'string' ? body.label : known.label
  known.seenAt = Date.now()

  return before !== `${known.title}|${known.label}`
}

/** Drops the actions the mod has received and tells the page they were delivered. */
const settle = (page, isDone) => {
  const done = page.actions.filter(isDone)

  if (done.length > 0) {
    page.actions = page.actions.filter(action => !done.includes(action))
    broadcast(page, 'delivered', done.map(action => action.id))
    save(page)
    broadcastIndex()
  }
}

/** Lets the pulls waiting for a page's presses look again: the one of `session` only, when given. */
const wake = (page, session = null) => {
  page.listeners.forEach((listening, id) => {
    if (session === null || id === session) {
      listening.waiter?.()
    }
  })
}

/**
 * The mod's long-poll, one per session and page. `ack` is the last action the session's mod has handled: those are dropped
 * and the page is told they were delivered; what is left is handed over again, so an answer lost on a broken connection is
 * not lost with it. A newer load of the mod in the same session (`first=1`) takes the page over from the one before.
 */
const pull = async (req, res, url) => {
  const page = placedOf(paramsOf(url))
  const session = url.searchParams.get('session')
  const listener = url.searchParams.get('listener')
  const isFirst = url.searchParams.get('first') === '1'
  const ack = Number(url.searchParams.get('ack') ?? 0) || 0
  const waitMs = Math.min(PULL_WAIT_MS, Number(url.searchParams.get('wait') ?? PULL_WAIT_MS) || 0)
  const before = page.listeners.get(session)

  if (!isName(session)) {
    throw new Error('bad session name')
  }

  if (before !== undefined && before.listener !== listener && !isFirst) {
    return json(res, 200, { actions: [], stale: true, registered: page.html !== '' })
  }

  /** A fresh load of the mod knows no ack: what the load before it was already handed is taken as handled. */
  settle(page, action => action.handedTo === session && (action.id <= ack || isFirst))

  const wasOnline = isOnline(page)
  const own = before !== undefined && before.listener === listener ? before : { listener, seenAt: 0, waiter: null, since: Date.now() }
  page.listeners.set(session, own)
  own.seenAt = Date.now()
  before?.waiter?.()
  broadcastSessions(page)

  if (!page.actions.some(action => isFor(page, action, session)) && waitMs > 0) {
    let mine = null

    await new Promise(resolve => {
      const timer = setTimeout(resolve, waitMs)
      mine = () => {
        clearTimeout(timer)
        resolve()
      }
      own.waiter = mine
      res.on('close', mine)

      if (!wasOnline) {
        broadcast(page, 'online', { hub: true, session: true })
        broadcastIndex()
      }
    })

    if (own.waiter === mine) {
      own.waiter = null
    }

    own.seenAt = Date.now()
  }

  if (res.destroyed || !res.writable) {
    return undefined
  }

  if (page.listeners.get(session) !== own) {
    return json(res, 200, { actions: [], stale: true, registered: page.html !== '' })
  }

  const handed = page.actions.filter(action => isFor(page, action, session))
  json(res, 200, { actions: handed.map(({ id, at, data }) => ({ id, at, data })), registered: page.html !== '' })
  handed.forEach(action => {
    action.handedTo = session
  })

  return undefined
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://hub')
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)

  try {
    if (req.method === 'GET') {
      if (url.pathname === '/') {
        return serveStatic(res, 'index.html')
      }

      if (parts.length === 1 && path.extname(parts[0]) !== '') {
        return serveStatic(res, parts[0])
      }

      if (url.pathname === '/api/health') {
        return json(res, 200, { ok: true, api: API, pages: pages.size, staticOk: fs.existsSync(path.join(STATIC, 'index.html')) })
      }

      if (url.pathname === '/sse/index') {
        openStream(req, res, indexClients)

        return sse(res, 'sessions', summary())
      }

      if (parts[0] === 'sse' && parts.length === 3) {
        const page = pageOf(parts[1], parts[2])
        openStream(req, res, page.clients)
        sse(res, 'online', { hub: true, session: isOnline(page) })
        sse(res, 'meta', metaOf(page))
        sse(res, 'sessions', sessionsOf(page))

        return sse(res, 'state', page.state)
      }

      if (parts[0] === 'p' && parts.length === 3) {
        const page = pages.get(keyOf(parts[1], parts[2]))

        if (page === undefined || page.html === '') {
          return serveStatic(res, 'gone.html')
        }

        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })

        return res.end(page.html)
      }

      if (url.pathname === '/api/state') {
        const params = paramsOf(url)
        const place = params.scope === 'project' && typeof params.project === 'string' ? projectKeyOf(params.project) : params.session
        const page = pages.get(keyOf(params.mod, place))

        return json(res, 200, { state: page?.state ?? null })
      }

      if (url.pathname === '/api/pull') {
        return await pull(req, res, url)
      }
    }

    if (req.method === 'POST') {
      const body = await readBody(req)

      if (parts[0] === 'act' && parts.length === 3) {
        const page = pageOf(parts[1], parts[2])
        const asked = url.searchParams.get('to') ?? 'active'

        if (asked !== 'active' && !isName(asked)) {
          throw new Error('bad address')
        }

        const to = asked === 'active' ? activeOf(page) : asked
        const action = { id: ++actionNo, at: Date.now(), data: body, to: to ?? 'active', via: asked === 'active' ? 'active' : 'direct' }
        page.actions.push(action)
        save(page)
        wake(page, to)
        broadcastIndex()

        return json(res, 200, { id: action.id, online: isOnline(page), to })
      }

      if (url.pathname === '/api/page') {
        const page = placedOf(body)
        Object.assign(page, { title: body.title ?? page.title, icon: body.icon ?? page.icon, html: body.html ?? page.html, updatedAt: Date.now() })
        touchSession(body)
        save(page)
        broadcast(page, 'reload', {})
        broadcastIndex()

        return json(res, 200, { path: `/#/${encodeURIComponent(page.session)}/${encodeURIComponent(page.mod)}` })
      }

      if (url.pathname === '/api/state') {
        const page = placedOf(body)
        Object.assign(page, { state: body.state ?? null, badge: Number(body.badge ?? page.badge) || 0, updatedAt: Date.now() })
        save(page)
        broadcast(page, 'state', page.state)
        broadcastIndex()

        return json(res, 200, { clients: page.clients.size })
      }

      if (url.pathname === '/api/ack') {
        settle(placedOf(body), action => action.handedTo === body.session && action.id <= (Number(body.ack) || 0))

        return json(res, 200, { ok: true })
      }

      if (url.pathname === '/api/session') {
        if (touchSession(body)) {
          for (const page of pages.values()) {
            if (page.session === body.session) {
              save(page)
              broadcast(page, 'meta', metaOf(page))
            }

            if (page.listeners.has(body.session)) {
              broadcastSessions(page)
            }
          }

          broadcastIndex()
        }

        return json(res, 200, { ok: true })
      }

      if (url.pathname === '/api/activity') {
        if (!isName(body.session)) {
          throw new Error('bad session name')
        }

        sessionOf(body.session).activeAt = Date.now()

        for (const page of pages.values()) {
          if (page.listeners.has(body.session)) {
            broadcastSessions(page)
          }
        }

        broadcastIndex()

        return json(res, 200, { ok: true })
      }

      if (url.pathname === '/api/remove') {
        const gone = [...pages.values()].filter(page => page.session === body.session && (body.mod === undefined || page.mod === body.mod) && !isOnline(page))
        gone.forEach(forget)
        broadcastIndex()

        return json(res, 200, { removed: gone.length })
      }
    }

    return json(res, 404, { error: 'not found' })
  } catch (error) {
    return json(res, 400, { error: String(error?.message ?? error) })
  }
})

setInterval(() => {
  for (const page of pages.values()) {
    broadcast(page, 'online', { hub: true, session: isOnline(page) })
    broadcastSessions(page)
  }

  indexClients.forEach(res => res.write(': keep\n\n'))
  broadcastIndex()
}, 5_000)

load()
server.listen(PORT, '0.0.0.0', () => console.log(`webhub api ${API} listening on ${PORT}, ${pages.size} pages restored`))
