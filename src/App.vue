<script setup>
import { onMounted, onUnmounted, ref, computed } from 'vue'
import { useConnectionStore } from './stores/connectionStore'
import { useContactsStore } from './stores/contactsStore'
import { useThreadsStore } from './stores/threadsStore'
import NicknameModal from './components/NicknameModal.vue'
import ContactList from './components/ContactList.vue'
import Conversation from './components/Conversation.vue'
import AddContactModal from './components/AddContactModal.vue'
import RatingModal from './components/RatingModal.vue'
import SyncSettingsModal from './components/SyncSettingsModal.vue'

const connection = useConnectionStore()
const contacts = useContactsStore()
const threads = useThreadsStore()

const showAdd = ref(false)
const showSync = ref(false)
const ratingFor = ref(null)
const showSidebarMobile = ref(true)

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
  if (connection.nicknameSet) {
    await connection.connect()
    await contacts.refreshPeers()
    setTimeout(announceToKnown, 500)
  }
})

onUnmounted(() => {
  window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  window.removeEventListener('appinstalled', onAppInstalled)
})

const announceToKnown = async () => {
  for (const c of contacts.contacts) {
    if (c.lastToken) threads.sendHello(c.lastToken)
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

// avatar initials helper
const initials = (s) => (s || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase()
</script>

<template>
  <NicknameModal v-if="!connection.nicknameSet" @set="handleNicknameSet" />

  <div v-else class="app">
    <header class="topbar">
      <div class="brand">
        <span class="logo">CC</span>
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
        <button class="me-avatar" @click="showSync = true" :title="'Tu cuenta'">{{ initials(connection.nickname) }}</button>
      </div>
    </header>

    <main class="layout" :class="{ 'show-side': showSidebarMobile }">
      <aside class="sidebar">
        <div class="side-head">
          <h3>Contactos</h3>
          <button class="add-btn" @click="showAdd = true" title="Añadir contacto">+</button>
        </div>
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
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100vh; }

.topbar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 20px;
  background: var(--bg-2);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.brand { display: flex; align-items: center; gap: 12px; }
.logo {
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px;
  background: var(--accent); color: var(--on-accent);
  border-radius: 10px;
  font-family: var(--font-headline);
  font-weight: 700; font-size: 14px;
  letter-spacing: -0.02em;
  box-shadow: 0 1px 2px rgba(192, 57, 43, 0.25);
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
