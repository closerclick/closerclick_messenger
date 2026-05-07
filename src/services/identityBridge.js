// Bridge de identidad: cuando el messenger corre como iframe dentro de la
// extensión (popup, overlay, offscreen), usa `chrome.storage.local` (vía
// postMessage al host script de la extensión) como fuente compartida del
// blob de identidad. Esto puentea el storage partitioning: el offscreen
// (unpartitioned) escribe el blob real, los overlays (particionados por
// el site visitado) lo leen al arrancar e importan la identidad antes de
// crear una nueva en su bucket aislado.
//
// El protocolo es muy simple: postMessage al parent con
//   { source:'cc-id-bridge', type:'request', id, op:'get'|'set'|'clear', blob? }
// y el host responde con
//   { source:'cc-id-bridge', type:'response', id, result?, error? }
// (definido en extension/identity-bridge-host.js).

let _nextId = 1
const _pending = new Map()
let _wired = false

function ensureWired () {
  if (_wired) return
  _wired = true
  window.addEventListener('message', (ev) => {
    const m = ev.data
    if (!m || m.source !== 'cc-id-bridge') return
    if (m.type === 'response' && _pending.has(m.id)) {
      const { resolve, reject, timer } = _pending.get(m.id)
      _pending.delete(m.id)
      clearTimeout(timer)
      if (m.error) reject(new Error(m.error))
      else resolve(m.result)
    }
  })
}

function call (op, payload = {}) {
  ensureWired()
  // Si estamos en pestaña directa (window === window.top) no hay parent, pero
  // el content script de la extensión inyecta `identity-bridge-host.js`
  // también en messenger.closer.click. Esa lista en el mismo `window` (en
  // su isolated world), así que basta con `window.postMessage` a sí mismo.
  const target = window.parent !== window ? window.parent : window
  return new Promise((resolve, reject) => {
    const id = _nextId++
    const timer = setTimeout(() => {
      _pending.delete(id)
      console.warn('[cc-id-bridge:client] timeout', { id, op })
      reject(new Error('cc-id-bridge timeout'))
    }, 3000)
    _pending.set(id, { resolve, reject, timer })
    try {
      console.log('[cc-id-bridge:client] →', { id, op, hasBlob: !!payload.blob })
      target.postMessage({ source: 'cc-id-bridge', type: 'request', id, op, ...payload }, '*')
    } catch (e) {
      _pending.delete(id)
      clearTimeout(timer)
      reject(e)
    }
  })
}

/** Lee el blob de identidad del bridge. Devuelve null si no hay o no hay parent. */
export async function getIdentityBlob () {
  try { return await call('get') }
  catch (e) { console.warn('[cc-id-bridge] get failed:', e.message); return null }
}

/** Guarda el blob de identidad (snapshot completo) al bridge. */
export async function setIdentityBlob (blob) {
  try { await call('set', { blob }); return true }
  catch (e) { console.warn('[cc-id-bridge] set failed:', e.message); return false }
}

/** Suscribe a cambios remotos del blob (otros contextos lo escribieron). */
export function onIdentityBlobChanged (handler) {
  ensureWired()
  const listener = (ev) => {
    const m = ev.data
    if (m?.source === 'cc-id-bridge' && m.type === 'changed') handler(m.blob)
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
