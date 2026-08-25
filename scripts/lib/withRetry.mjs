/**
 * Nouvelle tentative avec attente progressive pour opérations Firestore sur
 * réseau instable (coupures ECONNRESET/UNAVAILABLE intermittentes constatées
 * sur le poste d'administration).
 *
 * À réserver aux opérations idempotentes : lectures, suppressions,
 * écritures set() complètes. Jamais pour une opération à effet cumulatif.
 */
export async function withRetry(fn, label, { attempts = 6, log = (m) => console.warn(m) } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= attempts) throw err
      const delaySeconds = Math.min(30, 2 ** attempt)
      const reason = String(err.message || err).slice(0, 100)
      log(`  ⚠ réseau (${label}) : ${reason} — nouvel essai ${attempt}/${attempts - 1} dans ${delaySeconds}s`)
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000))
    }
  }
}
