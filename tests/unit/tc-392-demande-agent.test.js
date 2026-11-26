import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  clientDeFiche,
  codeReseauDeFiche,
  demandeRendue,
} from '../../functions/src/oxygen/demande.js'

/**
 * TC-392 — Les demandes d'opération lancées par l'agent : ce qui ne touche pas
 * Firestore (functions/src/oxygen/demande.js), et les index qu'exigent les
 * requêtes du point d'entrée.
 *
 * Spec : docs/superpowers/specs/2026-11-17-demandes-agent-design.md §5.1, §5.4.
 */

const instant = (ms) => ({ toMillis: () => ms })

describe('TC-392 — la demande, hors de Firestore', () => {
  it('[TC-392-01] demandeRendue : dates en ms, null quand absentes, rien d’autre', () => {
    expect(demandeRendue('k1', {
      boutiqueId: 'b1', boutiqueNom: 'B1', sens: 'depot', reseau: 'Orange', montant: 5000,
      etat: 'en_attente', creeLe: instant(1000), reponduLe: null, compteOxygen: 'x', clientId: 'c',
      agent: { nom: 'KABORE' }, liaisonId: 'L1',
    })).toEqual({
      id: 'k1', boutiqueId: 'b1', boutiqueNom: 'B1', sens: 'depot', reseau: 'Orange', montant: 5000,
      etat: 'en_attente', creeLe: 1000, reponduLe: null, operationId: null, nature: 'operation',
    })
    expect(demandeRendue('k2', { etat: 'validee', creeLe: instant(1000), reponduLe: instant(2000), operationId: 'k2' }))
      .toMatchObject({ reponduLe: 2000, operationId: 'k2' })
  })

  it('[TC-392-02] codeReseauDeFiche lit le champ du réseau, espaces retirés ; vide sans code', () => {
    expect(codeReseauDeFiche({ orange: ' 70123456 ' }, 'Orange')).toBe('70123456')
    expect(codeReseauDeFiche({ nom: 'A' }, 'Orange')).toBe('')
    expect(codeReseauDeFiche(null, 'Orange')).toBe('')
  })

  it('[TC-392-06] sans champ `orange`, le compte Orange se dérive comme à l’app : le code agent, à défaut le numéro', () => {
    // normaliserChampsAgent (src/services/firestore.js) écrit orange = codeAgent || numeroAgent ;
    // une fiche écrite hors de l'app (script, import) peut ne pas le porter.
    expect(codeReseauDeFiche({ codeAgent: '1234567', numeroAgent: '70112233' }, 'Orange')).toBe('1234567')
    expect(codeReseauDeFiche({ codeAgent: '', numeroAgent: '70112233' }, 'Orange')).toBe('70112233')
    expect(codeReseauDeFiche({ codeAgent: '', numeroAgent: '' }, 'Orange')).toBe('')
    expect(codeReseauDeFiche({ orange: '7654321', codeAgent: '1234567' }, 'Orange')).toBe('7654321')
  })

  it('[TC-392-03] clientDeFiche garde les seules clés présentes', () => {
    expect(clientDeFiche('c1', { nom: 'KABORE', prenom: 'Awa', orange: '7012', telephone: '1' }))
      .toEqual({ id: 'c1', nom: 'KABORE', prenom: 'Awa', orange: '7012' })
    // Le compte Orange dérivé y entre : le formulaire le relit pour « Modifier ».
    expect(clientDeFiche('c2', { codeAgent: '123', numeroAgent: '70000000' }))
      .toEqual({ id: 'c2', codeAgent: '123', numeroAgent: '70000000', orange: '123' })
  })
})

const index = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'))
const composite = (collectionGroup, champs) => index.indexes.some((i) =>
  i.collectionGroup === collectionGroup
  && i.queryScope === 'COLLECTION_GROUP'
  && JSON.stringify(i.fields) === JSON.stringify(champs))

describe('TC-392 — une requête de demandes, un index', () => {
  it('[TC-392-04] lireDemandes, en attente : demandesAgent.where(compteOxygen).where(etat)', () => {
    expect(composite('demandesAgent', [
      { fieldPath: 'compteOxygen', order: 'ASCENDING' },
      { fieldPath: 'etat', order: 'ASCENDING' },
    ])).toBe(true)
  })

  it('[TC-392-05] lireDemandes, fermées : demandesAgent.where(compteOxygen).where(reponduLe >=).orderBy(reponduLe desc)', () => {
    expect(composite('demandesAgent', [
      { fieldPath: 'compteOxygen', order: 'ASCENDING' },
      { fieldPath: 'reponduLe', order: 'DESCENDING' },
    ])).toBe(true)
  })
})
