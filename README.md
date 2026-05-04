# Closer Click Messenger

App de mensajería P2P del ecosistema [Closer Click](https://github.com/seyacat).

- **Identidad compartida** con `id.closer.click` (mismas claves entre chat / chess / messenger).
- **Mensajes E2E** cifrados con ECDH P-256 + AES-256-GCM (vía `Identity.encrypt/decrypt`).
- **Transporte WebRTC-first** con fallback al proxy (vía `closer-click-proxy-client@0.3.0`).
- **Contactos compartidos** entre apps del ecosistema (vault `id.closer.click@0.6.0`).
- **PWA**: instalable en móvil; sin cache (todas las peticiones van a la red).
- **Histórico local** en `localStorage`; al alcanzar el límite del navegador se descartan
  los mensajes más antiguos automáticamente.
- **Ranking integrado**: cada contacto tiene rating propio (★ oro) y derivado por
  endorsements firmados (★ azul) — modelo de web of trust.

## Desarrollo

```bash
npm install
npm run dev
```

## Build / Deploy

GitHub Pages auto-deploy en push a `main`. El sitio queda en
`https://seyacat.github.io/closerclick_messenger/`.
