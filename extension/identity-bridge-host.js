// Identity bridge — host side.
//
// Se incluye en cualquier contexto de la extensión que aloja un iframe del
// messenger PWA: content scripts (overlay), popup, offscreen. Su trabajo es
// responder a mensajes `cc-id-bridge:*` desde el iframe leyendo/escribiendo
// `chrome.storage.local`.
//
// Storage shape (chrome.storage.local):
//   { 'cc-identity-blob-v1': <blob from id.exportIdentity()> }
//
// El offscreen es la fuente de verdad: vive en chrome-extension:// y por
// host_permissions tiene acceso unpartitioned a id.closer.click. Cuando hace
// `id.exportIdentity()` y `setBlob()`, todos los demás contextos
// (overlay particionado en seyanim.com / cualquier otro site) pueden hacer
// `getBlob()` al arrancar e `id.importIdentity(blob)` para empezar con la
// identidad real en lugar de generar una nueva en su partition aislado.

(function () {
  if (window.__cc_identity_bridge_host) return
  window.__cc_identity_bridge_host = true

  const STORAGE_KEY = 'cc-identity-blob-v1'

  function reply (source, origin, id, payload) {
    try { source.postMessage({ source: 'cc-id-bridge', type: 'response', id, ...payload }, origin) }
    catch (_) {}
  }

  window.addEventListener('message', async (event) => {
    const msg = event.data
    if (!msg || msg.source !== 'cc-id-bridge' || msg.type !== 'request') return
    const { id, op, blob } = msg
    if (!chrome?.storage?.local) {
      reply(event.source, event.origin, id, { error: 'chrome.storage unavailable' })
      return
    }
    try {
      if (op === 'get') {
        const r = await chrome.storage.local.get(STORAGE_KEY)
        reply(event.source, event.origin, id, { result: r?.[STORAGE_KEY] || null })
      } else if (op === 'set') {
        await chrome.storage.local.set({ [STORAGE_KEY]: blob })
        reply(event.source, event.origin, id, { result: true })
      } else if (op === 'clear') {
        await chrome.storage.local.remove(STORAGE_KEY)
        reply(event.source, event.origin, id, { result: true })
      } else {
        reply(event.source, event.origin, id, { error: `unknown op: ${op}` })
      }
    } catch (e) {
      reply(event.source, event.origin, id, { error: e?.message || String(e) })
    }
  })

  // Notifica cambios de storage a todos los iframes del messenger del host.
  if (chrome?.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[STORAGE_KEY]) return
      const all = document.querySelectorAll('iframe')
      for (const f of all) {
        try {
          f.contentWindow?.postMessage(
            { source: 'cc-id-bridge', type: 'changed', blob: changes[STORAGE_KEY].newValue || null },
            '*'
          )
        } catch (_) {}
      }
    })
  }
})()
