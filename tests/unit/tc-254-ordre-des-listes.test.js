import { describe, it, expect } from 'vitest'
import {
  sortDraftsDesc,
  sortHistoryDesc,
  instantDerniereAction,
  mergeHistoryPages,
} from '../../src/context/transactions.jsx'

/**
 * TC-254 — La dernière ligne traitée est toujours en haut.
 *
 * DEUX DÉFAUTS DISTINCTS, ET ILS NE SE RESSEMBLENT PAS
 * ────────────────────────────────────────────────────
 *   1. LES NON TERMINÉES N'ÉTAIENT PAS TRIÉES DU TOUT. `subscribeToDrafts` ne
 *      pose aucun `orderBy` : le snapshot arrive dans l'ordre des IDENTIFIANTS
 *      DE DOCUMENTS, c'est-à-dire un ordre alphabétique sur des chaînes
 *      aléatoires. La liste se réorganisait à chaque ajout et la ligne qu'on
 *      venait de noter atterrissait n'importe où.
 *
 *   2. L'HISTORIQUE ÉTAIT TRIÉ, MAIS SUR LA DATE DE SAISIE. Quand une non
 *      terminée est validée, le serveur recopie le `createdAt` du brouillon dans
 *      la ligne d'historique. Une opération notée le matin et validée le soir
 *      repartait donc se ranger au milieu de la matinée : le gérant venait de la
 *      traiter et devait la chercher.
 *
 * ⚠ CE QUI NE DOIT PAS CHANGER : le champ `date`. Les filtres par journée s'en
 *   servent, et une opération doit rester comptée le jour où elle a eu lieu.
 *   Seul l'ORDRE D'AFFICHAGE suit la dernière action.
 */

const horodatage = (ms) => ({ toMillis: () => ms })

const MATIN = Date.UTC(2026, 9, 13, 8, 0)
const MIDI = Date.UTC(2026, 9, 13, 12, 0)
const SOIR = Date.UTC(2026, 9, 13, 18, 0)

// ─────────────────────────────────────────────────────────────────────────────

describe('TC-254 — les non terminées', () => {
  it('[TC-254-01] la dernière notée est en haut', () => {
    const brouillons = [
      { id: 'matin', createdAt: horodatage(MATIN) },
      { id: 'soir', createdAt: horodatage(SOIR) },
      { id: 'midi', createdAt: horodatage(MIDI) },
    ]
    expect(sortDraftsDesc(brouillons).map((t) => t.id)).toEqual(['soir', 'midi', 'matin'])
  })

  /** Le repli sur la date FR : une ligne hors ligne n'a pas encore son horodatage. */
  it('[TC-254-02] une ligne sans horodatage se classe par sa date écrite', () => {
    const brouillons = [
      { id: 'vieux', date: '01/10/2026 09:00' },
      { id: 'recent', date: '13/10/2026 09:00' },
    ]
    expect(sortDraftsDesc(brouillons).map((t) => t.id)).toEqual(['recent', 'vieux'])
  })

  /** Une ligne sans aucune date ne doit pas faire disparaître les autres. */
  it('[TC-254-03] une ligne sans date du tout finit en bas, sans rien casser', () => {
    const brouillons = [
      { id: 'sansDate' },
      { id: 'date', createdAt: horodatage(MATIN) },
    ]
    expect(sortDraftsDesc(brouillons).map((t) => t.id)).toEqual(['date', 'sansDate'])
  })

  it('[TC-254-04] ne modifie pas la liste reçue', () => {
    const brouillons = [{ id: 'a', createdAt: horodatage(MATIN) }, { id: 'b', createdAt: horodatage(SOIR) }]
    sortDraftsDesc(brouillons)
    expect(brouillons.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('[TC-254-05] une liste absente rend une liste vide', () => {
    expect(sortDraftsDesc(undefined)).toEqual([])
    expect(sortDraftsDesc(null)).toEqual([])
  })
})

describe('TC-254 — l’historique suit la dernière action', () => {
  /**
   * ⚠ LE CAS QUI A MOTIVÉ LE CHANGEMENT, à la lettre : saisie à 8 h, validée à
   *   18 h. Classée sur `createdAt`, elle se range à 8 h — sous dix heures
   *   d'opérations postérieures.
   */
  it('[TC-254-06] une opération du matin validée le soir remonte en tête', () => {
    const lignes = [
      { id: 'midi', createdAt: horodatage(MIDI) },
      { id: 'matinValideeLeSoir', createdAt: horodatage(MATIN), validatedAt: horodatage(SOIR) },
    ]
    expect(sortHistoryDesc(lignes).map((t) => t.id)).toEqual(['matinValideeLeSoir', 'midi'])
  })

  it('[TC-254-07] une ligne sans validation garde sa date de saisie pour s’ordonner', () => {
    expect(instantDerniereAction({ createdAt: horodatage(MATIN) })).toBe(MATIN)
  })

  it('[TC-254-08] la validation l’emporte quand elle est postérieure', () => {
    expect(instantDerniereAction({ createdAt: horodatage(MATIN), validatedAt: horodatage(SOIR) })).toBe(SOIR)
  })

  /**
   * ⚠ ON PREND LE PLUS RÉCENT DES DEUX, jamais aveuglément `validatedAt`. Une
   *   ligne validée immédiatement porte les deux à la même seconde, et une
   *   donnée aberrante (validation antérieure à la saisie) ne doit pas faire
   *   reculer la ligne dans la liste.
   */
  it('[TC-254-09] une validation antérieure à la saisie ne fait pas reculer la ligne', () => {
    expect(instantDerniereAction({ createdAt: horodatage(SOIR), validatedAt: horodatage(MATIN) })).toBe(SOIR)
  })

  it('[TC-254-10] accepte une Date ou une chaîne, pas seulement un horodatage Firestore', () => {
    expect(instantDerniereAction({ validatedAt: new Date(SOIR) })).toBe(SOIR)
    expect(instantDerniereAction({ validatedAt: new Date(SOIR).toISOString() })).toBe(SOIR)
  })

  it('[TC-254-11] une ligne sans aucune date vaut zéro, sans lever', () => {
    expect(instantDerniereAction({})).toBe(0)
    expect(instantDerniereAction(null)).toBe(0)
    expect(instantDerniereAction({ validatedAt: 'pas une date' })).toBe(0)
  })

  /** Les sources multiples sont fusionnées puis classées sur la même règle. */
  it('[TC-254-12] la fusion des pages classe aussi sur la dernière action', () => {
    const archives = [{ id: 'midi', createdAt: horodatage(MIDI) }]
    const validees = [{ id: 'matinValideeLeSoir', createdAt: horodatage(MATIN), validatedAt: horodatage(SOIR) }]
    expect(mergeHistoryPages(archives, validees).map((t) => t.id))
      .toEqual(['matinValideeLeSoir', 'midi'])
  })

  it('[TC-254-13] une ligne présente dans deux sources n’apparaît qu’une fois', () => {
    const ligne = { id: 'unique', createdAt: horodatage(MIDI) }
    expect(mergeHistoryPages([ligne], [ligne], [{ ...ligne }])).toHaveLength(1)
  })
})
