<script setup>
import { ref, computed, onMounted } from 'vue'
import { useContactsStore } from '../stores/contactsStore'
import { useThreadsStore } from '../stores/threadsStore'

const props = defineProps({ pubkey: { type: String, required: true } })
const emit  = defineEmits(['close'])

const contacts = useContactsStore()
const threads = useThreadsStore()

const contact = computed(() => contacts.findByPubkey(props.pubkey))
const peer = computed(() => contacts.peerFor(props.pubkey))
const myRating = ref(contacts.myRatingFor(props.pubkey) || 0)
const notes = ref(peer.value?.myRating?.notes || '')
const error = ref('')
const saving = ref(false)

const derived = computed(() => contacts.ratingFor(props.pubkey))
const endorsements = computed(() => peer.value?.endorsements || [])

const setStars = (n) => { myRating.value = n }

const save = async () => {
  error.value = ''
  saving.value = true
  try {
    await contacts.ratePeer(props.pubkey, myRating.value, notes.value)
    emit('close')
  } catch (e) {
    error.value = e.message || 'Error al guardar'
  } finally {
    saving.value = false
  }
}

const askPeers = () => threads.askRatingsAbout(props.pubkey)

onMounted(() => {
  contacts.refreshPeers()
  // Optionally kick a query to refresh endorsements
  askPeers()
})

const stars = (n) => {
  const v = Math.round(n || 0)
  return '★'.repeat(v) + '☆'.repeat(5 - v)
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal">
      <h2>Calificar a {{ contact?.nickname || 'contacto' }}</h2>

      <div class="row summary">
        <div>
          <div class="label">Tu calificación</div>
          <div class="stars-row">
            <span
              v-for="n in 5"
              :key="n"
              class="star"
              :class="{ filled: n <= myRating }"
              @click="setStars(n)"
            >★</span>
            <button class="clear" v-if="myRating > 0" @click="setStars(0)">Quitar</button>
          </div>
        </div>
        <div>
          <div class="label">Derivada (web of trust)</div>
          <div class="derived">
            <span v-if="derived.value != null" class="stars-derived">{{ stars(derived.value) }}</span>
            <span v-else class="muted">Sin datos</span>
            <span v-if="derived.count" class="count">({{ derived.count }} endosos)</span>
          </div>
        </div>
      </div>

      <label class="notes">
        <span>Notas (privadas, no se firman):</span>
        <textarea v-model="notes" rows="2" maxlength="300" placeholder="Opcional"></textarea>
      </label>

      <div class="endorsements" v-if="endorsements.length">
        <h4>Endosos recibidos</h4>
        <ul>
          <li v-for="(e, i) in endorsements" :key="i">
            <code class="key">{{ (e.ratedBy || '').slice(0, 12) }}…</code>
            <span class="r">{{ stars(e.rating) }}</span>
            <span class="when">{{ e.issuedAt ? new Date(e.issuedAt).toLocaleDateString() : '' }}</span>
          </li>
        </ul>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <div class="actions">
        <button class="btn secondary" @click="askPeers">Refrescar endosos</button>
        <button class="btn secondary" @click="emit('close')">Cancelar</button>
        <button class="btn" :disabled="saving" @click="save">Guardar</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.row.summary { display: flex; gap: 24px; margin: 12px 0; flex-wrap: wrap; }
.label { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.stars-row { display: flex; gap: 2px; align-items: center; }
.star {
  font-size: 28px; cursor: pointer; color: var(--bg-4);
  transition: color 0.1s;
}
.star.filled { color: var(--gold); }
.clear { background: transparent; border: 0; color: var(--muted); margin-left: 8px; cursor: pointer; }
.derived { display: flex; align-items: center; gap: 8px; height: 38px; }
.stars-derived { font-size: 22px; color: var(--derived); }
.count { font-size: 12px; color: var(--muted); }
.muted { color: var(--muted); }
.notes { display: block; margin: 12px 0; }
.notes textarea { width: 100%; margin-top: 4px; }
.endorsements h4 { margin: 16px 0 6px; font-size: 14px; }
.endorsements ul { list-style: none; padding: 0; max-height: 120px; overflow-y: auto; }
.endorsements li {
  display: flex; gap: 8px; align-items: center;
  font-size: 13px; padding: 4px 0; border-bottom: 1px solid var(--border);
}
.endorsements .key { background: var(--bg-3); padding: 1px 5px; border-radius: 3px; font-family: monospace; }
.endorsements .r { color: var(--gold); }
.endorsements .when { color: var(--muted); margin-left: auto; font-size: 11px; }
.error { color: var(--danger); font-size: 13px; }
</style>
