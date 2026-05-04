// Content script — la salsa secreta de la extensión.
// Inyecta un Shadow DOM en cualquier página con:
//  • toast efímero al recibir un DM (fade in/out, mouse pass-through)
//  • panel deslizable que es un iframe al messenger PWA (toda la lógica vive ahí)
//  • FAB flotante para abrir el panel a demanda

(function () {
  if (window.__cc_messenger_injected) return
  window.__cc_messenger_injected = true
  if (location.protocol === 'chrome-extension:' || location.protocol === 'chrome:') return
  if (location.host === 'messenger.closer.click') return  // no auto-inyectar dentro del propio PWA

  const PWA_URL = 'https://messenger.closer.click/?embed=overlay'

  const host = document.createElement('div')
  host.id = 'cc-messenger-host'
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;'
  const shadow = host.attachShadow({ mode: 'closed' })

  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = chrome.runtime.getURL('overlay.css')
  shadow.appendChild(link)

  const root = document.createElement('div')
  root.className = 'cc-root'
  shadow.appendChild(root)

  // ----- toasts (mouse pass-through container) -----
  const toastWrap = document.createElement('div')
  toastWrap.className = 'cc-toasts'   // pointer-events:none en CSS
  root.appendChild(toastWrap)

  function showToast (dm) {
    const el = document.createElement('div')
    el.className = 'cc-toast'           // pointer-events:auto solo aquí
    const head = document.createElement('div')
    head.className = 'cc-toast-head'
    head.textContent = `💬 ${dm.fromNickname || 'Closer Click'}${dm.queued ? ' (offline)' : ''}`
    const body = document.createElement('div')
    body.className = 'cc-toast-body'
    body.textContent = dm.text || ''
    el.appendChild(head); el.appendChild(body)
    el.addEventListener('click', () => {
      openPanel()
      fadeOut(el)
    })
    toastWrap.appendChild(el)
    requestAnimationFrame(() => el.classList.add('show'))
    setTimeout(() => fadeOut(el), 5000)
  }

  function fadeOut (el) {
    el.classList.remove('show')
    el.classList.add('leaving')
    setTimeout(() => el.remove(), 300)
  }

  // ----- floating action button -----
  const fab = document.createElement('button')
  fab.className = 'cc-fab'
  fab.textContent = '💬'
  fab.title = 'Closer Click Messenger'
  fab.addEventListener('click', () => togglePanel())
  root.appendChild(fab)

  // ----- panel = iframe al PWA -----
  const panel = document.createElement('div')
  panel.className = 'cc-panel'
  const closeBtn = document.createElement('button')
  closeBtn.className = 'cc-close'
  closeBtn.title = 'Cerrar'
  closeBtn.textContent = '×'
  closeBtn.addEventListener('click', () => panel.classList.remove('open'))
  const frame = document.createElement('iframe')
  frame.className = 'cc-frame'
  frame.title = 'Messenger'
  // Cargamos lazy: solo cuando el usuario abre el panel por primera vez,
  // para no abrir un iframe pesado en CADA pestaña al navegar.
  frame.dataset.src = PWA_URL
  panel.appendChild(closeBtn)
  panel.appendChild(frame)
  root.appendChild(panel)

  function togglePanel () {
    if (panel.classList.contains('open')) panel.classList.remove('open')
    else openPanel()
  }
  function openPanel () {
    if (!frame.src) frame.src = frame.dataset.src
    panel.classList.add('open')
  }

  // ----- runtime events del SW -----
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return
    if (msg.kind === 'incoming_dm' && msg.dm) {
      showToast(msg.dm)
    }
  })

  function mount () {
    if (!document.body) { setTimeout(mount, 50); return }
    document.body.appendChild(host)
  }
  mount()
})()
