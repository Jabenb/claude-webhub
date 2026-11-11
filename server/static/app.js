(() => {
  const TEXTS = {
    en: {
      search: 'Find a session or a mod…', live: 'Live', ended: 'Ended', heroTitle: 'Your mods', heroSub: 'Every page your Claude mods opened, by session. It updates live.',
      statSessions: 'live sessions', statPages: 'pages', statWaiting: 'need you', emptyTitle: 'No pages yet',
      emptyText: 'A mod that uses the hub shows up here as soon as its session starts.', nothingFound: 'Nothing matches the search.',
      online: 'session connected', offline: 'session ended', remove: 'Remove', removeConfirm: 'Remove the pages of this ended session?', untitled: 'Untitled session',
      open: 'Open in a new tab', hubDown: 'No connection to the hub', hubUp: 'Connected to the hub', themeAuto: 'Theme: system', themeLight: 'Theme: light', themeDark: 'Theme: dark',
      queued: 'waiting for delivery', menu: 'Menu', projects: 'Projects', goesTo: 'presses go to', noListener: 'no live session', projectEnded: 'no session listens', sessionsLive: 'live sessions',
    },
    ru: {
      search: 'Найти сессию или мод…', live: 'Активные', ended: 'Завершённые', heroTitle: 'Твои моды', heroSub: 'Все страницы, которые открыли моды Claude, по сессиям. Обновляется вживую.',
      statSessions: 'активных сессий', statPages: 'страниц', statWaiting: 'ждут тебя', emptyTitle: 'Страниц пока нет',
      emptyText: 'Мод, который работает через хаб, появится здесь, как только стартует его сессия.', nothingFound: 'По запросу ничего не найдено.',
      online: 'сессия на связи', offline: 'сессия завершена', remove: 'Убрать', removeConfirm: 'Убрать страницы этой завершённой сессии?', untitled: 'Сессия без названия',
      open: 'Открыть в новой вкладке', hubDown: 'Нет связи с хабом', hubUp: 'Хаб на связи', themeAuto: 'Тема: как в системе', themeLight: 'Тема: светлая', themeDark: 'Тема: тёмная',
      queued: 'ждёт доставки', menu: 'Меню', projects: 'Проекты', goesTo: 'нажатия идут в', noListener: 'нет живой сессии', projectEnded: 'ни одна сессия не слушает', sessionsLive: 'живых сессий',
    },
    uk: {
      search: 'Знайти сесію або мод…', live: 'Активні', ended: 'Завершені', heroTitle: 'Твої моди', heroSub: 'Усі сторінки, які відкрили моди Claude, за сесіями. Оновлюється наживо.',
      statSessions: 'активних сесій', statPages: 'сторінок', statWaiting: 'чекають на тебе', emptyTitle: 'Сторінок поки немає',
      emptyText: 'Мод, який працює через хаб, зʼявиться тут, щойно стартує його сесія.', nothingFound: 'За запитом нічого не знайдено.',
      online: 'сесія на звʼязку', offline: 'сесію завершено', remove: 'Прибрати', removeConfirm: 'Прибрати сторінки цієї завершеної сесії?', untitled: 'Сесія без назви',
      open: 'Відкрити в новій вкладці', hubDown: 'Немає звʼязку з хабом', hubUp: 'Хаб на звʼязку', themeAuto: 'Тема: як у системі', themeLight: 'Тема: світла', themeDark: 'Тема: темна',
      queued: 'чекає доставки', menu: 'Меню', projects: 'Проєкти', goesTo: 'натискання йдуть у', noListener: 'немає живої сесії', projectEnded: 'жодна сесія не слухає', sessionsLive: 'живих сесій',
    },
  }
  const LANGS = Object.keys(TEXTS)
  const THEMES = ['auto', 'light', 'dark']
  const THEME_ICON = { auto: '◐', light: '☀', dark: '☾' }
  const TINTS = ['#c8643c', '#3f7fd0', '#2f9e62', '#8a5cc7', '#c98a1b', '#c9487a', '#2a9d9d', '#6b7a3a']

  const stored = (key, fallback) => {
    try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
  }
  const store = (key, value) => {
    try { localStorage.setItem(key, value) } catch { /* private mode: the choice lasts for this tab */ }
  }
  const el = id => document.getElementById(id)
  const esc = text => String(text).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))

  let lang = stored('webhub.lang', LANGS.find(code => (navigator.language ?? 'en').toLowerCase().startsWith(code)) ?? 'en')
  let theme = stored('webhub.theme', 'auto')
  let sessions = []
  let query = ''
  let isHubUp = true
  let shown = ''
  if (!LANGS.includes(lang)) lang = 'en'
  if (!THEMES.includes(theme)) theme = 'auto'
  const t = key => TEXTS[lang][key]

  const tintOf = name => TINTS[[...name].reduce((sum, ch) => (sum * 31 + ch.codePointAt(0)) % 9973, 7) % TINTS.length]
  const avatar = (page, cls = '') => '<span class="avatar ' + cls + '" style="--tint:' + tintOf(page.mod) + '">' + esc(page.icon || page.title.trim().charAt(0).toUpperCase() || '•') + '</span>'
  const nameOf = session => session.title || session.label || t('untitled')
  const ago = at => {
    const minutes = Math.round((at - Date.now()) / 60000)
    const format = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
    return Math.abs(minutes) < 60 ? format.format(minutes, 'minute') : Math.abs(minutes) < 1440 ? format.format(Math.round(minutes / 60), 'hour') : format.format(Math.round(minutes / 1440), 'day')
  }
  const isProject = entry => entry.kind === 'project'
  const activeOf = entry => (entry.sessions ?? []).find(one => one.isActive)
  /** A project's line: where its presses go now and how many sessions listen; a session's: its folder, id and age. */
  const subOf = entry => isProject(entry)
    ? (entry.online
      ? [t('goesTo') + ' «' + nameOf(activeOf(entry) ?? {}) + '»', entry.sessions.length > 1 ? entry.sessions.length + ' ' + t('sessionsLive') : ''].filter(Boolean).join(' · ')
      : [t('noListener'), ago(entry.updatedAt)].join(' · '))
    : [entry.title ? entry.label : '', entry.id.slice(0, 8), entry.online ? '' : ago(entry.updatedAt)].filter(Boolean).join(' · ')
  const groupsOf = list => [
    [t('projects'), list.filter(isProject)],
    [t('live'), list.filter(entry => !isProject(entry) && entry.online)],
    [t('ended'), list.filter(entry => !isProject(entry) && !entry.online)],
  ]
  const hrefOf = (session, page) => '#/' + encodeURIComponent(session.id) + '/' + encodeURIComponent(page.mod)
  const route = () => {
    const [, id, mod] = location.hash.split('/').map(part => decodeURIComponent(part))
    const session = sessions.find(one => one.id === id)
    const page = session?.pages.find(one => one.mod === mod)
    return page === undefined ? null : { session, page }
  }
  const matches = (session, page) => {
    const needle = query.trim().toLowerCase()
    return needle === '' || [nameOf(session), session.label, session.id, page.mod, page.title].some(text => String(text).toLowerCase().includes(needle))
  }
  const visible = () => sessions.map(session => ({ ...session, pages: session.pages.filter(page => matches(session, page)) })).filter(session => session.pages.length > 0)

  const drawNav = list => {
    const current = route()
    const group = (label, items) => items.length === 0 ? '' :
      '<div class="group-label">' + esc(label) + '<span class="count">' + items.length + '</span></div>' + items.map(session =>
        '<div class="session"><div class="session-head"><span class="dot' + (session.online ? ' on' : '') + (isProject(session) ? ' project' : '') + '"></span>' +
        '<div class="session-text"><div class="session-title" title="' + esc(nameOf(session)) + '">' + esc(nameOf(session)) + '</div><div class="session-sub">' + esc(subOf(session)) + '</div></div>' +
        (session.online ? '' : '<button class="remove" data-remove="' + esc(session.id) + '" title="' + esc(t('remove')) + '">✕</button>') + '</div>' +
        session.pages.map(page => '<a class="page-link' + (current?.session.id === session.id && current.page.mod === page.mod ? ' active' : '') + '" href="' + hrefOf(session, page) + '">' +
          avatar(page) + '<span class="page-name">' + esc(page.title) + '</span>' + (page.badge > 0 ? '<span class="badge">' + page.badge + '</span>' : '') + '</a>').join('') + '</div>').join('')
    el('nav').innerHTML = list.length === 0
      ? '<div class="nav-empty">' + esc(sessions.length === 0 ? t('emptyText') : t('nothingFound')) + '</div>'
      : groupsOf(list).map(([label, items]) => group(label, items)).join('')
  }

  const drawHome = list => {
    const live = sessions.filter(session => !isProject(session) && session.online)
    const pages = sessions.flatMap(session => session.pages)
    const waiting = pages.reduce((sum, page) => sum + (page.badge || 0), 0)
    const card = session => '<article class="session-card' + (session.online ? '' : ' ended') + '"><div class="card-head"><span class="dot' + (session.online ? ' on' : '') + (isProject(session) ? ' project' : '') + '"></span>' +
      '<span class="card-title" title="' + esc(nameOf(session)) + '">' + esc(nameOf(session)) + '</span><span class="card-sub">' + esc(subOf(session)) + '</span>' +
      (session.online ? '' : '<button class="remove" data-remove="' + esc(session.id) + '" title="' + esc(t('remove')) + '">✕</button>') + '</div><div class="tiles">' +
      session.pages.map(page => '<a class="tile" href="' + hrefOf(session, page) + '">' + avatar(page, 'big') + '<span class="tile-text"><span class="tile-title">' + esc(page.title) + '</span>' +
        '<div class="tile-sub">' + esc(page.queued > 0 ? t('queued') + ': ' + page.queued : page.mod) + '</div></span>' + (page.badge > 0 ? '<span class="badge">' + page.badge + '</span>' : '') + '</a>').join('') +
      '</div></article>'
    const section = (label, items) => items.length === 0 ? '' : '<div class="section-label">' + esc(label) + '</div>' + items.map(card).join('')
    el('home').innerHTML = '<div class="home-inner"><button class="icon-btn burger" data-menu type="button" aria-label="' + esc(t('menu')) + '">☰</button>' +
      '<div class="hero"><div style="flex:1"><h1>' + esc(t('heroTitle')) + '</h1><p>' + esc(t('heroSub')) + '</p></div><div class="stats">' +
      '<div class="stat"><b>' + live.length + '</b><span>' + esc(t('statSessions')) + '</span></div>' +
      '<div class="stat"><b>' + pages.length + '</b><span>' + esc(t('statPages')) + '</span></div>' +
      '<div class="stat"><b>' + waiting + '</b><span>' + esc(t('statWaiting')) + '</span></div></div></div>' +
      (list.length === 0
        ? '<div class="empty"><b>' + esc(sessions.length === 0 ? t('emptyTitle') : t('nothingFound')) + '</b>' + (sessions.length === 0 ? esc(t('emptyText')) : '') + '</div>'
        : groupsOf(list).map(([label, items]) => section(label, items)).join('')) + '</div>'
  }

  const drawView = () => {
    const current = route()
    el('home').hidden = current !== null
    el('view').hidden = current === null

    if (current === null) {
      shown = ''
      el('frame').removeAttribute('src')
      return
    }

    const { session, page } = current
    const src = '/p/' + encodeURIComponent(page.mod) + '/' + encodeURIComponent(session.id)
    el('viewIcon').outerHTML = avatar(page).replace('<span class="avatar ', '<span id="viewIcon" class="avatar ')
    el('viewTitle').textContent = page.title
    el('viewSub').textContent = isProject(session) ? [session.title, subOf(session)].join(' · ') : [nameOf(session), session.title ? session.label : ''].filter(Boolean).join(' · ')
    el('viewStatus').textContent = session.online ? t('online') : isProject(session) ? t('projectEnded') : t('offline')
    el('viewStatus').className = 'pill' + (page.online ? ' on' : '')
    el('viewOpen').href = src
    el('viewOpen').title = t('open')

    if (shown !== src) {
      shown = src
      el('frame').src = src
    }
  }

  const draw = () => {
    const list = visible()
    const waiting = sessions.flatMap(session => session.pages).reduce((sum, page) => sum + (page.badge || 0), 0)
    document.documentElement.lang = lang
    document.documentElement.dataset.theme = theme
    document.title = (waiting > 0 ? '(' + waiting + ') ' : '') + 'Claude Hub'
    el('search').placeholder = t('search')
    el('conn').className = 'conn' + (isHubUp ? '' : ' off')
    el('conn').title = isHubUp ? t('hubUp') : t('hubDown')
    el('langs').innerHTML = LANGS.map(code => '<button type="button" data-lang="' + code + '" class="' + (code === lang ? 'on' : '') + '">' + code.toUpperCase() + '</button>').join('')
    el('theme').textContent = THEME_ICON[theme]
    el('theme').title = t('theme' + theme.charAt(0).toUpperCase() + theme.slice(1))
    drawNav(list)
    drawHome(list)
    drawView()
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('[data-lang], [data-remove], [data-menu], #theme, #burger, #scrim, .page-link, .tile')
    if (target === null) return
    if (target.dataset.lang !== undefined) { lang = target.dataset.lang; store('webhub.lang', lang); draw() }
    if (target.id === 'theme') { theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]; store('webhub.theme', theme); draw() }
    if (target.id === 'burger' || target.dataset.menu !== undefined) el('app').classList.add('menu')
    if (target.id === 'scrim' || target.classList.contains('page-link')) el('app').classList.remove('menu')
    if (target.dataset.remove !== undefined && confirm(t('removeConfirm'))) {
      void fetch('/api/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: target.dataset.remove }) })
    }
  })
  el('search').addEventListener('input', event => { query = event.target.value; draw() })
  window.addEventListener('hashchange', draw)

  const source = new EventSource('/sse/index')
  source.addEventListener('sessions', event => { sessions = JSON.parse(event.data); isHubUp = true; draw() })
  source.onopen = () => { isHubUp = true; draw() }
  source.onerror = () => { isHubUp = false; draw() }
  draw()
})()
