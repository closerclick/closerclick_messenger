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
const ratingFor = ref(null)   // pubkey or null
const showSidebarMobile = ref(true)

// PWA install prompt
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
    // After connect, announce ourselves to all known contacts via HELLO
    setTimeout(announceToKnown, 500)
  }
})

onUnmounted(() => {
  window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  window.removeEventListener('appinstalled', onAppInstalled)
})

const announceToKnown = async () => {
  for (const c of contacts.contacts) {
    if (c.lastToken) {
      threads.sendHello(c.lastToken)
    }
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
</script>

<template>
  <NicknameModal v-if="!connection.nicknameSet" @set="handleNicknameSet" />

  <div v-else class="messenger">
    <header class="topbar">
      <div class="brand">💬 Messenger</div>
      <div class="status">
        <button v-if="showInstallButton" class="install-btn" @click="installApp" title="Instalar como app">
          ⬇ Instalar
        </button>
        <button class="sync-btn" @click="showSync = true" title="Sincronizar con Google Drive">☁️</button>
        <span :class="['dot', connection.isConnected ? 'on' : 'off']"></span>
        <span class="who">@{{ connection.nickname }}</span>
        <code class="tok" v-if="connection.token">{{ connection.token }}</code>
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
          <p>Selecciona un contacto para chatear</p>
          <p class="hint">o pulsa <strong>+</strong> para añadir uno por token.</p>
        </div>
      </section>
    </main>

    <AddContactModal v-if="showAdd" @close="showAdd = false" />
    <RatingModal v-if="ratingFor" :pubkey="ratingFor" @close="ratingFor = null" />
    <SyncSettingsModal v-if="showSync" @close="showSync = false" />
  </div>
</template>

<style scoped>
.messenger { display: flex; flex-direction: column; height: 100vh; }
.topbar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 16px; background: var(--bg-2); border-bottom: 1px solid var(--border);
}
.brand { font-weight: 600; }
.status { display: flex; gap: 8px; align-items: center; font-size: 14px; }
.dot { width: 8px; height: 8px; border-radius: 50%; }
.dot.on  { background: #4caf50; }
.dot.off { background: #c44; }
.tok { background: var(--bg-3); padding: 2px 6px; border-radius: 4px; font-family: monospace; }
.install-btn {
  background: var(--accent); color: #fff; border: 0;
  padding: 6px 12px; border-radius: 6px; cursor: pointer;
  font-size: 13px; font-weight: 500;
}
.install-btn:hover { background: var(--accent-2); }
.sync-btn {
  background: transparent; border: 1px solid var(--border); border-radius: 6px;
  padding: 4px 8px; cursor: pointer; font-size: 14px;
}
.sync-btn:hover { background: var(--bg-3); }
.layout { flex: 1; display: flex; min-height: 0; }
.sidebar {
  width: 320px; max-width: 35%; border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
}
.side-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 16px; border-bottom: 1px solid var(--border);
}
.side-head h3 { margin: 0; font-size: 16px; }
.add-btn {
  background: var(--accent); color: #fff; border: 0; width: 32px; height: 32px;
  border-radius: 50%; font-size: 18px; cursor: pointer;
}
.main-pane { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.empty {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; color: var(--muted); padding: 24px;
  text-align: center;
}
.empty .hint { font-size: 14px; margin-top: 8px; }

@media (max-width: 700px) {
  .sidebar { max-width: 100%; width: 100%; }
  .layout { position: relative; }
  .layout .sidebar  { display: none; }
  .layout .main-pane { display: flex; }
  .layout.show-side .sidebar  { display: flex; }
  .layout.show-side .main-pane { display: none; }
}
</style>
