import { describe, it, expect } from 'vitest'
import { dureeDe, instantDArrivee, formaterHeure } from '../../src/utils/attente.js'

/**
 * TC-243 — Le chronomètre arrêté.
 *
 * Que vaut une opération UNE FOIS FAITE ? La durée répond « combien de temps
 * elle a pris ». Elle est pure, et c'est ce qui permet de l'éprouver sans
 * horloge truquée ni émulateur.
 *
 * Ce fichier portait aussi l'inverse d'une clôture (TC-243-10 à 16) : retiré le
 * 31 octobre 2026 avec « Vider les soldes » et `reverseClosureImpact` (TC-318).
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. La durée — et surtout, quand il n'y en a pas
// ─────────────────────────────────────────────────────────────────────────────

const MINUTE = 60_000
const DEPART = Date.UTC(2026, 9, 9, 14, 24, 0)

/** Un horodatage Firestore, tel que le serveur le renvoie. */
const horodatage = (ms) => ({ toMillis: () => ms })

describe('TC-243 — une transaction qui a attendu', () => {
  it('[TC-243-1] rend le départ, l’arrivée et la durée', () => {
    const duree = dureeDe({
      createdAt: horodatage(DEPART),
      validatedAt: horodatage(DEPART + 7 * MINUTE + 12_000),
    })

    expect(duree).toMatchObject({ debut: DEPART, ms: 7 * MINUTE + 12_000, texte: '00:07:12' })
  })

  it('[TC-243-2] une attente de plus d’un jour se lit en jours', () => {
    const duree = dureeDe({
      createdAt: horodatage(DEPART),
      validatedAt: horodatage(DEPART + 3 * 24 * 3_600_000 + 4 * 3_600_000),
    })

    expect(duree.texte).toBe('3j 04:00')
  })

  it('[TC-243-3] les Date brutes du marquage optimiste comptent aussi', () => {
    const duree = dureeDe({
      createdAt: new Date(DEPART),
      validatedAt: new Date(DEPART + 90_000),
    })

    expect(duree.texte).toBe('00:01:30')
  })
})

describe('TC-243 — une transaction qui n’a pas attendu', () => {
  /**
   * ⚠ LE DISCERNEMENT DE TOUT CE LOT, ET IL EST DÉJÀ DANS LES DONNÉES.
   *   Une transaction validée d'un geste au formulaire n'est jamais passée par
   *   les non terminées : le serveur l'écrit directement dans l'historique
   *   (action `add`, branche validée) avec un `createdAt` et SANS `validatedAt`.
   *   Personne n'a attendu, donc il n'y a rien à afficher — et aucun seuil
   *   arbitraire n'a eu à être inventé pour le deviner.
   */
  it('[TC-243-4] une validation directe n’a pas de durée', () => {
    expect(dureeDe({ createdAt: horodatage(DEPART), directValidation: true })).toBeNull()
  })

  /**
   * Un ravitaillement, un retour, une clôture : créés et validés dans la MÊME
   * écriture serveur, donc au même instant à la milliseconde. « 00:00:00 »
   * ferait lire une mesure là où il n'y a rien à mesurer.
   */
  it('[TC-243-5] une ligne créée et validée d’un coup non plus', () => {
    expect(dureeDe({ createdAt: horodatage(DEPART), validatedAt: horodatage(DEPART) })).toBeNull()
  })

  it('[TC-243-6] ni une ligne dont on ne sait pas quand elle est née', () => {
    expect(dureeDe({ validatedAt: horodatage(DEPART) })).toBeNull()
    expect(dureeDe({})).toBeNull()
    expect(dureeDe(null)).toBeNull()
  })

  it('[TC-243-7] une arrivée illisible vaut une absence, pas une erreur', () => {
    expect(instantDArrivee({ validatedAt: 'pas une date' })).toBeNull()
    expect(instantDArrivee({})).toBeNull()
  })
})

describe('TC-243 — l’heure affichée', () => {
  it('[TC-243-8] se lit sur le fuseau de la boutique, pas sur celui du navigateur', () => {
    // Africa/Ouagadougou est à UTC+0 : 14:24 UTC s'y lit 14:24. Un navigateur
    // réglé ailleurs afficherait autre chose sans ce fuseau explicite.
    expect(formaterHeure(DEPART)).toBe('14:24')
  })

  it('[TC-243-9] une valeur illisible ne casse pas la cellule', () => {
    expect(formaterHeure(Number.NaN)).toBe('-')
  })
})
