/**
 * TC-316 — Un règlement en plusieurs moyens se lit moyen par moyen.
 *
 * Signalé le 31 octobre 2026 : un retrait non terminé payé 50 000 en Orange
 * Money (sur un code agent) puis 50 000 en Cash apparaissait dans l'historique
 * comme payé par UN SEUL moyen, avec le code. Le serveur n'écrit dans le
 * statut que le moyen de la dernière tranche ; il garde pourtant le net de
 * chaque réseau, et désormais les codes de chaque réseau.
 *
 * Ce qui est figé :
 *   - le détail vient de `netByNetwork` (payé moins remboursé), un réseau nul
 *     disparaît, un seul moyen ne fait pas de détail ;
 *   - chaque code reste avec le moyen qui l'a reçu ; sur une ligne d'avant,
 *     il va au seul moyen électronique, jamais au Cash par supposition ;
 *   - le serveur range les codes par réseau, tranche après tranche.
 */

import { describe, it, expect, vi } from 'vitest'
import { detailDuReglement, moyenDuReseau, statutDuReglement } from '../../src/utils/detailReglement.js'
import { createExportData } from '../../src/utils/helpers.js'
import { addTransactionPaymentHandler } from '../../functions/src/settlements/addTransactionPayment.js'
import { accumulerCodesParReseau } from '../../functions/src/settlements/settlementShared.js'

const ligne = (resume, over = {}) => ({
  id: 'h-1',
  type: 'Retrait',
  client: { prenom: 'Salif', nom: 'OUEDRAOGO' },
  code: '4544102',
  montant: 100000,
  statut: 'Payé par Cash',
  settlementSummary: resume,
  ...over,
})

const DEUX_MOYENS = {
  netByNetwork: { Orange: { paid: 50000, refunded: 0 }, Liquidite: { paid: 50000, refunded: 0 } },
  agentCodes: ['7777777'],
  agentCodesByNetwork: { Orange: ['7777777'] },
}

describe('TC-316 — le détail d’une ligne', () => {
  it('[DR-01] deux moyens : chaque montant avec le sien, le code avec Orange Money', () => {
    expect(detailDuReglement(ligne(DEUX_MOYENS))).toEqual({
      tranches: [
        { moyen: 'Orange Money', montant: 50000, codes: ['7777777'] },
        { moyen: 'Cash', montant: 50000, codes: [] },
      ],
      codesSansMoyen: [],
    })
  })

  it('[DR-02] un seul moyen, même en plusieurs tranches : pas de détail, le statut suffit', () => {
    expect(detailDuReglement(ligne({ netByNetwork: { Orange: { paid: 100000, refunded: 0 } } }))).toBeNull()
    expect(detailDuReglement(ligne(undefined))).toBeNull()
  })

  it('[DR-03] le net compte : un moyen entièrement remboursé disparaît', () => {
    const resume = {
      netByNetwork: { Orange: { paid: 30000, refunded: 30000 }, Liquidite: { paid: 100000, refunded: 0 } },
    }
    expect(detailDuReglement(ligne(resume))).toBeNull()
  })

  it('[DR-04] une ligne d’avant ce lot : le code va au seul moyen électronique', () => {
    const avant = { netByNetwork: DEUX_MOYENS.netByNetwork, agentCodes: ['7777777'] }
    expect(detailDuReglement(ligne(avant)).tranches[0]).toEqual({ moyen: 'Orange Money', montant: 50000, codes: ['7777777'] })
    expect(detailDuReglement(ligne(avant)).tranches[1].codes).toEqual([])

    // Sans résumé des codes, le libellé de la ligne fait foi.
    const libelle = detailDuReglement(ligne({ netByNetwork: DEUX_MOYENS.netByNetwork }, { settlementAgentCode: '111 + 222' }))
    expect(libelle.tranches[0].codes).toEqual(['111', '222'])
  })

  it('[DR-05] deux moyens électroniques sans rangement : les codes restent à part, rien n’est supposé', () => {
    const avant = {
      netByNetwork: { Orange: { paid: 10000 }, Moov: { paid: 10000 }, Liquidite: { paid: 10000 } },
      agentCodes: ['1', '2'],
    }
    const detail = detailDuReglement(ligne(avant))
    expect(detail.tranches.every((t) => t.codes.length === 0)).toBe(true)
    expect(detail.codesSansMoyen).toEqual(['1', '2'])
  })

  it('[DR-06] le statut cite tous les moyens, sans toucher à ce qui est stocké', () => {
    const detail = detailDuReglement(ligne(DEUX_MOYENS))
    expect(statutDuReglement('Payé par Cash', detail)).toBe('Payé par Orange Money et Cash')
    expect(statutDuReglement('Encaissé par Cash', detail)).toBe('Encaissé par Orange Money et Cash')
    expect(statutDuReglement('Payé par Cash', null)).toBe('Payé par Cash')
    expect(statutDuReglement('Validée', detail)).toBe('Validée')
  })

  it('[DR-07] les réseaux se nomment comme les boutons', () => {
    expect(moyenDuReseau('Liquidite')).toBe('Cash')
    expect(moyenDuReseau('Orange')).toBe('Orange Money')
  })
})

describe('TC-316 — l’export', () => {
  it('[DR-08] le statut et le détail y sont, comme à l’écran', () => {
    const [ligneExport] = createExportData([ligne(DEUX_MOYENS, { settlementAgentCode: '7777777' })])
    expect(ligneExport.Statut).toBe('Payé par Orange Money et Cash')
    expect(ligneExport['Détail du règlement']).toBe('50000 Orange Money → 7777777 ; 50000 Cash')
    expect(ligneExport['Code agent destinataire']).toBe('7777777')
  })

  it('[DR-09] un règlement d’un seul moyen garde son export d’avant', () => {
    const [ligneExport] = createExportData([ligne(undefined, { statut: 'Payé par Orange Money' })])
    expect(ligneExport.Statut).toBe('Payé par Orange Money')
    expect(ligneExport['Détail du règlement']).toBe('')
  })
})

describe('TC-316 — le serveur range les codes par réseau', () => {
  it('[DR-10] tranche après tranche, sans doublon ni code vide', () => {
    const un = accumulerCodesParReseau(null, 'Orange', '7777777')
    expect(un).toEqual({ Orange: ['7777777'] })
    const deux = accumulerCodesParReseau({ agentCodesByNetwork: un }, 'Liquidite', null)
    expect(deux).toEqual({ Orange: ['7777777'] })
    expect(accumulerCodesParReseau({ agentCodesByNetwork: un }, 'Orange', '7777777')).toEqual({ Orange: ['7777777'] })
    expect(accumulerCodesParReseau({ agentCodesByNetwork: un }, 'Orange', '8888888')).toEqual({ Orange: ['7777777', '8888888'] })
  })

  it('[DR-11] le dernier paiement, en Cash, garde le code d’Orange Money sur la ligne d’historique', async () => {
    const STORE = 'store-316'
    const profil = { active: true, role: 'store_admin', storeId: STORE, name: 'Awa', email: 'awa@test.com' }
    const brouillon = {
      type: 'Retrait', montant: 100000, clientId: 'c-1', reseau: 'Orange', statut: 'Non Terminées',
      originalAmount: 100000, paidAmount: 50000, refundedAmount: 0, remainingAmount: 50000, settlementStatus: 'partial',
      settlementSummary: { netByNetwork: { Orange: { paid: 50000, refunded: 0 } }, agentCodes: ['7777777'], agentCodesByNetwork: { Orange: ['7777777'] } },
    }
    const ecrits = []
    const instantane = (data) => ({ exists: !!data, data: () => data })
    const tx = {
      get: vi.fn(async (ref) => instantane(ref._path.startsWith('users/') ? profil : ref._path.startsWith('stores/') ? { active: true } : null)),
      getAll: vi.fn(async (...refs) => refs.map((ref) => {
        if (ref._path.endsWith('drafts/d-316')) return instantane(brouillon)
        if (ref._path.endsWith('networkBalances/current')) return instantane({ balances: { Orange: { stock: 0, liquidite: 500000 } } })
        if (ref._path.startsWith('users/')) return instantane(profil)
        return instantane(null)
      })),
      set: vi.fn((ref, data) => ecrits.push({ path: ref._path, data })),
      update: vi.fn((ref, data) => ecrits.push({ path: ref._path, data })),
      delete: vi.fn(),
    }
    const doc = (path) => ({
      _path: path,
      get: async () => instantane(path.startsWith('users/') ? profil : path.startsWith('stores/') ? { active: true } : null),
    })
    const db = {
      doc,
      collection: (path) => ({ doc: (id = 'h-316') => doc(`${path}/${id}`) }),
      runTransaction: vi.fn(async (fn) => fn(tx)),
    }

    await addTransactionPaymentHandler(
      { auth: { uid: 'u-316' }, data: { draftId: 'd-316', amount: 50000, paymentMethod: 'Cash', idempotencyKey: 'k-316' } },
      { db, FieldValue: { serverTimestamp: () => ({ _type: 'serverTimestamp' }) } },
    )

    const historique = ecrits.find((e) => e.path === `clients/${STORE}/history/h-316`).data
    expect(historique.statut).toBe('Payé par Cash')
    expect(historique.settlementSummary.netByNetwork).toEqual({
      Orange: { paid: 50000, refunded: 0 },
      Liquidite: { paid: 50000, refunded: 0 },
    })
    expect(historique.settlementSummary.agentCodesByNetwork).toEqual({ Orange: ['7777777'] })
    // …et l'écran en tire ce qui s'est vraiment passé.
    expect(statutDuReglement(historique.statut, detailDuReglement(historique))).toBe('Payé par Orange Money et Cash')
  })
})
