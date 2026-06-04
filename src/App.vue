<script setup>
import { onMounted, onUnmounted, ref, computed, watch } from 'vue'
import { useConnectionStore } from './stores/connectionStore'
import { useContactsStore } from './stores/contactsStore'
import { useThreadsStore } from './stores/threadsStore'
import NicknameModal from './components/NicknameModal.vue'
import ContactList from './components/ContactList.vue'
import RequestsInbox from './components/RequestsInbox.vue'
import Conversation from './components/Conversation.vue'
import AddContactModal from './components/AddContactModal.vue'
import RatingModal from './components/RatingModal.vue'
import SyncSettingsModal from './components/SyncSettingsModal.vue'
import NotificationSettingsModal from './components/NotificationSettingsModal.vue'
import HelpTip from './components/HelpTip.vue'
import IncomingNotification from './components/IncomingNotification.vue'
import { useNotifPrefsStore } from './stores/notifPrefsStore'
import { getIdentity } from './services/identity'
import { isDisplayed, markDisplayed } from './services/displayedMessages'
import { useBackLayer } from '@closerclick/closer-click-nav/vue'

const booting = ref(true)

const HELP_TIPS = [
  {
    id: 'token-share',
    targetSelector: '.me .tok',
    message: 'Este token es necesario para que otros usuarios te puedan agregar como contacto.',
    placement: 'bottom',
    when: () => !!document.querySelector('.me .tok')
  }
]
const HELP_KEY = 'cc_help_seen_v1'
const seenHelp = ref(new Set(JSON.parse(localStorage.getItem(HELP_KEY) || '[]')))
const currentTip = computed(() => HELP_TIPS.find(t => !seenHelp.value.has(t.id) && (t.when ? t.when() : true)) || null)
const dismissTip = () => {
  if (!currentTip.value) return
  seenHelp.value.add(currentTip.value.id)
  localStorage.setItem(HELP_KEY, JSON.stringify([...seenHelp.value]))
  seenHelp.value = new Set(seenHelp.value)
}

const connection = useConnectionStore()
const contacts = useContactsStore()
const threads = useThreadsStore()
const notifPrefs = useNotifPrefsStore()

const showAdd = ref(false)
const showSync = ref(false)
const showNotif = ref(false)
const ratingFor = ref(null)

// Cantidad de solicitudes pendientes — para el badge de la campana.
const requestCount = computed(() => threads.requests.requests.length)

// Pitido corto (WebAudio, sin assets) al notificar, si el usuario lo dejó on.
const playBeep = () => {
  if (!notifPrefs.prefs.sound) return
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'sine'; o.frequency.value = 880
    o.connect(g); g.connect(ctx.destination)
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25)
    o.start(); o.stop(ctx.currentTime + 0.26)
    o.onended = () => { try { ctx.close() } catch (_) {} }
  } catch (_) { /* autoplay bloqueado hasta interacción: ignorar */ }
}

// Notificación centrada de DM entrante. Solo el primer contexto que vea un
// DM nuevo (chequeo atómico contra `cc-displayed-msgs-v1` en chrome.storage)
// lo muestra; los demás (otras pestañas con FAB, popup, offscreen) skip.
const incomingNotification = ref(null)
const onIncomingDone = (id) => {
  if (incomingNotification.value?.id === id) incomingNotification.value = null
}
watch(() => threads.lastIncomingDM, async (dm) => {
  if (!dm?.id) return
  const wasNew = await markDisplayed(dm.id)
  if (!wasNew) return  // otra pestaña ya lo mostró
  incomingNotification.value = dm
  playBeep()
})
// En mobile, si ya hay conversación restaurada del refresh, abrimos directo
// el panel de chat; si no, mostramos la lista de contactos.
const showSidebarMobile = ref(!threads.activePubkey)

let deferredPrompt = null
const isStandalone = ref(
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true
)
const canInstall = ref(false)
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream

const onBeforeInstallPrompt = (e) => {
  e.preventDefault()
  deferredPrompt = e
  canInstall.value = true
}
const onAppInstalled = () => {
  deferredPrompt = null
  canInstall.value = false
  isStandalone.value = true
}
const installApp = async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    deferredPrompt = null
    canInstall.value = false
    return
  }
  if (isIOS) {
    alert('Para instalar: pulsa el botón Compartir y luego "Añadir a pantalla de inicio".')
  } else {
    alert('Tu navegador todavía no permite la instalación automática. Usa el menú del navegador para instalar la app.')
  }
}
const showInstallButton = computed(() => !isStandalone.value && (canInstall.value || isIOS))

onMounted(async () => {
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  window.addEventListener('appinstalled', onAppInstalled)
  // Bootstrap: fuerza el getIdentity() inicial para que en modo iframe el
  // bridge intente hidratar el vault desde chrome.storage.local antes de
  // decidir si mostramos NicknameModal o CTA. Si la vault tiene me.nickname
  // (después de importar el blob), tomamos ese nick automáticamente.
  // Si estamos en overlay sobre página HTTP, ni siquiera tratamos de cargar
  // la vault: crypto.subtle no existe → falla seguro.
  if (!blockedByInsecureTop) {
    try {
      const id = await getIdentity()
      console.log('[cc-app] boot id.me=', id?.me, 'connection.nickname=', connection.nickname)
      if (id) {
        const vaultNick = id.me?.nickname
        const havePubkey = !!id.me?.publickey
        if (vaultNick && vaultNick !== connection.nickname) {
          // El vault es la fuente de verdad: si trae nickname y difiere del
          // local (incluido un placeholder pegado de sesiones previas), lo
          // aplicamos. En overlay no escribe al vault para no contaminar.
          console.log('[cc-app] boot: applying nickname from vault →', vaultNick)
          connection.setNickname(vaultNick, { writeToVault: !isReadOnlyEmbed })
        } else if (!vaultNick && connection.nicknameSet && !isReadOnlyEmbed) {
          console.log('[cc-app] boot: backfilling vault.me.nickname from localStorage →', connection.nickname)
          await id.setMyNickname(connection.nickname).catch(e => console.warn('backfill failed', e))
        } else if (!vaultNick && !connection.nicknameSet && havePubkey && isReadOnlyEmbed) {
          // Overlay con vault hidratado pero sin nickname — el blob fue
          // publicado por una versión vieja que no sincronizaba el nickname.
          // Aceptamos un placeholder derivado del pubkey para desbloquear la
          // UI; el usuario puede actualizar su nick en messenger.closer.click
          // directo y se propagará al overlay.
          let derived = 'Yo'
          try {
            const pk = JSON.parse(id.me.publickey)
            derived = (pk?.x || '').slice(0, 6).toUpperCase() || 'Yo'
          } catch (_) {}
          console.log('[cc-app] boot: overlay placeholder nickname →', derived)
          connection.setNickname(derived, { writeToVault: false })
        }
      }
    } catch (e) { console.warn('[cc-app] boot identity failed:', e) }
  }
  booting.value = false
  // Overlay no abre conexión propia ni hace announceToKnown — el offscreen
  // mantiene una sola conexión por usuario y procesa los sends de overlays
  // vía cc-outbound-v1. Popup/offscreen/direct tab sí conectan normalmente.
  if (connection.nicknameSet && !isReadOnlyEmbed) {
    await connection.connect()
    await contacts.refreshPeers()
    setTimeout(announceToKnown, 500)
  } else if (connection.nicknameSet && isReadOnlyEmbed) {
    // Mark connected (UI dot) — los sends salen por relay.
    await connection.connect()
    await contacts.refreshPeers()
  }
})

onUnmounted(() => {
  window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  window.removeEventListener('appinstalled', onAppInstalled)
})

// Avisamos a todos los contactos por pubkey: si están conectados el proxy
// les entrega ya, si no queda en cola 24h. Su HELLO de respuesta marcará
// presencia (markOnline) y la UI deja de decir "offline".
const announceToKnown = async () => {
  for (const c of contacts.contacts) {
    threads.sendHelloByPubkey(c.publickey)
  }
}

const handleNicknameSet = async (nick) => {
  connection.setNickname(nick)
  await connection.connect()
  await contacts.refreshPeers()
  setTimeout(announceToKnown, 500)
}

const onSelectContact = (pubkey) => {
  threads.setActive(pubkey)
  showSidebarMobile.value = false
}

const backToList = () => { showSidebarMobile.value = true; threads.setActive(null) }
const openRating = (pubkey) => { ratingFor.value = pubkey }

// Volver unificado (@closerclick/closer-click-nav): el botón físico de Android /
// gesto de iOS / atrás del navegador / chevron del header cierra el modal abierto
// o la conversación activa (vuelve a la lista) antes de salir hacia closer.click.
useBackLayer(showAdd)
useBackLayer(showSync)
useBackLayer(showNotif)
useBackLayer(ratingFor, { onClose: () => { ratingFor.value = null } })
// La conversación abierta es una "vista": volver regresa a la lista de contactos.
const convoOpen = computed(() => !!threads.activePubkey)
useBackLayer(convoOpen, { onClose: backToList })

// avatar initials helper
const initials = (s) => (s || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase()

// Modo overlay: storage particionado, no podemos crear identidad útil aquí.
// Si no llega blob por el bridge, mostramos un CTA al messenger directo en vez
// del NicknameModal. El usuario crea/usa su cuenta en messenger.closer.click
// (top-level real, unpartitioned) y la extensión propaga el blob al overlay.
const embed = new URLSearchParams(location.search).get('embed')
const isReadOnlyEmbed = embed === 'overlay'
// Si la página padre es HTTP, el iframe HTTPS queda non-secure-context y
// `crypto.subtle` no existe — la vault no puede arrancar, así que ni siquiera
// intentamos. CTA inmediato.
const blockedByInsecureTop = isReadOnlyEmbed && !window.isSecureContext
const openMessengerTab = () => {
  try { window.open('https://messenger.closer.click/', '_blank', 'noopener') }
  catch (_) { location.href = 'https://messenger.closer.click/' }
}
</script>

<template>
  <!-- Boot: esperamos al getIdentity() inicial antes de decidir qué pintar. -->
  <div v-if="booting" class="login-cta"><div class="login-card"><p>Cargando…</p></div></div>

  <!-- Overlay sin identidad: no permitimos crear cuenta aquí (storage
       particionado por el site visitado). En su lugar, CTA al messenger real. -->
  <div v-else-if="!connection.nicknameSet && isReadOnlyEmbed" class="login-cta">
    <div class="login-card">
      <img class="login-logo" src="/icons/icon-192.png" alt="Closer Click" />
      <h2>Inicia sesión</h2>
      <p v-if="blockedByInsecureTop">
        Esta página usa HTTP. El navegador desactiva las APIs criptográficas en iframes embebidos en sitios no seguros, así que el messenger no puede correr aquí. Ábrelo en su pestaña directa.
      </p>
      <p v-else>
        Crea o entra a tu cuenta en messenger.closer.click. Tu identidad se sincroniza con la extensión automáticamente.
      </p>
      <button class="btn primary-cta" @click="openMessengerTab">Login</button>
    </div>
  </div>

  <NicknameModal v-else-if="!connection.nicknameSet" @set="handleNicknameSet" />

  <div v-else class="app">
    <header class="topbar">
      <closer-click-back class="cc-back" lang="es"></closer-click-back>
      <div class="brand">
        <img class="logo" src="/icons/icon-192.png" alt="Closer Click" />
        <span class="brand-name">Closer Click</span>
      </div>
      <div class="status">
        <button v-if="showInstallButton" class="install-btn" @click="installApp" title="Instalar como app">
          ⬇ Instalar
        </button>
        <div class="me">
          <span :class="['dot', connection.isConnected ? 'on' : 'off']"></span>
          <span class="who">@{{ connection.nickname }}</span>
          <code class="tok" v-if="connection.token">{{ connection.token }}</code>
        </div>
        <button class="bell-btn" @click="showNotif = true" title="Notificaciones y solicitudes">
          🔔
          <span v-if="requestCount" class="bell-badge">{{ requestCount }}</span>
        </button>
        <button class="me-avatar" @click="showSync = true" :title="'Tu cuenta'">{{ initials(connection.nickname) }}</button>
        <closer-click-support
          class="topbar-coin"
          href="https://ko-fi.com/closerclick"
          repo="closerclick/closerclick_messenger"
          discord="https://discord.gg/D648uq7cth"
        ></closer-click-support>
      </div>
    </header>

    <main class="layout" :class="{ 'show-side': showSidebarMobile }">
      <aside class="sidebar">
        <div class="side-head">
          <h3>Contactos</h3>
          <button class="add-btn" @click="showAdd = true" title="Añadir contacto">+</button>
        </div>
        <RequestsInbox />
        <ContactList @select="onSelectContact" @rate="openRating" />
      </aside>

      <section class="main-pane">
        <Conversation
          v-if="threads.activePubkey"
          @back="backToList"
          @rate="openRating"
        />
        <div v-else class="empty">
          <div class="empty-card">
            <div class="empty-mark">CC</div>
            <h4>Selecciona un contacto</h4>
            <p>Para empezar una conversación, elige a alguien de la lista,
               o pulsa <strong>+</strong> para añadir un nuevo contacto por token.</p>
          </div>
        </div>
      </section>
    </main>

    <AddContactModal v-if="showAdd" @close="showAdd = false" />
    <RatingModal v-if="ratingFor" :pubkey="ratingFor" @close="ratingFor = null" />
    <SyncSettingsModal v-if="showSync" @close="showSync = false" />
    <NotificationSettingsModal v-if="showNotif" @close="showNotif = false" />

    <HelpTip
      v-if="currentTip && connection.token"
      :key="currentTip.id"
      :target-selector="currentTip.targetSelector"
      :message="currentTip.message"
      :placement="currentTip.placement"
      @dismiss="dismissTip"
    />

    <IncomingNotification :dm="incomingNotification" @done="onIncomingDone" />
  </div>
</template>

<style scoped>
.app {
  display: flex; flex-direction: column;
  height: 100vh;
  height: 100svh;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
}

.login-cta {
  display: flex; align-items: center; justify-content: center;
  height: 100%;
  padding: 24px;
  background: var(--bg-1);
}
.login-card {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 28px 24px;
  text-align: center;
  max-width: 340px;
}
.login-logo { width: 56px; height: 56px; margin-bottom: 14px; }
.login-card h2 { margin: 0 0 8px; font-family: var(--font-headline); font-size: 20px; }
.login-card p { margin: 0 0 18px; color: var(--muted); font-size: 14px; line-height: 1.5; }
.login-card .btn { width: 100%; }

.topbar {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 20px;
  background: var(--bg-2);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
/* Chevron de volver (Web Component @closerclick/closer-click-nav). */
.cc-back { color: var(--text, currentColor); --cc-back-size: 38px; margin-left: -6px; }
.brand { display: flex; align-items: center; gap: 12px; }
.status { margin-left: auto; }
.logo {
  width: 36px; height: 36px;
  object-fit: contain;
  display: block;
}
.brand-name {
  font-family: var(--font-headline);
  font-weight: 600;
  font-size: 17px;
  color: var(--text);
}

.status { display: flex; gap: 12px; align-items: center; }

.me {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  background: var(--bg-3);
  border-radius: 999px;
  font-size: 13px;
}
.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot.on  { background: var(--online); box-shadow: 0 0 0 2px rgba(90, 138, 58, 0.18); }
.dot.off { background: var(--accent); opacity: 0.6; }
.who { color: var(--text); font-weight: 500; }
.tok {
  background: var(--bg-1);
  padding: 2px 8px;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--muted);
  border: 1px solid var(--border);
}

.install-btn {
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--accent);
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: background 150ms ease-out;
}
.install-btn:hover { background: rgba(192, 57, 43, 0.08); }

.me-avatar {
  width: 36px; height: 36px;
  border-radius: 50%;
  background: var(--bg-4); color: var(--text);
  border: 1px solid var(--border);
  cursor: pointer;
  font-family: var(--font-headline);
  font-weight: 600;
  font-size: 13px;
  transition: transform 150ms ease-out, border-color 150ms ease-out;
}
.me-avatar:hover { border-color: var(--accent); transform: translateY(-1px); }

.topbar-coin { display: inline-flex; align-items: center; }

.bell-btn {
  position: relative;
  width: 36px; height: 36px;
  border-radius: 50%;
  background: var(--bg-4); color: var(--text);
  border: 1px solid var(--border);
  cursor: pointer; font-size: 16px;
  display: inline-flex; align-items: center; justify-content: center;
  transition: transform 150ms ease-out, border-color 150ms ease-out;
}
.bell-btn:hover { border-color: var(--accent); transform: translateY(-1px); }
.bell-badge {
  position: absolute; top: -4px; right: -4px;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 999px; background: var(--accent, #2dd4bf); color: #04221d;
  font-size: 11px; font-weight: 700; line-height: 18px;
}

.layout { flex: 1; display: flex; min-height: 0; }
.sidebar {
  width: 320px;
  max-width: 35%;
  background: var(--bg-2);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
}
.side-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.side-head h3 {
  margin: 0;
  font-family: var(--font-headline);
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}
.add-btn {
  background: var(--accent); color: var(--on-accent);
  border: 0;
  width: 32px; height: 32px;
  border-radius: 50%;
  font-size: 18px;
  font-weight: 700;
  cursor: pointer;
  transition: background 150ms ease-out, transform 100ms ease-out;
  box-shadow: 0 1px 3px rgba(192, 57, 43, 0.25);
}
.add-btn:hover { background: var(--accent-2); }
.add-btn:active { transform: translateY(1px); }

.main-pane {
  flex: 1;
  display: flex; flex-direction: column;
  min-width: 0;
  background: var(--bg-1);
}
.empty {
  flex: 1;
  display: flex; align-items: center; justify-content: center;
  padding: 32px;
}
.empty-card {
  text-align: center;
  max-width: 380px;
  padding: 32px;
  background: var(--bg-2);
  border-radius: 12px;
  border: 1px solid var(--border);
}
.empty-mark {
  width: 56px; height: 56px;
  margin: 0 auto 16px;
  background: var(--accent); color: var(--on-accent);
  border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-headline); font-weight: 700; font-size: 18px;
}
.empty-card h4 {
  margin: 0 0 8px;
  font-family: var(--font-headline);
  font-size: 18px;
  font-weight: 600;
}
.empty-card p {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.5;
}

@media (max-width: 700px) {
  .sidebar { max-width: 100%; width: 100%; }
  .layout { position: relative; }
  .layout .sidebar  { display: none; }
  .layout .main-pane { display: flex; }
  .layout.show-side .sidebar  { display: flex; }
  .layout.show-side .main-pane { display: none; }
  .topbar { padding: 10px 14px; }
  .brand-name { display: none; }
  .me { padding: 4px 8px; gap: 6px; font-size: 12px; }
  .me .tok { font-size: 11px; padding: 2px 6px; }
}
</style>
