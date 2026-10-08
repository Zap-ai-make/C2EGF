import { describe, it, expect } from 'vitest'
import {
  instantDeDepart,
  formaterAttente,
  attenteDe,
  SEUIL_ALERTE_MS,
} from '../../src/utils/attente.js'

/**
 * TC-231 — Depuis combien de temps une transaction n'est pas terminée.
 *
 * CE QUE CES TESTS PROTÈGENT
 * ──────────────────────────
 * Un compteur faux est pire qu'un compteur absent : il a l'autorité d'un
 * chiffre. Deux manières de mentir, et aucune ne se voit à l'œil :
 *
 *   — repartir de zéro sur une ligne qui attend depuis trois heures, parce que
 *     la source d'horodatage n'a pas été trouvée. La caissière conclurait que
 *     personne n'attend.
 *   — afficher une durée négative quand l'horloge du navigateur est en retard
 *     sur celle du serveur, ce qui arrive sur un téléphone mal réglé.
 *
 * Et une propriété de forme : tout est PUR. `maintenant` est un paramètre, pas
 * un `Date.now()` lu à l'intérieur — sinon ces tests ne testeraient que le
 * trucage d'une horloge.
 */

const SECONDE = 1000
const MINUTE = 60 * SECONDE
const HEURE = 60 * MINUTE
const JOUR = 24 * HEURE

const T0 = new Date('2026-10-08T14:24:00Z').getTime()

describe('TC-231 — d’où part le compteur', () => {
  it('[TC-231-1] du createdAt serveur, à la milliseconde', () => {
    const horodatage = { toMillis: () => T0 }
    expect(instantDeDepart({ createdAt: horodatage })).toBe(T0)
  })

  it('[TC-231-2] d’une Date, quand c’est le marquage optimiste local', () => {
    expect(instantDeDepart({ createdAt: new Date(T0) })).toBe(T0)
  })

  /**
   * Les brouillons d'avant ce champ n'ont que la date FR, à la minute. C'est
   * moins précis, et c'est très suffisant : on compte des minutes d'attente.
   */
  it('[TC-231-3] à défaut, de la date française', () => {
    const depart = instantDeDepart({ date: '08/10/2026 14:24' })
    expect(depart).not.toBeNull()
    expect(new Date(depart).getMinutes()).toBe(24)
  })

  it('[TC-231-4] préfère createdAt à la date française', () => {
    const avecLesDeux = { createdAt: { toMillis: () => T0 }, date: '01/01/2020 08:00' }
    expect(instantDeDepart(avecLesDeux)).toBe(T0)
  })

  /**
   * ⚠ LA PROPRIÉTÉ QUI ÉVITE LE MENSONGE LE PLUS COÛTEUX.
   *   Sans source lisible, renvoyer 0 ou `Date.now()` ferait afficher
   *   « 00:00:00 » sur une ligne qui attend depuis trois heures. Ne rien
   *   afficher est la seule réponse honnête.
   */
  it('[TC-231-5] renvoie null quand rien n’est lisible', () => {
    expect(instantDeDepart({})).toBeNull()
    expect(instantDeDepart({ createdAt: 'pas une date' })).toBeNull()
    expect(instantDeDepart(null)).toBeNull()
  })
})

describe('TC-231 — la mise en forme', () => {
  it('[TC-231-6] compte les secondes sous une heure', () => {
    expect(formaterAttente(12 * MINUTE + 34 * SECONDE)).toBe('00:12:34')
  })

  it('[TC-231-7] compte les heures sous un jour', () => {
    expect(formaterAttente(3 * HEURE + 5 * MINUTE + 9 * SECONDE)).toBe('03:05:09')
  })

  it('[TC-231-8] passe en jours au-delà de 24 h', () => {
    // « 76:12:00 » se déchiffre ; « 3j 04:12 » se lit.
    expect(formaterAttente(3 * JOUR + 4 * HEURE + 12 * MINUTE)).toBe('3j 04:12')
  })

  it('[TC-231-9] bascule pile à 24 h', () => {
    expect(formaterAttente(JOUR - SECONDE)).toBe('23:59:59')
    expect(formaterAttente(JOUR)).toBe('1j 00:00')
  })

  /**
   * ⚠ Un téléphone mal réglé donne une horloge locale en retard sur le serveur,
   *   donc un écart NÉGATIF. « -00:00:03 » ferait douter du reste de l'écran.
   */
  it('[TC-231-10] plafonne à zéro plutôt que d’afficher un négatif', () => {
    expect(formaterAttente(-5000)).toBe('00:00:00')
    expect(formaterAttente(NaN)).toBe('00:00:00')
  })
})

describe('TC-231 — le seuil d’alerte', () => {
  const ligne = { createdAt: { toMillis: () => T0 } }

  it('[TC-231-11] une demi-heure, pas une de plus', () => {
    expect(SEUIL_ALERTE_MS).toBe(30 * MINUTE)
  })

  it('[TC-231-12] ne s’allume pas à 29 minutes 59', () => {
    const attente = attenteDe(ligne, T0 + 29 * MINUTE + 59 * SECONDE)
    expect(attente.enRetard).toBe(false)
    expect(attente.texte).toBe('00:29:59')
  })

  it('[TC-231-13] s’allume à 30 minutes pile', () => {
    expect(attenteDe(ligne, T0 + 30 * MINUTE).enRetard).toBe(true)
  })

  it('[TC-231-14] ne rend rien quand la ligne n’a pas d’origine', () => {
    expect(attenteDe({}, T0)).toBeNull()
  })

  it('[TC-231-15] une horloge en retard ne fait pas d’une ligne neuve un retard', () => {
    const attente = attenteDe(ligne, T0 - 10 * MINUTE)
    expect(attente.enRetard).toBe(false)
    expect(attente.texte).toBe('00:00:00')
  })
})
