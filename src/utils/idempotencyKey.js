/** Génère une clé stable à conserver pendant les nouvelles tentatives d'un même geste. */
export function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `intent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`
}
