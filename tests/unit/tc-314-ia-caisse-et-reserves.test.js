import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * TC-314 — L'assistant voit la caisse, et sait ce que chaque geste lui fait.
 *
 * Origine (30 octobre 2026) : « paie le retrait en cash » sans un franc en
 * caisse — la carte est venue, le serveur a refusé après « Confirmer ». Le
 * modèle ne voyait aucun solde, et la préparation ne jugeait pas la réserve.
 *
 * Ce qui est figé :
 *   - le verdict de réserve est celui des fonctions du serveur ;
 *   - la liste des champs qui interdisent l'annulation est celle du serveur ;
 *   - la caisse lue par le modèle est celle de la barre des soldes ;
 *   - la lecture de la caisse passe par le panneau, jamais par la base.
 */

vi.mock('firebase/ai', () => ({
  getAI: vi.fn(),
  getGenerativeModel: vi.fn(),
  GoogleAIBackend: class {},
  AgentPlatformBackend: class {},
  ThinkingLevel: { MINIMAL: 'MINIMAL', LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' },
}))
vi.mock('../../src/config/firebase.js', () => ({ default: {} }))
vi.mock('../../src/config/appCheck.js', () => ({ activerAppCheck: () => ({ actif: true }) }))

import { getGenerativeModel } from 'firebase/ai'
import { nommerLecture, poserQuestion } from '../../src/lib/ia/assistant.js'
import { DECLARATION_CAISSE, lireLaCaisse, OUTILS_DU_PANNEAU } from '../../src/lib/ia/caisse.js'
import { DECLARATIONS } from '../../src/lib/ia/outils.js'
import { construirePrompt } from '../../src/lib/ia/prompt.js'
import {
  aEngageUnReglement,
  CHAMPS_DE_REGLEMENT,
  reserveDuMoyen,
  verifierAnnulation,
  verifierReserveDuReglement,
} from '../../src/utils/reglement.js'
import { formatCurrency } from '../../src/utils/formatCurrency.js'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const RETRAIT = { id: 'd-1', type: 'Retrait', reseau: 'Orange', montant: 50000 }
const DEPOT = { id: 'd-2', type: 'Dépôt', reseau: 'Orange', montant: 50000 }

describe('TC-314 — la réserve d’un règlement', () => {
  it('[CR-01] payer un retrait vide la réserve du moyen : espèces en Cash, stock en Orange Money', () => {
    const soldes = { Orange: { stock: 60000, liquidite: 40000 } }
    expect(verifierReserveDuReglement({ transaction: RETRAIT, action: 'payerPar', moyen: 'Cash', montant: 50000, soldes }))
      .toMatchObject({ ok: false, reserve: { nom: 'espèces', disponible: 40000 } })
    expect(verifierReserveDuReglement({ transaction: RETRAIT, action: 'payerPar', moyen: 'Orange Money', montant: 50000, soldes }))
      .toEqual({ ok: true })
  })

  it('[CR-02] encaisser un dépôt remplit une réserve : rien ne peut manquer', () => {
    const soldes = { Orange: { stock: 0, liquidite: 0 } }
    for (const moyen of ['Cash', 'Orange Money']) {
      expect(verifierReserveDuReglement({ transaction: DEPOT, action: 'encaisser', moyen, montant: 50000, soldes })).toEqual({ ok: true })
    }
  })

  it('[CR-03] le type ÉPINGLÉ par la première tranche fait foi, comme au serveur', () => {
    const epingle = { ...DEPOT, settlementType: 'Retrait' }
    expect(verifierReserveDuReglement({
      transaction: epingle, action: 'payerPar', moyen: 'Cash', montant: 50000, soldes: { Orange: { stock: 0, liquidite: 0 } },
    }).ok).toBe(false)
  })

  it('[CR-04] rembourser défait un paiement : il sort, sauf sur un retrait', () => {
    const soldes = { Orange: { stock: 0, liquidite: 0 } }
    const credit = { type: 'Crédit', reseau: 'Orange', montant: 50000 }
    expect(verifierReserveDuReglement({ transaction: credit, action: 'rembourser', moyen: 'Cash', montant: 10000, soldes }).ok).toBe(false)
    expect(verifierReserveDuReglement({ transaction: RETRAIT, action: 'rembourser', moyen: 'Cash', montant: 10000, soldes }).ok).toBe(true)
  })

  it('[CR-05] le refus se dit avec ses deux chiffres', () => {
    const { raison } = verifierReserveDuReglement({
      transaction: RETRAIT, action: 'payerPar', moyen: 'Orange Money', montant: 50000, soldes: { Orange: { stock: 12000, liquidite: 0 } },
    })
    expect(raison).toBe(`Pas assez de stock Orange : il y a ${formatCurrency(12000)}, il en faut ${formatCurrency(50000)}.`)
  })

  it('[CR-06] les espèces sont la somme de tous les réseaux, le stock celui du réseau', () => {
    const soldes = { Orange: { stock: 7000, liquidite: 3000 }, Moov: { stock: 9000, liquidite: 2000 } }
    expect(reserveDuMoyen('Cash', soldes)).toMatchObject({ disponible: 5000 })
    expect(reserveDuMoyen('Orange Money', soldes)).toMatchObject({ disponible: 7000 })
  })
})

describe('TC-314 — l’annulation d’une non terminée', () => {
  it('[CR-07] la liste des champs de règlement est celle du serveur', () => {
    const source = readFileSync(path.join(RACINE, 'functions/src/storeTransactions/storeTransactionCommand.js'), 'utf8')
    const bloc = source.match(/const SETTLEMENT_FIELDS = \[([\s\S]*?)\]/)
    expect(bloc).not.toBeNull()
    const serveur = [...bloc[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect([...CHAMPS_DE_REGLEMENT].sort()).toEqual(serveur.sort())
  })

  it('[CR-08] un seul de ces champs suffit à interdire l’annulation', () => {
    expect(aEngageUnReglement(RETRAIT)).toBe(false)
    expect(aEngageUnReglement({ ...RETRAIT, settlementType: 'Retrait' })).toBe(true)
    expect(verifierAnnulation({ transaction: { ...RETRAIT, paidAmount: 0 }, soldes: {} }).ok).toBe(false)
  })

  it('[CR-09] annuler un retrait reprend son stock ; un dépôt le rend', () => {
    const vide = { Orange: { stock: 0, liquidite: 0 } }
    expect(verifierAnnulation({ transaction: RETRAIT, soldes: vide }).ok).toBe(false)
    expect(verifierAnnulation({ transaction: RETRAIT, soldes: { Orange: { stock: 50000, liquidite: 0 } } }).ok).toBe(true)
    expect(verifierAnnulation({ transaction: DEPOT, soldes: vide }).ok).toBe(true)
  })
})

describe('TC-314 — la caisse lue par le modèle', () => {
  it('[CR-10] les chiffres de la barre des soldes, total caisse compris', () => {
    const caisse = lireLaCaisse({
      soldes: { Orange: { stock: 200000, liquidite: 30000 }, Moov: { stock: 999999, liquidite: 5000 } },
      enAttente: [
        { id: 'a', type: 'Dépôt', montant: 40000 },
        { id: 'b', type: 'Retrait', montant: 25000, remainingAmount: 10000 },
        { id: 'b', type: 'Retrait', montant: 25000, remainingAmount: 10000 },
      ],
    })
    expect(caisse).toEqual({
      // Le stock des réseaux du PROFIL (C2EGF : Orange) ; les espèces de tous.
      stock: { Orange: 200000 },
      especes: 35000,
      depots_non_termines: { nombre: 1, montant: 40000 },
      // Le reste dû, une seule fois même livré en double.
      retraits_non_termines: { nombre: 1, montant: 10000 },
      total_caisse: 200000 + 35000 + 40000 - 10000,
    })
  })

  it('[CR-11] sans soldes, un refus — jamais un zéro inventé', () => {
    expect(lireLaCaisse({})).toMatchObject({ erreur: true })
  })

  it('[CR-12] l’outil est offert au modèle, et la consigne lui dit la logique de la caisse', () => {
    expect(DECLARATIONS.map((d) => d.name)).toContain(DECLARATION_CAISSE.name)
    expect(OUTILS_DU_PANNEAU).toEqual(['etat_de_la_caisse'])
    const prompt = construirePrompt({ date: new Date('2026-10-30T12:00:00Z') })
    expect(prompt).toMatch(/LA CAISSE, ET CE QUE CHAQUE OPÉRATION LUI FAIT/)
    expect(prompt).toMatch(/« Payer par » un retrait fait sortir l'argent/)
    expect(nommerLecture('etat_de_la_caisse')).toBe('je regarde la caisse')
  })
})

describe('TC-314 — la caisse passe par le panneau', () => {
  let envoyes
  let console_

  const flux = (appels, texte = '') => ({
    stream: (async function* () {
      if (texte) yield { text: () => texte }
    })(),
    response: Promise.resolve({ functionCalls: () => appels }),
  })

  beforeEach(() => {
    envoyes = []
    console_ = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getGenerativeModel).mockReturnValue({
      startChat: () => {
        let tour = 0
        return {
          sendMessageStream: async (message) => {
            envoyes.push(message)
            tour += 1
            return tour === 1 ? flux([{ name: 'etat_de_la_caisse', args: {} }]) : flux([], 'Il y a 0 FCFA en caisse.')
          },
          getHistory: async () => [],
        }
      },
    })
  })
  afterEach(() => console_.mockRestore())

  it('[CR-13] la réponse du panneau part au modèle, telle quelle', async () => {
    const surLecture = vi.fn(() => ({ especes: 0 }))
    const surOutil = vi.fn()
    const resultat = await poserQuestion({ question: 'combien en caisse ?', surLecture, surOutil })

    expect(resultat).toMatchObject({ ok: true, texte: 'Il y a 0 FCFA en caisse.' })
    expect(surLecture).toHaveBeenCalledWith({ nom: 'etat_de_la_caisse', arguments: {} })
    expect(surOutil).toHaveBeenCalledWith('je regarde la caisse')
    expect(envoyes[1]).toEqual([{ functionResponse: { name: 'etat_de_la_caisse', response: { especes: 0 } } }])
  })

  it('[CR-14] sans panneau, un refus lisible ; une panne du panneau aussi', async () => {
    await poserQuestion({ question: 'combien en caisse ?' })
    expect(envoyes[1][0].functionResponse.response).toMatchObject({ erreur: true })

    envoyes = []
    await poserQuestion({ question: 'combien en caisse ?', surLecture: () => { throw new Error('boum') } })
    expect(envoyes[1][0].functionResponse.response).toEqual({ erreur: true, message: "Je n'ai pas pu lire la caisse." })
  })
})
