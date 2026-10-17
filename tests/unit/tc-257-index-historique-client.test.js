import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * TC-257 — Les index que `listClientHistory` exige.
 *
 * ⚠ CE TEST LIT UN FICHIER, ET C'EST TOUT L'INTÉRÊT. L'émulateur Firestore crée
 *   les index à la volée : TOUS les tests de TC-256 passent sans qu'aucun index
 *   ne soit déclaré. La production, elle, refuse la requête avec
 *   FAILED_PRECONDITION. C'est le seul endroit où cet oubli peut être attrapé
 *   avant le déploiement.
 *
 * ⚠ CE FICHIER EST ÉCRIT COMME UNE TABLE « REQUÊTE ↔ INDEX », et pas comme une
 *   liste d'index à vérifier. La différence est celle qui a laissé passer deux
 *   défauts opposés dans ce lot : un index {clientId, type} DÉCLARÉ SANS
 *   REQUÊTE (maintenu à chaque écriture dans `history`, pour rien), et une
 *   requête SANS INDEX — l'agrégat de groupe sur `clientId` seul, qui fait
 *   échouer chaque ouverture du panneau en production. Partir des requêtes
 *   réelles du handler attrape les deux ; partir des index n'attrape que le
 *   premier.
 *
 * ⚠ UN `fieldOverride` REMPLACE L'INDEXATION AUTOMATIQUE DU CHAMP, il ne la
 *   complète pas. D'où les entrées de portée COLLECTION dans chaque override
 *   ci-dessous : sans elles, `firebase deploy --only firestore:indexes`
 *   proposerait de SUPPRIMER des index que Firestore maintient aujourd'hui tout
 *   seul, et dont d'autres requêtes du dépôt dépendent — `compterParBoutique`
 *   lit `clients/{id}/history` en portée COLLECTION, et
 *   `historyService.subscribeToHistory` aussi.
 */

const index = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'))

const composite = (collectionGroup, champs) => index.indexes.some((i) =>
  i.collectionGroup === collectionGroup
  && i.queryScope === 'COLLECTION_GROUP'
  && JSON.stringify(i.fields) === JSON.stringify(champs))

const override = (collectionGroup, fieldPath) =>
  index.fieldOverrides.find((f) => f.collectionGroup === collectionGroup && f.fieldPath === fieldPath)

/**
 * Les cinq requêtes de `functions/src/clients/listClientHistory.js`, et l'index
 * qui sert chacune. Toute requête ajoutée au handler doit venir s'inscrire ici.
 */
describe('TC-257 — une requête, un index', () => {
  it('[TC-257-01] la page d’historique : collectionGroup(history).where(clientId).orderBy(createdAt desc)', () => {
    // `__name__ DESC` est ajouté implicitement par Firestore dans la direction
    // du dernier orderBy : le composite le couvre sans être déclaré.
    expect(composite('history', [
      { fieldPath: 'clientId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ])).toBe(true)
  })

  /**
   * ⚠ L'AGRÉGAT DE GROUPE SUR `clientId` SEUL, SANS `orderBy`.
   *   `calculerTotaux` compte deux fois : une fois trié sur `createdAt` (servi
   *   par le composite), et une fois SANS tri — pour mesurer l'écart, qui est
   *   le nombre de lignes sans date, impossibles à lister. Cette seconde
   *   requête porte un tri implicite `__name__ ASC`, que le composite
   *   (clientId ASC, createdAt DESC, __name__ DESC) ne fournit pas.
   *
   *   Elle a exactement la forme pour laquelle `drafts.clientId` a reçu son
   *   override, à l'enveloppe `count()` près. Sans index de groupe, elle échoue
   *   — et comme les totaux ne sont calculés QUE sur la première page, la
   *   fonctionnalité serait morte dès la première ouverture.
   */
  it('[TC-257-02] l’agrégat global : history.clientId est indexé en portée GROUPE', () => {
    const o = override('history', 'clientId')
    expect(o).toBeDefined()
    expect(o.indexes).toEqual(expect.arrayContaining([
      { order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' },
    ]))
  })

  /**
   * Les non terminées se cherchent par `clientId` seul sur le groupe `drafts`.
   * Firestore ne crée les index de GROUPE qu'explicitement : sans ce
   * `fieldOverride`, la requête échoue alors qu'un index simple existe déjà en
   * portée COLLECTION.
   */
  it('[TC-257-03] les non terminées : drafts.clientId est indexé en portée GROUPE', () => {
    const o = override('drafts', 'clientId')
    expect(o).toBeDefined()
    expect(o.indexes).toEqual(expect.arrayContaining([
      { order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' },
    ]))
  })

  /**
   * ⚠ LE COMPTE PAR BOUTIQUE LIT EN PORTÉE COLLECTION, pas en groupe :
   *   `clients/{storeId}/history`. Cet index existe automatiquement — SAUF si
   *   un override sur le même champ l'a remplacé. C'est précisément ce que ce
   *   test empêche : les deux overrides de `clientId` doivent conserver leurs
   *   entrées COLLECTION, sinon le déploiement les supprime.
   */
  it.each([
    ['history', 'clientId'],
    ['drafts', 'clientId'],
  ])('[TC-257-04] l’override %s.%s n’enlève pas l’index COLLECTION automatique', (groupe, champ) => {
    const o = override(groupe, champ)
    expect(o).toBeDefined()
    expect(o.indexes).toEqual(expect.arrayContaining([
      { order: 'ASCENDING', queryScope: 'COLLECTION' },
      { order: 'DESCENDING', queryScope: 'COLLECTION' },
    ]))
  })

  /**
   * ⚠ L'AUTRE MOITIÉ DE LA TABLE : aucun index de `history` ou `drafts` qui ne
   *   serve une requête listée ci-dessus. Un index {clientId, type} a vécu une
   *   heure dans ce dépôt ; il servait des sommes par type retirées depuis,
   *   parce qu'elles comptaient des lignes annulées dont l'argent était déjà
   *   revenu aux soldes. Firestore maintient un index mort à CHAQUE écriture.
   *
   * ⚠ {statut ASC, createdAt ASC} ET {type ASC, createdAt ASC} NE SONT PAS
   *   CEUX DE `listClientHistory` — ILS APPARTIENNENT À
   *   `chiffreAffairesService.js` (tâche 9), AJOUTÉS ICI DÉLIBÉRÉMENT. Le
   *   premier sert les deux agrégations de soustraction sur `statut`
   *   (`== 'Annulée'|'Supprimée'`, combiné à la plage de `createdAt`) ; le
   *   second sert les trois agrégations de soustraction sur `type`
   *   (`== 'Ravitaillement'|'Retour'|'Clôture'` — le float du dealer, qui
   *   n'est pas du chiffre d'affaires client, ronde de correction 1 de la
   *   tâche 9). Aucun des deux n'est la requête `not-in` ou `type in [...]`
   *   du plan d'origine, écartées précisément parce qu'elles sous-évaluent le
   *   CA en silence. Ce fichier ne sert que `listClientHistory` ; il n'était
   *   pas le bon endroit pour documenter la table requête↔index de la tâche
   *   9 — seule l'absence de surplus est vérifiée ici.
   */
  it('[TC-257-05] aucun index composite de trop sur history ou drafts', () => {
    const attendus = [
      JSON.stringify([
        { fieldPath: 'clientId', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
      ]),
      JSON.stringify([
        { fieldPath: 'statut', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'ASCENDING' },
      ]),
      JSON.stringify([
        { fieldPath: 'type', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'ASCENDING' },
      ]),
    ]
    const surplus = index.indexes
      .filter((i) => ['history', 'drafts'].includes(i.collectionGroup) && i.queryScope === 'COLLECTION_GROUP')
      .filter((i) => !attendus.includes(JSON.stringify(i.fields)))
      .map((i) => `${i.collectionGroup}: ${i.fields.map((f) => f.fieldPath).join(' + ')}`)

    expect(surplus).toEqual([])
  })
})
