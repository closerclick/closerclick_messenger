<script setup>
import { computed } from 'vue'
import { useContactsStore } from '../stores/contactsStore'
import { useThreadsStore } from '../stores/threadsStore'

const contacts = useContactsStore()
const threads = useThreadsStore()
const emit = defineEmits(['select', 'rate'])

const items = computed(() => {
  contacts.ratingTick // dependency
  return contacts.contacts
    .map(c => {
      const thread = threads.threads[c.publickey] || []
      const last = thread.length ? thread[thread.length - 1] : null
      const r = contacts.ratingFor(c.publickey)
      return {
        ...c,
        online: contacts.isOnline(c.publickey),
        lastText: last?.text || null,
        lastTs: last?.ts || c.lastSeen,
        unread: thread.filter(e => e.dir === 'in' && !e._read).length,
        rating: r
      }
    })
    .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0))
})

const stars = (val) => {
  if (val == null) return ''
  const full = Math.round(val)
  return '★'.repeat(full) + '☆'.repeat(5 - full)
}
</script>

<template>
  <div class="list">
    <div v-if="items.length === 0" class="empty">
      Aún no tienes contactos. Pulsa <strong>+</strong> para añadir uno.
    </div>
    <div
      v-for="c in items"
      :key="c.publickey"
      class="item"
      :class="{ active: threads.activePubkey === c.publickey }"
      @click="emit('select', c.publickey)"
    >
      <div class="row">
        <span :class="['dot', c.online ? 'on' : 'off']"></span>
        <span class="name">{{ c.nickname }}</span>
        <span
          v-if="c.rating.value != null"
          :class="['stars', c.rating.source]"
          @click.stop="emit('rate', c.publickey)"
          :title="c.rating.source === 'mine' ? 'Tu calificación' : 'Calificación derivada'"
        >{{ stars(c.rating.value) }}</span>
      </div>
      <div class="snippet" v-if="c.lastText">{{ c.lastText }}</div>
      <div class="snippet muted" v-else>Sin mensajes</div>
    </div>
  </div>
</template>

<style scoped>
.list { flex: 1; overflow-y: auto; }
.item {
  padding: 10px 14px; cursor: pointer; border-bottom: 1px solid var(--border);
}
.item:hover, .item.active { background: var(--bg-3); }
.row { display: flex; align-items: center; gap: 8px; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot.on  { background: #4caf50; }
.dot.off { background: #555; }
.name { font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.snippet {
  font-size: 13px; color: var(--muted); margin-top: 4px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.snippet.muted { font-style: italic; }
.stars { font-size: 14px; cursor: pointer; }
.stars.mine    { color: var(--gold); }
.stars.derived { color: var(--derived); }
.empty { padding: 24px; text-align: center; color: var(--muted); font-size: 14px; }
</style>
