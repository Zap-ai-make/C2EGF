/**
 * analyseAudit.mjs — la lecture d'un rapport `npm audit --json`, sans `npm`.
 *
 * Sortie de `scripts/auditWithExceptions.mjs` pour être testée (TC-325) : le
 * script ne garde que l'appel à `npm audit` et l'affichage.
 *
 * ⚠ Piège 3 (3 novembre 2026) : UN SEUL AUDIT NE SUFFIT PAS À DÉCLARER UNE
 *   EXCEPTION PÉRIMÉE. Deux fois sur deux, la première passe après un
 *   `npm install` a rendu un rapport sans l'avis excepté ; la passe suivante
 *   l'avait. Le script annonçait alors « à RETIRER » une exception encore
 *   nécessaire. `confirmerAudit` relance donc l'audit une fois avant de
 *   conclure, et rend le nombre d'avis reçus pour qu'une réponse vide se voie.
 */

export const SEUIL_BLOQUANT = ['high', 'critical']

/**
 * Le rapport, ou la raison de le refuser. Un rapport sans
 * `metadata.vulnerabilities` n'est pas « aucun avis » : c'est une réponse
 * qu'on ne sait pas lire.
 *
 * @param {string} sortie  la sortie standard de `npm audit --json`
 * @returns {{rapport: object} | {erreur: string}}
 */
export function lireRapport(sortie) {
  if (!sortie || !sortie.trim()) return { erreur: 'aucune sortie' }
  let rapport
  try {
    rapport = JSON.parse(sortie)
  } catch {
    return { erreur: 'sortie illisible' }
  }
  if (!rapport?.metadata?.vulnerabilities) return { erreur: 'rapport incomplet (pas de metadata)' }
  return { rapport }
}

/**
 * Les exceptions actives, les exceptions périmées et les avis bloquants d'un
 * rapport.
 *
 * @param {object} rapport  un rapport lu par `lireRapport`
 * @param {Array<{avis: string, paquet: string}>} exceptions  celles du répertoire audité
 */
export function analyserAudit(rapport, exceptions) {
  // ⚠ Piège 1 : la sévérité d'un AVIS et celle de son PAQUET diffèrent. On
  //   recense TOUS les avis, puis on ne bloque que sur le seuil. Filtrer avant
  //   de recenser faisait passer un avis listé pour une exception périmée.
  const identifiantsVus = new Set()
  const bloquants = []

  for (const [paquet, details] of Object.entries(rapport.vulnerabilities ?? {})) {
    for (const via of details.via ?? []) {
      if (typeof via !== 'object') continue

      const avis = (via.url ?? '').split('/').pop()
      if (avis) identifiantsVus.add(avis)

      if (!SEUIL_BLOQUANT.includes(via.severity)) continue
      if (exceptions.some((e) => e.avis === avis)) continue
      bloquants.push(`${paquet} — ${via.severity} — ${avis} — ${via.title}`)
    }
  }

  return {
    actives: exceptions.filter((e) => identifiantsVus.has(e.avis)),
    perimees: exceptions.filter((e) => !identifiantsVus.has(e.avis)),
    bloquants,
    recus: rapport.metadata?.vulnerabilities?.total ?? 0,
  }
}

/**
 * Analyse un audit, et le relance UNE fois si une exception y semble périmée
 * (piège 3). Le second audit fait foi.
 *
 * @param {() => object} auditer  rend un rapport lu par `lireRapport` (lève si l'audit échoue)
 * @param {Array<{avis: string, paquet: string}>} exceptions
 */
export function confirmerAudit(auditer, exceptions) {
  const premier = analyserAudit(auditer(), exceptions)
  if (premier.perimees.length === 0) return { ...premier, essais: 1 }
  return { ...analyserAudit(auditer(), exceptions), essais: 2 }
}
