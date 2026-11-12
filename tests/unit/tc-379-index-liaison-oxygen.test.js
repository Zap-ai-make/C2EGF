import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * TC-379 — Les index que le point d'entrée Oxygen exige.
 *
 * Même raison que TC-257 : l'émulateur crée les index à la volée, TC-377 passe
 * donc sans qu'aucun ne soit déclaré, et la production refuserait la requête
 * (FAILED_PRECONDITION) — que le serveur Oxygen lirait comme une panne. Une
 * table « requête ↔ index », partie des requêtes réelles de
 * functions/src/oxygen/pointEntreeOxygen.js.
 */

const index = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'))

const composite = (collectionGroup, champs) => index.indexes.some((i) =>
  i.collectionGroup === collectionGroup
  && i.queryScope === 'COLLECTION_GROUP'
  && JSON.stringify(i.fields) === JSON.stringify(champs))

const override = (collectionGroup, fieldPath) =>
  index.fieldOverrides.find((f) => f.collectionGroup === collectionGroup && f.fieldPath === fieldPath)

describe('TC-379 — une requête Oxygen, un index', () => {
  it('[TC-379-01] premier remplissage : history.where(clientId).where(createdAt >=).orderBy(createdAt desc)', () => {
    // L'index de TC-257-01, partagé : une inégalité sur le champ trié ne
    // demande rien de plus.
    expect(composite('history', [
      { fieldPath: 'clientId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ])).toBe(true)
  })

  it('[TC-379-02] synchronisation : history.where(clientId).where(updatedAt >=).orderBy(updatedAt asc)', () => {
    expect(composite('history', [
      { fieldPath: 'clientId', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'ASCENDING' },
    ])).toBe(true)
  })

  it('[TC-379-03] non terminées : drafts.where(clientId), en groupe de collections', () => {
    expect(override('drafts', 'clientId')?.indexes)
      .toContainEqual({ order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' })
  })

  /**
   * Les liaisons ne se cherchent que par ÉGALITÉS (cleVerrou, clientId,
   * compteOxygen, finLe == null) : Firestore les sert en fusionnant les index
   * automatiques d'un champ. Un `fieldOverride` sur l'un d'eux REMPLACERAIT cet
   * index automatique (TC-257) et casserait la fusion.
   */
  it('[TC-379-04] aucun override ne retire l’index automatique d’un champ cherché par égalité', () => {
    for (const [collectionGroup, champ] of [
      ['liaisonsOxygen', 'cleVerrou'], ['liaisonsOxygen', 'clientId'],
      ['liaisonsOxygen', 'compteOxygen'], ['liaisonsOxygen', 'finLe'],
      ['globalClients', 'codeAgent'], ['globalClients', 'numeroAgent'], ['globalClients', 'orange'],
    ]) {
      expect(override(collectionGroup, champ), `${collectionGroup}.${champ}`).toBeUndefined()
    }
  })
})
