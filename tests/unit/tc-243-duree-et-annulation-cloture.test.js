import { describe, it, expect } from 'vitest'
import { dureeDe, instantDArrivee, formaterHeure } from '../../src/utils/attente.js'
import { reverseClosureImpact } from '../../functions/src/settlements/financialUtils.js'

/**
 * TC-243 — Le chronomètre arrêté, et l'inverse d'une clôture.
 *
 * DEUX SUJETS, UN SEUL FICHIER
 * ────────────────────────────
 * Ils viennent du même lot et partagent sa question : que vaut une opération
 * UNE FOIS FAITE ? La durée répond « combien de temps elle a pris » ; l'inverse
 * d'une clôture répond « ce qu'il faut rendre pour qu'elle n'ait pas eu lieu ».
 * Les deux sont purs, et c'est ce qui permet de les éprouver sans horloge
 * truquée ni émulateur.
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

// ─────────────────────────────────────────────────────────────────────────────
// 2. L'inverse d'une clôture
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-243 — défaire une clôture rend ce qu’elle a pris', () => {
  const soldes = [
    { network: 'Orange', stock: 500_000, liquidite: 300_000 },
    { network: 'Moov', stock: 200_000, liquidite: 0 },
  ]

  it('[TC-243-10] chaque réserve revient sur son réseau', () => {
    const apres = reverseClosureImpact({
      Orange: { stock: 0, liquidite: 0 },
      Moov: { stock: 0, liquidite: 0 },
    }, soldes)

    expect(apres.Orange).toEqual({ stock: 500_000, liquidite: 300_000 })
    expect(apres.Moov).toEqual({ stock: 200_000, liquidite: 0 })
  })

  /**
   * ⚠ ON AJOUTE, ON NE RESTAURE PAS UN ÉTAT.
   *   La boutique continue de travailler après une clôture. Écraser les soldes
   *   courants avec ceux d'avant effacerait tout ce qui s'est passé depuis —
   *   ici, un ravitaillement de 1 000 000 reçu après la clôture.
   */
  it('[TC-243-11] ce qui est arrivé depuis n’est pas effacé', () => {
    const apres = reverseClosureImpact({
      Orange: { stock: 1_000_000, liquidite: 50_000 },
    }, [{ network: 'Orange', stock: 500_000, liquidite: 300_000 }])

    expect(apres.Orange).toEqual({ stock: 1_500_000, liquidite: 350_000 })
  })

  it('[TC-243-12] un réseau absent des soldes courants repart de zéro', () => {
    const apres = reverseClosureImpact({}, [{ network: 'Orange', stock: 7_000, liquidite: 0 }])

    expect(apres.Orange).toMatchObject({ stock: 7_000 })
  })

  it('[TC-243-13] les soldes d’entrée ne sont pas modifiés', () => {
    const avant = { Orange: { stock: 10, liquidite: 20 } }
    reverseClosureImpact(avant, [{ network: 'Orange', stock: 5, liquidite: 5 }])

    expect(avant).toEqual({ Orange: { stock: 10, liquidite: 20 } })
  })
})

describe('TC-243 — ce que l’inverse refuse', () => {
  /**
   * ⚠ SON INVERSE EST INCONNAISSABLE, ET C'EST POURQUOI ON REFUSE.
   *   Une clôture d'avant l'enregistrement du détail par réseau ne porte que son
   *   total. Le répartir au jugé rendrait un chiffre plausible et faux dès que
   *   la boutique opère plus d'un réseau — et personne ne le verrait.
   */
  it('[TC-243-14] une clôture sans détail par réseau', () => {
    expect(() => reverseClosureImpact({}, undefined)).toThrow(/inconnaissable/i)
    expect(() => reverseClosureImpact({}, [])).toThrow(/inconnaissable/i)
  })

  it('[TC-243-15] un solde sans réseau', () => {
    expect(() => reverseClosureImpact({}, [{ stock: 10, liquidite: 0 }])).toThrow(/sans reseau/i)
  })

  it('[TC-243-16] un solde négatif', () => {
    expect(() => reverseClosureImpact({}, [{ network: 'Orange', stock: -1, liquidite: 0 }]))
      .toThrow(/negatif/i)
  })
})
