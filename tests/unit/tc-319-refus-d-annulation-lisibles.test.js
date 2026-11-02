/**
 * TC-319 — Un refus d'annulation arrive jusqu'à l'écran, avec sa raison.
 *
 * Constat BUG-09 de l'audit du 31 octobre 2026. TC-315 a typé les refus de
 * SOLDE ; il restait, dans `financialUtils`, des refus MÉTIER levés en simples
 * `Error`. `wrapCallable` ne laisse passer que `DealerRequestError` : la
 * caissière qui annulait une ligne que le serveur ne sait pas défaire lisait
 * « Une erreur interne s'est produite. », alors que le tableau de l'historique
 * est écrit pour afficher le refus mot pour mot (HistoriqueTable, « LE MESSAGE
 * DU SERVEUR, MOT POUR MOT »).
 *
 * Les refus typés ici sont ceux qu'une ligne RÉELLE peut atteindre :
 *   - un retrait validé d'un geste, écrit avant la répartition de liquidité ;
 *   - une ligne d'historique incomplète (montant en texte, réseau absent) ;
 *   - une ligne défaite sous une ancienne graphie (« Annulee »), que le garde
 *     exact de `refuserSiIntouchable` ne reconnaît pas ;
 *   - un crédit validé d'un geste (profils qui ouvrent le crédit).
 *
 * Ce qui ne change pas : leur TEXTE (TC-081 compare les messages au clone du
 * front), et les contrôles défensifs que la commande valide déjà en amont
 * (vase, montant, type inconnu) restent des pannes — TC-315 [RS-06].
 */

import { describe, it, expect, vi } from 'vitest'
import {
  applyInitialTransactionImpact,
  applyReplenishmentImpact,
  reverseHistoryTransactionImpact,
  reversePendingOnlyImpact,
} from '../../functions/src/settlements/financialUtils.js'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'
import { wrapCallable } from '../../functions/src/callable.js'
import { DealerRequestError } from '../../functions/src/errors.js'

const SOLDES = { Orange: { stock: 1_000_000, liquidite: 1_000_000 } }

const ANCIEN_RETRAIT = { type: 'Retrait', reseau: 'Orange', montant: 5000, statut: 'Validée', directValidation: true }
const LIGNE_INCOMPLETE = { type: 'Dépôt', reseau: 'Orange', montant: '5000', statut: 'Validée' }
const DEFAITE_ANCIENNE_GRAPHIE = { type: 'Dépôt', reseau: 'Orange', montant: 5000, statut: 'Annulee' }

const refusDe = (geste) => {
  try { geste() } catch (e) { return e }
  return null
}

describe('TC-319 — les refus métier des inversions sont typés', () => {
  const cas = [
    ['un ancien retrait validé d’un geste', () => reverseHistoryTransactionImpact(SOLDES, ANCIEN_RETRAIT), "L'annulation automatique de ce retrait historique n'est pas sûre."],
    ['une ligne au montant illisible', () => reverseHistoryTransactionImpact(SOLDES, LIGNE_INCOMPLETE), 'Historique financier incomplet.'],
    ['une ligne défaite sous une ancienne graphie', () => reverseHistoryTransactionImpact(SOLDES, DEFAITE_ANCIENNE_GRAPHIE), 'Cette transaction est déjà annulée.'],
    ['un crédit validé d’un geste', () => applyInitialTransactionImpact(SOLDES, { type: 'Crédit', reseau: 'Orange', montant: 5000, statut: 'Validée' }), 'Les crédits doivent être remboursés via une méthode de paiement.'],
  ]

  it.each(cas)('[RA-01] %s : DealerRequestError STORE_TRANSACTION_INVALID, même texte', (_, geste, texte) => {
    const refus = refusDe(geste)
    expect(refus).toBeInstanceOf(DealerRequestError)
    expect(refus.code).toBe('STORE_TRANSACTION_INVALID')
    expect(refus.message).toBe(texte)
  })

  it('[RA-02] les contrôles défensifs validés en amont restent des pannes', () => {
    // La commande refuse déjà ces entrées avant d'appeler le calcul : les voir
    // ici signale un défaut de code, pas un geste de la caissière.
    for (const geste of [
      () => applyReplenishmentImpact(SOLDES, 'Orange', 'tiroir', 1000),
      () => applyReplenishmentImpact(SOLDES, 'Orange', 'stock', -5),
      () => reversePendingOnlyImpact(SOLDES, 'Ravitaillement', 'Orange', 1000),
    ]) {
      expect(refusDe(geste)).not.toBeInstanceOf(DealerRequestError)
    }
  })
})

/**
 * Le chemin de l'écran : bouton « Annuler » → `trashHistory` → `wrapCallable`.
 * La base ne porte que ce que la commande lit.
 */
function faireDb(ligne) {
  const ecrits = []
  const donnees = {
    'users/caisse-319': { active: true, role: 'store_admin', storeId: 'store-319', name: 'Awa', email: 'awa@test.com' },
    'stores/store-319': { active: true, name: 'C2EGF Ouaga' },
    'clients/store-319/networkBalances/current': { balances: SOLDES },
    'clients/store-319/history/h-319': ligne,
  }
  const ref = (path) => ({ _path: path })
  const t = {
    get: vi.fn(async (r) => ({ exists: r._path in donnees, data: () => donnees[r._path] })),
    set: vi.fn((r) => ecrits.push(r._path)),
    update: vi.fn((r) => ecrits.push(r._path)),
    delete: vi.fn((r) => ecrits.push(r._path)),
  }
  const db = {
    doc: ref,
    collection: (path) => ({ doc: (id = 'auto') => ref(`${path}/${id}`) }),
    runTransaction: vi.fn(async (fn) => fn(t)),
  }
  return { db, ecrits }
}

const FieldValue = { serverTimestamp: () => ({ _type: 'serverTimestamp' }) }
const annuler = { auth: { uid: 'caisse-319' }, data: { action: 'trashHistory', historyId: 'h-319' } }

describe('TC-319 — jusqu’à l’écran', () => {
  it('[RA-03] annuler un ancien retrait : la raison, pas « erreur interne », et rien d’écrit', async () => {
    const { db, ecrits } = faireDb(ANCIEN_RETRAIT)
    const appelable = wrapCallable(storeTransactionCommandHandler, { db, FieldValue, logWriter: () => {} }, () => {})
    const refus = await appelable(annuler).catch((e) => e)

    expect(refus.code).toBe('invalid-argument')
    expect(refus.message).toBe("L'annulation automatique de ce retrait historique n'est pas sûre.")
    expect(refus.details).toEqual({ code: 'STORE_TRANSACTION_INVALID' })
    expect(ecrits).toEqual([])
  })

  it('[RA-04] annuler une ligne incomplète : même chose', async () => {
    const { db, ecrits } = faireDb(LIGNE_INCOMPLETE)
    const appelable = wrapCallable(storeTransactionCommandHandler, { db, FieldValue, logWriter: () => {} }, () => {})
    const refus = await appelable(annuler).catch((e) => e)

    expect(refus.message).toBe('Historique financier incomplet.')
    expect(refus.details).toEqual({ code: 'STORE_TRANSACTION_INVALID' })
    expect(ecrits).toEqual([])
  })
})
