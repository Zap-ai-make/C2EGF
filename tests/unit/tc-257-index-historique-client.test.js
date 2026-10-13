import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * TC-257 — Les index que `listClientHistory` exige.
 *
 * ⚠ CE TEST LIT UN FICHIER, ET C'EST TOUT L'INTÉRÊT. L'émulateur Firestore crée
 *   les index à la volée : TOUS les tests de TC-256 passent sans qu'aucun index
 *   ne soit déclaré. La production, elle, refuse la requête. C'est le seul
 *   endroit où cet oubli peut être attrapé avant le déploiement.
 *
 * ⚠ IL N'Y A QUE DEUX INDEX ICI, ET C'EST VOULU. Un index {clientId, type} a
 *   existé dans le plan : il servait des sommes par type que l'on a retirées,
 *   parce qu'elles comptaient des lignes annulées dont l'argent était déjà
 *   revenu aux soldes. Un index déclaré mais qu'aucune requête n'emprunte n'est
 *   pas gratuit — Firestore le maintient à chaque écriture dans `history`.
 */

const index = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'))

const trouve = (collectionGroup, champs) => index.indexes.some((i) =>
  i.collectionGroup === collectionGroup
  && i.queryScope === 'COLLECTION_GROUP'
  && JSON.stringify(i.fields) === JSON.stringify(champs))

describe('TC-257 — les index de l\'historique client', () => {
  it('[TC-257-01] history : clientId + createdAt, en portée GROUPE', () => {
    expect(trouve('history', [
      { fieldPath: 'clientId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ])).toBe(true)
  })

  /**
   * Les non terminées se cherchent par `clientId` seul sur le groupe `drafts`.
   * Firestore ne crée les index de GROUPE qu'explicitement : sans ce
   * `fieldOverride`, la requête échoue alors qu'un index simple existe déjà en
   * portée COLLECTION.
   */
  it('[TC-257-03] drafts.clientId est indexé en portée GROUPE', () => {
    const override = index.fieldOverrides.find((f) => f.collectionGroup === 'drafts' && f.fieldPath === 'clientId')
    expect(override).toBeDefined()
    expect(override.indexes).toEqual(expect.arrayContaining([
      { order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' },
    ]))
  })
})
