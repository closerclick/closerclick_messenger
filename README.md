# Closer Click Messenger

App de mensajería P2P del ecosistema [Closer Click](https://github.com/seyacat). Este repo contiene **dos artefactos**:

- **PWA web** (`src/`) — la app principal, deployada a `messenger.closer.click`.
- **Extensión Chrome** (`extension/`) — shell delgado que reusa la PWA en un iframe; añade overlay sobre cualquier página + service worker que recibe DMs con la pestaña cerrada.

Ambos comparten **identidad** (`id.closer.click`) y **histórico de mensajes** (`store.closer.click`), así que abrir el messenger en el navegador y la extensión se ven como la misma cosa.

## PWA

- **Identidad compartida** con `id.closer.click` (mismas claves entre chat / chess / messenger / extensión).
- **Mensajes E2E** cifrados con ECDH P-256 + AES-256-GCM (vía `Identity.encrypt/decrypt`).
- **Transporte WebRTC-first** con fallback al proxy (`@gatoseya/closer-click-proxy-client`).
- **Contactos compartidos** en el vault.
- **Histórico compartido** en `store.closer.click` — visible desde web + extensión + futuras apps en el mismo navegador.
- **Cola offline 24h** del proxy, multi-instancia con fan-out (web + extensión reciben el mismo DM).
- **PWA**: instalable en móvil; sin cache.
- **Ranking integrado**: rating propio (★ oro) y derivado por endorsements firmados (★ azul).
- **Cuenta Google como almacén principal** (botón 👤 en topbar): el usuario inicia sesión con Google y sus claves/contactos/historial viven en su Drive (carpeta privada `appDataFolder`), disponibles en cualquier dispositivo donde entre con la misma cuenta. Los datos se cifran en el navegador con la contraseña personal del usuario (PBKDF2 600 000 iter + AES-256-GCM) antes de subir — Google solo ve bytes opacos. El localStorage local actúa como working copy offline-first; al conectar se merge con la versión remota.

### Configuración OAuth (para que el sync funcione)

El sync requiere un Google OAuth Client ID. Configurarlo:

1. **Crear el cliente** en [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → Create OAuth client ID → Web application.
2. **Authorized JavaScript origins**: añadir `https://id.closer.click`, `https://store.closer.click`, `https://messenger.closer.click` y `http://localhost:5173` (dev).
3. **Scope** (en OAuth consent screen): solo `https://www.googleapis.com/auth/drive.appdata`.
4. **Habilitar** Google Drive API en el proyecto (Library → enable).
5. Copiar el Client ID al `.env.local`:
   ```
   VITE_GOOGLE_OAUTH_CLIENT_ID=xxxxxxxxxxxx-xxxxxxxxxx.apps.googleusercontent.com
   ```
6. Para el deploy: GitHub repo → Settings → Environments → `PRODUCTION` → secret `VITE_GOOGLE_OAUTH_CLIENT_ID`. El workflow lo inyecta en build.

El Client Secret **no se usa** (browser flow vía Google Identity Services).

### Desarrollo

```bash
npm install
npm run dev
```

### Build / Deploy

GitHub Pages auto-deploy en push a `main`. La PWA se sirve desde `messenger.closer.click`.

## Extensión Chrome (`extension/`)

Shell MV3 ultra-delgado:

- `manifest.json` — perms: `offscreen`, `notifications`, `alarms`. Hosts: messenger / id / store / proxy.
- `background.js` — service worker, solo dispara notificaciones nativas y reenvía eventos del offscreen a tabs.
- `offscreen.html` — `<iframe src="https://messenger.closer.click/?embed=offscreen">`. La PWA mantiene la conexión al proxy y notifica DMs por `postMessage`.
- `content.js` — Shadow DOM en `<all_urls>`: toasts (fade in/out + mouse pass-through) y panel deslizable que es otro iframe a la PWA.
- `popup/popup.html` — popup de la barra, también iframe a la PWA.

### Cargar localmente

```
chrome://extensions/ → Modo desarrollador → Cargar descomprimida → seleccionar carpeta `extension/`
```

### Empaquetar para Web Store

```bash
cd extension
./package-extension.sh        # Linux/macOS
.\package-extension.ps1       # Windows
# → ../../cc-messenger-extension-<version>.zip
```

Documentación de revisión Web Store en `extension/`:
- `PRIVACY.md` — política de privacidad
- `PERMISSIONS.md` — justificación de cada permiso (copy-paste durante review)
- `STORE_LISTING.md` — copy del listado
- `SUBMISSION.md` — checklist de envío

### CI

Push de tag `ext-v*` (ej: `git tag ext-v1.1.0 && git push --tags`) dispara `.github/workflows/build-extension.yml` que produce el zip como artifact.
