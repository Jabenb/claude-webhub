/**
 * The mod's own page, whole. The hub serves it at /p/<mod>/<session> inside its shell; /hub.js gives it `window.hub`,
 * /hub.css the hub's colours (light and dark). No `${` in here: this is a template string.
 */
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>My mod</title>
<link rel="stylesheet" href="/hub.css">
<style>
  body { margin: 0; background: var(--hub-bg); color: var(--hub-text); font: 15px/1.5 var(--hub-font); }
  main { max-width: 720px; margin: 0 auto; padding: 28px 16px 40px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
  h1 { font-size: 22px; margin: 0; }
  .status { font-size: 13px; color: var(--hub-dim); white-space: nowrap; }
  .status::before { content: '●'; margin-right: 6px; color: var(--hub-danger); }
  .status.live::before { color: var(--hub-ok); }
  ul { list-style: none; padding: 0; margin: 0 0 16px; display: grid; gap: 8px; }
  label.item { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; background: var(--hub-surface); border: 1px solid var(--hub-line); border-radius: var(--hub-radius); cursor: pointer; }
  label.item:has(input:checked) { border-color: var(--hub-accent); background: var(--hub-accent-soft); }
  .id { color: var(--hub-dim); font-variant-numeric: tabular-nums; }
  .empty { color: var(--hub-dim); padding: 28px; text-align: center; border: 1px dashed var(--hub-line); border-radius: var(--hub-radius); }
  textarea { width: 100%; box-sizing: border-box; min-height: 84px; padding: 10px 12px; border: 1px solid var(--hub-line); border-radius: var(--hub-radius); background: var(--hub-surface); color: inherit; font: inherit; resize: vertical; }
  footer { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
  button { padding: 10px 20px; border: 0; border-radius: var(--hub-radius); background: var(--hub-accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  .note { font-size: 13px; color: var(--hub-dim); }
</style>
</head>
<body>
<main>
  <header><h1 id="title"></h1><span id="status" class="status"></span></header>
  <ul id="items"></ul>
  <textarea id="text"></textarea>
  <footer><button id="send"></button><span id="note" class="note"></span></footer>
</main>
<script src="/hub.js"></script>
<script>
  const TEXTS = {
    en: { title: 'My mod', empty: 'Nothing here yet: ask Claude to put a list on this page.', placeholder: 'A comment for Claude (optional)', send: 'Send to Claude', sending: 'Sending…', delivered: 'Delivered', live: 'Session is listening', ended: 'Session is not listening', down: 'Hub is not reachable' },
    ru: { title: 'Мой мод', empty: 'Пока пусто: попроси Claude вывести сюда список.', placeholder: 'Комментарий для Claude (необязательно)', send: 'Отправить в Claude', sending: 'Отправляю…', delivered: 'Доставлено', live: 'Сессия слушает', ended: 'Сессия не слушает', down: 'Хаб недоступен' },
    uk: { title: 'Мій мод', empty: 'Поки порожньо: попроси Claude вивести сюди список.', placeholder: 'Коментар для Claude (необовʼязково)', send: 'Надіслати в Claude', sending: 'Надсилаю…', delivered: 'Доставлено', live: 'Сесія слухає', ended: 'Сесія не слухає', down: 'Хаб недоступний' },
  }
  const el = id => document.getElementById(id)
  const t = () => TEXTS[hub.lang] || TEXTS.en
  let state = { title: '', items: [] }
  let online = { hub: true, session: true }
  let sessions = []
  let picked = new Set()
  let waiting = null
  let note = ''

  const render = () => {
    const tx = t()
    document.documentElement.lang = hub.lang
    el('title').textContent = state.title || tx.title
    el('status').textContent = !online.hub ? tx.down : online.session ? tx.live : tx.ended
    el('status').classList.toggle('live', online.hub && online.session)
    el('text').placeholder = tx.placeholder
    const target = sessions.find(one => one.isActive)
    const isShared = sessions.filter(one => one.isLive).length > 1
    el('send').textContent = waiting !== null ? tx.sending : isShared && target ? tx.send + ' → «' + (target.title || target.label) + '»' : tx.send
    el('send').disabled = waiting !== null || (picked.size === 0 && el('text').value.trim() === '')
    el('note').textContent = note

    const list = el('items')
    list.replaceChildren()
    if (state.items.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'empty'
      empty.textContent = tx.empty
      list.append(empty)
    }
    for (const item of state.items) {
      const row = document.createElement('li')
      const label = document.createElement('label')
      const box = document.createElement('input')
      const id = document.createElement('span')
      const text = document.createElement('span')
      label.className = 'item'
      box.type = 'checkbox'
      box.checked = picked.has(item.id)
      box.onchange = () => { box.checked ? picked.add(item.id) : picked.delete(item.id); render() }
      id.className = 'id'
      id.textContent = item.id
      text.textContent = item.text
      label.append(box, id, text)
      row.append(label)
      list.append(row)
    }
  }

  hub.onState(next => {
    state = next || { title: '', items: [] }
    picked = new Set([...picked].filter(id => state.items.some(item => item.id === id)))
    render()
  })
  hub.onOnline(next => { online = next; render() })
  hub.onSessions(next => { sessions = next; render() })
  hub.onLang(render)
  hub.onDelivered(ids => {
    if (waiting !== null && ids.includes(waiting)) {
      waiting = null
      picked.clear()
      el('text').value = ''
      note = t().delivered
      render()
    }
  })
  el('text').oninput = () => { note = ''; render() }
  el('send').onclick = async () => {
    try {
      const sent = await hub.send({ type: 'send', picked: [...picked], text: el('text').value.trim() })
      waiting = sent.id
      note = ''
    } catch {
      note = t().down
    }
    render()
  }
  render()
</script>
</body>
</html>
`
