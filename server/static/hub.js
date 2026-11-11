/*
 * The hub's client for a mod's page: <script src="/hub.js"></script> gives the page `window.hub`.
 *
 *   hub.onState(fn)      the state the mod pushed, at load and at every change
 *   hub.send(action, { to }?)  hands the mod an action (any JSON); resolves { id, online, to }. `to`: a session's id,
 *                        or 'active' (the default): the live session the person wrote in last
 *   hub.onDelivered(fn)  the ids of the actions the mod has handled
 *   hub.onOnline(fn)     { hub, session }: whether the hub answers and a session of the mod listens
 *   hub.onSessions(fn)   [{ id, title, label, isLive, isActive }]: the sessions listening to the page, `isActive` the one
 *                        a press with no `to` goes to (a project page has several; a session's page its own)
 *   hub.onMeta(fn)       { title, scope, sessionTitle, label }: the names the hub shows for the page and its session or project
 *   hub.lang, hub.theme  the language and theme chosen in the hub; hub.onLang(fn), hub.onTheme(fn) follow them
 *   hub.mod, hub.session the page's own address
 */
(() => {
  const [, , mod, session] = location.pathname.split('/').map(part => decodeURIComponent(part))
  const stored = (key, fallback) => {
    try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
  }
  const listeners = { state: [], delivered: [], online: [], meta: [], sessions: [], lang: [], theme: [] }
  const last = {}
  const emit = (name, data) => {
    last[name] = data
    listeners[name].forEach(fn => fn(data))
  }
  /** A listener added after the event has come is told the latest at once. */
  const on = name => fn => {
    listeners[name].push(fn)
    if (name in last) fn(last[name])
  }
  const applyTheme = theme => { document.documentElement.dataset.theme = theme }

  const hub = {
    mod,
    session,
    lang: stored('webhub.lang', (navigator.language ?? 'en').slice(0, 2)),
    theme: stored('webhub.theme', 'auto'),
    onState: on('state'),
    onDelivered: on('delivered'),
    onOnline: on('online'),
    onMeta: on('meta'),
    onLang: on('lang'),
    onTheme: on('theme'),
    onSessions: on('sessions'),
    send: (action, options) =>
      fetch('/act/' + encodeURIComponent(mod) + '/' + encodeURIComponent(session) + (options?.to ? '?to=' + encodeURIComponent(options.to) : ''), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action),
      }).then(res => res.json()),
  }
  applyTheme(hub.theme)

  window.addEventListener('storage', event => {
    if (event.key === 'webhub.lang' && event.newValue !== null) { hub.lang = event.newValue; emit('lang', hub.lang) }
    if (event.key === 'webhub.theme' && event.newValue !== null) { hub.theme = event.newValue; applyTheme(hub.theme); emit('theme', hub.theme) }
  })

  const source = new EventSource('/sse/' + encodeURIComponent(mod) + '/' + encodeURIComponent(session))
  for (const name of ['state', 'delivered', 'online', 'meta', 'sessions']) {
    source.addEventListener(name, event => emit(name, JSON.parse(event.data)))
  }
  source.addEventListener('reload', () => location.reload())
  source.onerror = () => emit('online', { hub: false, session: false })
  window.hub = hub
})()
