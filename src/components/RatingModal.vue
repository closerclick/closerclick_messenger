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
const myRating = ref(contacts.myRatingFor(props.pubkey) || 0)   // confianza
const myAfinidad = ref(0)                                       // me interesa/sigo/conozco
const notes = ref(peer.value?.myRating?.notes || '')
const error = ref('')
const saving = ref(false)
const hover = ref(0)
const hoverAfin = ref(0)

const derived = computed(() => contacts.ratingFor(props.pubkey))
const endorsements = computed(() => peer.value?.endorsements || [])
const online = computed(() => contacts.isOnline(props.pubkey))

// Reputación del registro COMPARTIDO (reputation.closer.click), ponderada por mi
// web-of-trust (anti-sybil): el flood de desconocidos no mueve la aguja.
const cloudRep = ref(null)
const cloudLoading = ref(true)
async function loadCloudRep () {
  cloudLoading.value = true
  cloudRep.value = await contacts.cloudReputationFor(props.pubkey)
  cloudLoading.value = false
}

const setStars = (n) => { myRating.value = n }
const setAfin = (n) => { myAfinidad.value = n }

const save = async () => {
  error.value = ''
  saving.value = true
  try {
    const indicators = { confianza: myRating.value }
    if (myAfinidad.value > 0) indicators.afinidad = myAfinidad.value
    await contacts.ratePeer(props.pubkey, indicators, notes.value)
    emit('close')
  } catch (e) {
    error.value = e.message || 'Error al guardar'
  } finally {
    saving.value = false
  }
}

const askPeers = () => threads.askRatingsAbout(props.pubkey)

onMounted(async () => {
  contacts.refreshPeers()
  askPeers()
  loadCloudRep()
  // Precargar mi afinidad existente (desde mi atestación en el registro).
  const mine = await contacts.myIndicatorsFor(props.pubkey)
  if (typeof mine.afinidad === 'number') myAfinidad.value = mine.afinidad
})

const cloudPct = computed(() => cloudRep.value?.score != null ? Math.round(cloudRep.value.score * 100) : null)

const stars = (n) => {
  const v = Math.round(n || 0)
  return '★'.repeat(v) + '☆'.repeat(5 - v)
}

const labels = ['', 'Sospechoso', 'Dudoso', 'Confiable', 'Muy confiable', 'De total confianza']
const ratingLabel = computed(() => labels[hover.value || myRating.value] || 'Sin calificar')

const initials = (s) => (s || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase()

const palette = [
  '#9c7a8c', '#c89738', '#5a8a3a', '#a37a45',
  '#6b8a9c', '#c0392b', '#7a6b5d', '#b8773d'
]
const avatarBg = (key) => {
  const s = key || ''
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }) : ''
const knownSince = computed(() => fmtDate(peer.value?.firstSeen))
const shortKey = computed(() => {
  const k = props.pubkey || ''
  return k.length > 20 ? k.slice(0, 12) + '…' + k.slice(-4) : k
})
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal">
      <header class="head">
        <h2>Calificar contacto</h2>
        <button class="x" @click="emit('close')" aria-label="Cerrar">×</button>
      </header>

      <div class="body">
        <!-- Identidad -->
        <div class="identity">
          <div class="avatar-wrap">
            <div class="avatar" :style="{ background: avatarBg(pubkey) }">
              {{ initials(contact?.nickname) }}
            </div>
            <span v-if="online" class="online-dot"></span>
          </div>
          <div class="identity-text">
            <div class="name">{{ contact?.nickname || 'Contacto' }}</div>
            <code class="pubkey">{{ shortKey }}</code>
            <div v-if="knownSince" class="since">Conocido desde {{ knownSince }}</div>
          </div>
        </div>

        <!-- Confianza -->
        <div class="section">
          <span class="section-label">Confianza <small>(¿qué tan confiable/íntegro es?)</small></span>
          <div class="stars-row" @mouseleave="hover = 0">
            <button
              v-for="n in 5"
              :key="n"
              type="button"
              class="star-btn"
              :class="{ filled: n <= (hover || myRating) }"
              @click="setStars(n)"
              @mouseenter="hover = n"
            >★</button>
          </div>
          <div class="rating-meta">
            <span class="rating-num">{{ hover || myRating || 0 }} / 5</span>
            <span v-if="ratingLabel" class="rating-label">— {{ ratingLabel }}</span>
            <button v-if="myRating > 0 && !hover" class="clear" @click="setStars(0)">Quitar</button>
          </div>
        </div>

        <!-- Afinidad -->
        <div class="section">
          <span class="section-label">Afinidad <small>(me interesa / sigo / conozco)</small></span>
          <div class="stars-row" @mouseleave="hoverAfin = 0">
            <button
              v-for="n in 5"
              :key="n"
              type="button"
              class="star-btn afin"
              :class="{ filled: n <= (hoverAfin || myAfinidad) }"
              @click="setAfin(n)"
              @mouseenter="hoverAfin = n"
            >★</button>
          </div>
          <div class="rating-meta">
            <span class="rating-num">{{ hoverAfin || myAfinidad || 0 }} / 5</span>
            <button v-if="myAfinidad > 0 && !hoverAfin" class="clear" @click="setAfin(0)">Quitar</button>
          </div>
        </div>

        <!-- Notes -->
        <label class="section">
          <span class="section-label">Notas privadas (solo para ti)</span>
          <textarea
            v-model="notes"
            rows="3"
            maxlength="500"
            placeholder="ej. Lo conocí jugando ajedrez. Cumple con su palabra."
          />
          <span class="counter">{{ notes.length }} / 500</span>
        </label>

        <!-- Web of trust -->
        <div class="wot">
          <div class="wot-head">
            <span class="wot-title">Lo que dicen otros (Web of Trust)</span>
            <button class="refresh" @click="askPeers" title="Refrescar endosos">↻</button>
          </div>
          <div v-if="endorsements.length === 0" class="wot-empty">
            Sin endorsements firmados todavía.
          </div>
          <div v-else>
            <div class="wot-summary">
              <span class="stars derived">{{ stars(derived.value) }}</span>
              <span class="wot-num">{{ derived.value?.toFixed(1) }}</span>
              <span class="wot-count">({{ endorsements.length }} endosos)</span>
            </div>
            <ul class="endorsements">
              <li v-for="(e, i) in endorsements.slice(0, 5)" :key="i">
                <code class="key">{{ (e.ratedBy || '').slice(0, 12) }}…</code>
                <span class="r">{{ stars(e.rating) }}</span>
                <span class="when">{{ fmtDate(e.issuedAt) }}</span>
              </li>
            </ul>
          </div>
        </div>

        <!-- Reputación del registro compartido (ponderada por tu web-of-trust) -->
        <div class="cloud">
          <div class="cloud-head">
            <span class="cloud-title">Reputación de la red</span>
            <button class="refresh" @click="loadCloudRep" title="Refrescar">↻</button>
          </div>
          <div v-if="cloudLoading" class="cloud-empty">Consultando…</div>
          <template v-else-if="cloudRep">
            <div v-if="cloudRep.score != null" class="cloud-summary">
              <span class="cloud-ind">Confianza</span>
              <span class="stars derived">{{ stars(cloudRep.score * 5) }}</span>
              <span class="wot-num">{{ cloudPct }}%</span>
              <span class="cloud-count">{{ cloudRep.trustedCount }} de tu red{{ cloudRep.txBoundCount ? ` · ${cloudRep.txBoundCount} con recibo` : '' }}</span>
            </div>
            <div v-if="cloudRep.indicators && cloudRep.indicators.afinidad && cloudRep.indicators.afinidad.score != null" class="cloud-summary">
              <span class="cloud-ind">Afinidad</span>
              <span class="stars derived afin">{{ stars(cloudRep.indicators.afinidad.score * 5) }}</span>
              <span class="wot-num">{{ Math.round(cloudRep.indicators.afinidad.score * 100) }}%</span>
              <span class="cloud-count">{{ cloudRep.indicators.afinidad.trustedCount }} de tu red</span>
            </div>
            <div v-if="cloudRep.score == null && cloudRep.rawCount > 0" class="cloud-weak">
              {{ cloudRep.rawCount }} reseña(s), <strong>ninguna de tu red</strong> — señal débil.
            </div>
            <div v-else-if="cloudRep.score == null && cloudRep.rawCount === 0" class="cloud-empty">Sin reputación en el registro todavía.</div>
          </template>
          <div v-else class="cloud-empty">Registro no disponible.</div>
        </div>

        <p class="privacy">
          ⌬ Tu rating se firma con tu clave privada, se comparte con peers de confianza y se publica en el registro de reputación.
        </p>

        <p v-if="error" class="error">{{ error }}</p>
      </div>

      <footer class="foot">
        <button class="btn secondary" @click="emit('close')">Cancelar</button>
        <button class="btn" :disabled="saving" @click="save">
          {{ saving ? 'Guardando…' : 'Guardar calificación' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal { max-width: 460px; }

.head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 24px;
  border-bottom: 1px solid var(--border);
}
.x {
  background: transparent; border: 0;
  font-size: 24px; cursor: pointer;
  color: var(--muted);
  width: 32px; height: 32px;
  border-radius: 8px;
}
.x:hover { background: var(--bg-3); color: var(--text); }

.body { padding: 20px 24px; display: flex; flex-direction: column; gap: 20px; max-height: 70vh; overflow-y: auto; }

/* ----- Identity ----- */
.identity {
  display: flex; gap: 14px; align-items: center;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px;
}
.avatar-wrap { position: relative; flex-shrink: 0; }
.avatar {
  width: 56px; height: 56px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #ffffff;
  font-family: var(--font-headline);
  font-weight: 600;
  font-size: 18px;
}
.online-dot {
  position: absolute;
  right: 0; bottom: 0;
  width: 14px; height: 14px;
  border-radius: 50%;
  background: var(--online);
  border: 2px solid var(--bg-2);
}
.identity-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.name {
  font-family: var(--font-headline);
  font-weight: 600;
  font-size: 17px;
  color: var(--text);
}
.pubkey {
  background: var(--bg-3);
  padding: 2px 8px;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--muted);
  width: fit-content;
}
.since { font-size: 12px; color: var(--muted); }

/* ----- Sections ----- */
.section { display: flex; flex-direction: column; gap: 6px; position: relative; }
.section-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
}
.stars-row {
  display: flex; gap: 6px;
  align-items: center;
}
.star-btn {
  background: transparent; border: 0;
  font-size: 36px;
  color: var(--bg-4);
  cursor: pointer;
  padding: 0;
  line-height: 1;
  transition: color 100ms ease-out, transform 100ms ease-out;
}
.star-btn:hover { transform: scale(1.1); }
.star-btn.afin.filled { color: var(--accent, #2dd4bf); }
.cloud-ind { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); min-width: 64px; }
.stars.afin { color: var(--accent, #2dd4bf); }
.star-btn.filled { color: var(--gold); text-shadow: 0 1px 2px rgba(212, 167, 44, 0.35); }

.rating-meta {
  display: flex; gap: 8px; align-items: center;
  font-size: 14px;
  color: var(--text);
  margin-top: 4px;
}
.rating-num { font-weight: 600; }
.rating-label { color: var(--muted); }
.clear {
  background: transparent; border: 0;
  color: var(--muted);
  cursor: pointer;
  font-size: 12px;
  margin-left: auto;
  text-decoration: underline;
}
.clear:hover { color: var(--accent); }

.section textarea {
  width: 100%;
  resize: vertical;
}
.counter {
  position: absolute;
  right: 8px; bottom: 8px;
  font-size: 11px;
  color: var(--muted);
  background: #ffffff;
  padding: 0 4px;
}

/* ----- Web of Trust ----- */
.wot {
  background: var(--bg-3);
  border-radius: 12px;
  padding: 14px;
}
.wot-head {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 10px;
}
.wot-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.refresh {
  background: transparent; border: 0;
  color: var(--muted); cursor: pointer;
  font-size: 16px;
  width: 24px; height: 24px;
  border-radius: 6px;
}
.refresh:hover { background: var(--bg-4); color: var(--text); }
.wot-empty { font-size: 13px; color: var(--muted); font-style: italic; }
.wot-summary {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 8px;
}
.stars { font-size: 16px; letter-spacing: 1px; }
.stars.derived { color: var(--derived); }
.wot-num {
  font-family: var(--font-headline);
  font-weight: 600;
  font-size: 14px;
  color: var(--text);
}
.wot-count { font-size: 12px; color: var(--muted); }

.cloud {
  background: var(--bg-3);
  border-radius: 12px;
  padding: 14px;
  margin-top: 12px;
}
.cloud-head {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 10px;
}
.cloud-title {
  font-size: 12px; font-weight: 600; color: var(--text);
  text-transform: uppercase; letter-spacing: 0.05em;
}
.cloud-summary { display: flex; align-items: center; gap: 8px; }
.cloud-count { font-size: 12px; color: var(--muted); }
.cloud-empty { font-size: 13px; color: var(--muted); font-style: italic; }
.cloud-weak { font-size: 13px; color: var(--muted); }

.endorsements {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 130px;
  overflow-y: auto;
}
.endorsements li {
  display: flex; gap: 8px; align-items: center;
  font-size: 12.5px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
}
.endorsements li:last-child { border-bottom: 0; }
.endorsements .key {
  background: var(--bg-2);
  padding: 1px 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted);
}
.endorsements .r { color: var(--derived); }
.endorsements .when { color: var(--muted); margin-left: auto; font-size: 11px; }

.privacy {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  text-align: center;
  line-height: 1.5;
}
.error {
  margin: 0;
  font-size: 13px;
  color: var(--accent);
  font-weight: 500;
}

/* ----- Footer ----- */
.foot {
  display: flex; gap: 10px; justify-content: flex-end;
  padding: 14px 24px;
  background: var(--bg-2);
  border-top: 1px solid var(--border);
}
</style>
