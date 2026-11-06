import { describe, it, expect } from 'vitest'
import { CLIENT, EN_ATTENTE, REFUSEE, REGLEMENT, REMBOURSEMENT, SAISIE } from '../../src/services/fileEnvoi.js'
import { appliquerFile, clientsEnAttente, soldesProvisoires } from '../../src/utils/envoisEnAttente.js'
import { sommesEnAttente } from '../../src/utils/caisse.js'

/**
 * TC-354 — ce que les opérations en attente changent à l'écran (lot G3c,
 * docs/rester-dans-le-quota-gratuit.md §G3).
 *
 * Ce que ce fichier verrouille :
 * - une saisie faite hors ligne apparaît, sous l'identifiant que le serveur
 *   lui donnera, et une saisie refusée reste visible avec sa raison ;
 * - les soldes provisoires suivent les mêmes règles que le serveur, et une
 *   opération que le calcul refuse n'y entre pas.
 */

// 6 novembre 2026, 10 h, à Ouagadougou (UTC+0).
const CREE_LE = Date.UTC(2026, 10, 6, 10, 0)
const op = (id, type, charge, autres = {}) => ({ id, type, charge, etat: EN_ATTENTE, creeLe: CREE_LE, tentatives: 0, erreur: null, ...autres })
const saisie = (id, transaction, autres) => op(id, SAISIE, { transaction: { clientId: 'c1', reseau: 'Orange', ...transaction } }, autres)
const SOLDES = { Orange: { stock: 10_000, liquidite: 5_000 } }

describe('TC-354 — les lignes en attente', () => {
  it('[EE-01] une non terminée en attente prend son identifiant de commande, sa date du jour et son état', () => {
    const { nonTerminees, historique } = appliquerFile([], [], [
      saisie('cmd-1', { type: 'Dépôt', montant: 2000, statut: 'Non Terminées' }),
    ])
    expect(historique).toEqual([])
    expect(nonTerminees).toHaveLength(1)
    expect(nonTerminees[0]).toMatchObject({
      id: 'cmd-1', type: 'Dépôt', montant: 2000, statut: 'Non Terminées', date: '06/11/2026',
      envoi: { etat: EN_ATTENTE, erreur: null },
    })
    expect(nonTerminees[0].createdAt.toMillis()).toBe(CREE_LE)
  })

  it('[EE-02] une validée d’un geste va avec l’historique ; une refusée garde sa raison', () => {
    const erreur = { code: 'INSUFFICIENT_STORE_BALANCE', message: 'Stock insuffisant.' }
    const { nonTerminees, historique } = appliquerFile([], [], [
      saisie('cmd-2', { type: 'Retrait', montant: 500, statut: 'Validée' }),
      saisie('cmd-3', { type: 'Dépôt', montant: 900, statut: 'Non Terminées' }, { etat: REFUSEE, erreur }),
    ])
    expect(historique.map((l) => l.id)).toEqual(['cmd-2'])
    expect(nonTerminees[0].envoi).toEqual({ etat: REFUSEE, erreur })
  })

  it('[EE-03] les règlements se rangent sous la ligne qu’ils règlent ; les clients en attente sont listés', () => {
    const operations = [
      op('r1', REGLEMENT, { draftId: 'd1', amount: 1000, paymentMethod: 'Cash' }),
      op('r2', REMBOURSEMENT, { draftId: 'd1', amount: 200, paymentMethod: 'Orange Money' }),
      op('k1', CLIENT, { donnees: { nom: 'OUATTARA' } }),
      op('k2', CLIENT, { donnees: { nom: 'REFUSE' } }, { etat: REFUSEE }),
    ]
    const { nonTerminees } = appliquerFile([{ id: 'd1', type: 'Dépôt', montant: 5000 }], [], operations)
    expect(nonTerminees[0].reglementsEnAttente.map((r) => [r.type, r.amount])).toEqual([[REGLEMENT, 1000], [REMBOURSEMENT, 200]])
    expect(clientsEnAttente(operations)).toEqual([{ id: 'k1', nom: 'OUATTARA', enAttente: true }])
  })
})

describe('TC-354 — les soldes provisoires', () => {
  it('[EE-04] une non terminée de dépôt retire le stock ; une validée de dépôt ajoute aussi la liquidité', () => {
    const { soldes, appliquees } = soldesProvisoires(SOLDES, [
      saisie('a', { type: 'Dépôt', montant: 2000, statut: 'Non Terminées' }),
      saisie('b', { type: 'Dépôt', montant: 1000, statut: 'Validée' }),
    ])
    expect(soldes.Orange).toEqual({ stock: 7000, liquidite: 6000 })
    expect(appliquees).toBe(2)
  })

  it('[EE-05] un règlement Cash d’un dépôt fait entrer la liquidité ; son remboursement la fait ressortir', () => {
    const brouillons = new Map([['d1', { id: 'd1', type: 'Dépôt' }]])
    const { soldes } = soldesProvisoires(SOLDES, [
      op('r1', REGLEMENT, { draftId: 'd1', amount: 3000, paymentMethod: 'Cash' }),
      op('r2', REMBOURSEMENT, { draftId: 'd1', amount: 1000, paymentMethod: 'Cash' }),
    ], brouillons)
    expect(soldes.Orange).toEqual({ stock: 10_000, liquidite: 7000 })
  })

  it('[EE-06] le règlement d’une non terminée saisie hors ligne suit sa saisie', () => {
    const operations = [
      saisie('cmd-1', { type: 'Retrait', montant: 4000, statut: 'Non Terminées' }),
      op('r1', REGLEMENT, { draftId: 'cmd-1', amount: 4000, paymentMethod: 'Cash' }),
    ]
    const brouillons = new Map(appliquerFile([], [], operations.slice(0, 1)).nonTerminees.map((l) => [l.id, l]))
    const { soldes, appliquees } = soldesProvisoires(SOLDES, operations, brouillons)
    expect(soldes.Orange).toEqual({ stock: 14_000, liquidite: 1000 })
    expect(appliquees).toBe(2)
  })

  it('[EE-08] un règlement qui porte le type de sa ligne n’a pas besoin de la retrouver', () => {
    const { soldes } = soldesProvisoires(SOLDES, [
      op('r1', REGLEMENT, { draftId: 'ailleurs', amount: 2000, paymentMethod: 'Orange Money', type: 'Retrait' }),
    ])
    expect(soldes.Orange).toEqual({ stock: 8000, liquidite: 5000 })
  })

  it('[EE-07] ce que le calcul refuse, ce qui est refusé, et ce qui vise une ligne inconnue n’entrent pas', () => {
    const { soldes, appliquees } = soldesProvisoires(SOLDES, [
      saisie('trop', { type: 'Dépôt', montant: 50_000, statut: 'Non Terminées' }),
      saisie('refusee', { type: 'Dépôt', montant: 100, statut: 'Non Terminées' }, { etat: REFUSEE }),
      op('orphelin', REGLEMENT, { draftId: 'inconnue', amount: 100, paymentMethod: 'Cash' }),
      op('client', CLIENT, { donnees: {} }),
    ])
    expect(soldes).toEqual(SOLDES)
    expect(appliquees).toBe(0)
  })
})

describe('TC-354 — le total de la caisse', () => {
  it('[EE-13] une saisie refusée ne compte pas ; une en attente et une réglée hors ligne suivent leur reste', () => {
    const somme = sommesEnAttente([
      { id: 'a', type: 'Dépôt', montant: 1000, envoi: { etat: REFUSEE } },
      { id: 'b', type: 'Dépôt', montant: 2000, envoi: { etat: EN_ATTENTE } },
      { id: 'c', type: 'Retrait', montant: 3000, remainingAmount: 0, settlementStatus: 'settled' },
    ])
    expect(somme.depots).toBe(2000)
    expect(somme.nbDepots).toBe(1)
    expect(somme.retraits).toBe(0)
  })
})

describe('TC-354 — la fusion avec les lignes du serveur', () => {
  const serveur = [{ id: 'd1', type: 'Dépôt', montant: 5000 }, { id: 'd2', type: 'Retrait', montant: 3000, paidAmount: 1000, remainingAmount: 2000, settlementStatus: 'partial' }]

  it('[EE-09] sans rien en attente, la liste du serveur revient telle quelle', () => {
    const historique = []
    const resultat = appliquerFile(serveur, historique, [])
    expect(resultat.nonTerminees).toBe(serveur)
    expect(resultat.historique).toBe(historique)
    // Une fiche client ne change aucune ligne : pas de copie non plus.
    expect(appliquerFile(serveur, historique, [op('k1', CLIENT, { donnees: {} })]).nonTerminees).toBe(serveur)
  })

  it('[EE-10] une ligne en attente s’ajoute ; renvoyée par le serveur, c’est la sienne qui reste', () => {
    const locale = saisie('cmd-1', { type: 'Dépôt', montant: 100, statut: 'Non Terminées' })
    expect(appliquerFile(serveur, [], [locale]).nonTerminees.map((l) => l.id)).toEqual(['d1', 'd2', 'cmd-1'])
    const dejaLa = appliquerFile([...serveur, { id: 'cmd-1', montant: 100 }], [], [locale]).nonTerminees
    const memeLigne = dejaLa.filter((l) => l.id === 'cmd-1')
    expect(memeLigne).toHaveLength(1)
    expect(memeLigne[0].envoi).toBeUndefined()
  })

  it('[EE-11] un règlement en attente fait baisser le reste dû ; un remboursement le fait remonter', () => {
    const { nonTerminees: [d1, d2] } = appliquerFile(serveur, [], [
      op('r1', REGLEMENT, { draftId: 'd1', amount: 2000, paymentMethod: 'Cash' }),
      op('r2', REGLEMENT, { draftId: 'd2', amount: 1500, paymentMethod: 'Cash' }),
      op('r3', REMBOURSEMENT, { draftId: 'd2', amount: 500, paymentMethod: 'Cash' }),
    ])
    expect(d1).toMatchObject({ paidAmount: 2000, remainingAmount: 3000, settlementStatus: 'partial' })
    expect(d2).toMatchObject({ paidAmount: 2500, refundedAmount: 500, remainingAmount: 1000, settlementStatus: 'partial' })
  })

  it('[EE-12] réglée en entier hors ligne, la ligne passe dans l’historique sous son identifiant ; un règlement refusé ne compte pas', () => {
    const { nonTerminees, historique } = appliquerFile(serveur, [], [
      op('r1', REGLEMENT, { draftId: 'd1', amount: 5000, paymentMethod: 'Cash' }),
      op('r2', REGLEMENT, { draftId: 'd2', amount: 2000, paymentMethod: 'Cash' }, { etat: REFUSEE }),
    ])
    expect(historique).toHaveLength(1)
    expect(historique[0]).toMatchObject({
      id: 'd1', remainingAmount: 0, settlementStatus: 'settled', statut: 'Encaissé par Cash',
      paymentMethod: 'Cash', effectiveNetwork: 'Liquidite', envoi: { etat: EN_ATTENTE },
    })
    expect(nonTerminees.map((l) => l.id)).toEqual(['d2'])
    expect(nonTerminees[0]).toMatchObject({ remainingAmount: 2000, paidAmount: 1000 })
    expect(nonTerminees[0].reglementsEnAttente[0]).toMatchObject({ id: 'r2', etat: REFUSEE })
  })
})
