/**
 * TC-105 — reseauStats : les calculs de pilotage du distributeur.
 *
 * Ces fonctions alimentent le tableau de bord. Elles sont pures, donc testées
 * ici sans React ni Firestore, avec un `maintenant` injecté pour que rien ne
 * dépende de l'heure d'exécution.
 *
 * L'enjeu principal, celui qui justifie ce fichier : la distinction entre
 * ACTIVITÉ (l'agent est venu) et VOLUME (l'argent a bougé). Une opération en
 * attente de règlement prouve la visite mais n'a pas encore déplacé de fonds.
 * Les confondre fausserait la couverture dans un sens et le volume dans l'autre.
 */

import { describe, it, expect } from 'vitest'
import {
  SEUIL_DECROCHAGE_JOURS,
  estAnnulee,
  compteCommeVisite,
  compteCommeVolume,
  dateOperation,
  cleAgent,
  calculerCouverture,
  calculerDecrochages,
  calculerConcentration,
  calculerBalance,
  calculerFlux,
  projeterRupture,
} from '../../src/utils/reseauStats.js'

const MAINTENANT = new Date('2026-08-27T10:00:00')
const JOUR = 24 * 60 * 60 * 1000

/** Date au format français attendu par l'application : « JJ/MM/AAAA HH:mm ». */
const ilYA = (jours, heure = '09:00') => {
  const d = new Date(MAINTENANT.getTime() - jours * JOUR)
  const jj = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${jj}/${mm}/${d.getFullYear()} ${heure}`
}

const tx = (over = {}) => ({
  id: Math.random().toString(36).slice(2),
  clientId: 'a-1',
  type: 'Dépôt',
  reseau: 'Orange',
  montant: 100000,
  statut: 'Validée',
  date: ilYA(0),
  ...over,
})

const agent = (id, over = {}) => ({ id, nom: `NOM${id}`, prenom: `Prenom${id}`, ...over })

describe('TC-105 — règles de comptage', () => {
  it('une opération annulée ne compte ni comme visite ni comme volume', () => {
    const annulee = tx({ statut: 'Annulée' })
    expect(estAnnulee(annulee)).toBe(true)
    expect(compteCommeVisite(annulee)).toBe(false)
    expect(compteCommeVolume(annulee)).toBe(false)
  })

  it('« Annulee » sans accent est reconnu — les statuts voyagent mal', () => {
    expect(estAnnulee({ statut: 'annulee' })).toBe(true)
    expect(estAnnulee({ statut: 'ANNULÉE' })).toBe(true)
  })

  it('une opération en attente prouve la visite, mais pas le mouvement d’argent', () => {
    const attente = tx({ statut: 'Non Terminées' })
    expect(compteCommeVisite(attente)).toBe(true)
    expect(compteCommeVolume(attente)).toBe(false)
  })

  it('un règlement par méthode de paiement compte comme volume', () => {
    // C'est le moment où les soldes sont réellement impactés.
    expect(compteCommeVolume(tx({ statut: 'Payé par Orange Money' }))).toBe(true)
    expect(compteCommeVolume(tx({ statut: 'Encaissé par Cash' }))).toBe(true)
  })
})

describe('TC-105 — date et clé d’agent', () => {
  it('lit la date française avec son heure', () => {
    const d = dateOperation({ date: '26/08/2026 14:30' })
    expect(d.getDate()).toBe(26)
    expect(d.getHours()).toBe(14)
  })

  it('retombe sur l’horodatage Firestore quand la date n’a pas d’heure', () => {
    const attendu = new Date('2026-08-20T08:00:00')
    const d = dateOperation({ date: null, createdAt: { toDate: () => attendu } })
    expect(d).toEqual(attendu)
  })

  it('la clé d’agent privilégie clientId, puis retombe sur le code agent', () => {
    expect(cleAgent({ clientId: 'a-9', code: '123' })).toBe('a-9')
    expect(cleAgent({ code: '123' })).toBe('123')
    expect(cleAgent({})).toBeNull()
  })
})

describe('TC-105 — couverture du réseau', () => {
  const clients = [agent('a-1'), agent('a-2'), agent('a-3'), agent('a-4')]

  it('compte les agents distincts actifs sur la fenêtre, pas les passages', () => {
    const transactions = [
      tx({ clientId: 'a-1', date: ilYA(1) }),
      tx({ clientId: 'a-1', date: ilYA(1, '11:00') }),
      tx({ clientId: 'a-2', date: ilYA(3) }),
    ]
    const c = calculerCouverture(clients, transactions, { maintenant: MAINTENANT })
    expect(c.totalAgents).toBe(4)
    expect(c.actifs).toBe(2)
    expect(c.visites).toBe(3)
    expect(c.part).toBeCloseTo(0.5)
  })

  it('mesure la cadence réelle — passages par agent actif', () => {
    const transactions = Array.from({ length: 9 }, (_, i) =>
      tx({ clientId: 'a-1', date: ilYA(1, `0${(i % 8) + 1}:00`) }),
    )
    const c = calculerCouverture(clients, transactions, { maintenant: MAINTENANT })
    expect(c.actifs).toBe(1)
    expect(c.passagesParAgent).toBe(9)
  })

  it('ignore ce qui est hors fenêtre', () => {
    const transactions = [tx({ clientId: 'a-1', date: ilYA(30) })]
    expect(calculerCouverture(clients, transactions, { maintenant: MAINTENANT }).actifs).toBe(0)
  })

  it('une saisie manuelle ne gonfle pas le taux : elle n’est pas au portefeuille', () => {
    const transactions = [tx({ clientId: 'manual-Orange-99887766', date: ilYA(1) })]
    const c = calculerCouverture(clients, transactions, { maintenant: MAINTENANT })
    expect(c.actifs).toBe(0)
  })

  it('une opération en attente prouve quand même la visite', () => {
    const transactions = [tx({ clientId: 'a-1', date: ilYA(1), statut: 'Non Terminées' })]
    expect(calculerCouverture(clients, transactions, { maintenant: MAINTENANT }).actifs).toBe(1)
  })

  it('portefeuille vide → aucune division par zéro', () => {
    const c = calculerCouverture([], [], { maintenant: MAINTENANT })
    expect(c.part).toBe(0)
    expect(c.passagesParAgent).toBe(0)
  })
})

describe('TC-105 — décrochages', () => {
  const clients = [agent('a-1'), agent('a-2'), agent('a-3')]

  it('le seuil par défaut est de 15 jours, décidé avec le client', () => {
    expect(SEUIL_DECROCHAGE_JOURS).toBe(15)
  })

  it('signale l’agent silencieux au-delà du seuil, pas celui en deçà', () => {
    const transactions = [
      tx({ clientId: 'a-1', date: ilYA(20) }),
      tx({ clientId: 'a-2', date: ilYA(3) }),
    ]
    const d = calculerDecrochages(clients, transactions, { maintenant: MAINTENANT })
    expect(d.total).toBe(1)
    expect(d.decroches[0].agent.id).toBe('a-1')
    expect(d.decroches[0].joursDeSilence).toBe(20)
  })

  it('un agent qui n’a JAMAIS travaillé n’est pas un décrochage', () => {
    // C'est un agent à activer — autre sujet, autre action commerciale.
    const d = calculerDecrochages(clients, [], { maintenant: MAINTENANT })
    expect(d.total).toBe(0)
  })

  it('retient le passage le plus récent, pas le premier rencontré', () => {
    const transactions = [
      tx({ clientId: 'a-1', date: ilYA(40) }),
      tx({ clientId: 'a-1', date: ilYA(2) }),
    ]
    expect(calculerDecrochages(clients, transactions, { maintenant: MAINTENANT }).total).toBe(0)
  })

  it('classe du plus silencieux au moins silencieux', () => {
    const transactions = [
      tx({ clientId: 'a-1', date: ilYA(20) }),
      tx({ clientId: 'a-2', date: ilYA(60) }),
      tx({ clientId: 'a-3', date: ilYA(30) }),
    ]
    const d = calculerDecrochages(clients, transactions, { maintenant: MAINTENANT })
    expect(d.decroches.map((x) => x.agent.id)).toEqual(['a-2', 'a-3', 'a-1'])
  })

  it('le seuil est réglable', () => {
    const transactions = [tx({ clientId: 'a-1', date: ilYA(10) })]
    expect(calculerDecrochages(clients, transactions, { maintenant: MAINTENANT }).total).toBe(0)
    expect(
      calculerDecrochages(clients, transactions, { seuilJours: 5, maintenant: MAINTENANT }).total,
    ).toBe(1)
  })

  it('une opération annulée ne vaut pas un passage', () => {
    const transactions = [tx({ clientId: 'a-1', date: ilYA(1), statut: 'Annulée' })]
    // Aucun passage réel : l'agent n'a jamais travaillé, donc pas de décrochage.
    expect(calculerDecrochages(clients, transactions, { maintenant: MAINTENANT }).total).toBe(0)
  })
})

describe('TC-105 — concentration', () => {
  const clients = [agent('a-1'), agent('a-2'), agent('a-3')]

  it('mesure la part du volume tenue par les plus gros', () => {
    const transactions = [
      tx({ clientId: 'a-1', montant: 800000, date: ilYA(2) }),
      tx({ clientId: 'a-2', montant: 150000, date: ilYA(2) }),
      tx({ clientId: 'a-3', montant: 50000, date: ilYA(2) }),
    ]
    const c = calculerConcentration(transactions, clients, { topN: 1, maintenant: MAINTENANT })
    expect(c.volumeTotal).toBe(1000000)
    expect(c.partTete).toBeCloseTo(0.8)
    expect(c.tete[0].nom).toBe('Prenoma-1 NOMa-1')
  })

  it('exclut les opérations en attente : l’argent n’a pas bougé', () => {
    const transactions = [
      tx({ clientId: 'a-1', montant: 500000, date: ilYA(1), statut: 'Non Terminées' }),
      tx({ clientId: 'a-2', montant: 100000, date: ilYA(1) }),
    ]
    expect(calculerConcentration(transactions, clients, { maintenant: MAINTENANT }).volumeTotal).toBe(100000)
  })

  it('les saisies manuelles comptent — c’est du volume réel', () => {
    const transactions = [tx({ clientId: 'manual-Orange-777', montant: 200000, date: ilYA(1) })]
    const c = calculerConcentration(transactions, clients, { maintenant: MAINTENANT })
    expect(c.volumeTotal).toBe(200000)
    expect(c.tete[0].nom).toBe('Saisie manuelle')
  })

  it('aucun volume → aucune division par zéro', () => {
    const c = calculerConcentration([], clients, { maintenant: MAINTENANT })
    expect(c.partTete).toBe(0)
    expect(c.volumeTotal).toBe(0)
  })
})

describe('TC-105 — la balance', () => {
  const soldes = { Orange: { stock: 140631529 }, Liquidite: { liquidite: 341515014 } }

  it('lit la position et la part du stock dans le fonds de roulement', () => {
    const b = calculerBalance(soldes, [], { maintenant: MAINTENANT })
    expect(b.stock).toBe(140631529)
    expect(b.liquidite).toBe(341515014)
    expect(b.fondsRoulement).toBe(482146543)
    expect(b.partStock).toBeCloseTo(140631529 / 482146543)
  })

  it('un dépôt du jour pousse vers la liquidité, un retrait vers le stock', () => {
    const transactions = [
      tx({ type: 'Dépôt', montant: 300000, date: ilYA(0, '08:00') }),
      tx({ type: 'Retrait', montant: 100000, date: ilYA(0, '09:00') }),
    ]
    const b = calculerBalance(soldes, transactions, { maintenant: MAINTENANT })
    expect(b.versLiquidite).toBe(300000)
    expect(b.versStock).toBe(100000)
    expect(b.deriveNette).toBe(200000)
  })

  it('ne compte que la journée en cours', () => {
    const transactions = [tx({ type: 'Dépôt', montant: 999999, date: ilYA(1) })]
    expect(calculerBalance(soldes, transactions, { maintenant: MAINTENANT }).versLiquidite).toBe(0)
  })

  it('soldes vides → fonds de roulement nul, sans division par zéro', () => {
    const b = calculerBalance({}, [], { maintenant: MAINTENANT })
    expect(b.fondsRoulement).toBe(0)
    expect(b.partStock).toBe(0)
  })
})

describe('TC-105 — projection de rupture', () => {
  const soldes = { Orange: { stock: 1000000 }, Liquidite: { liquidite: 5000000 } }

  /** N opérations du jour, étalées de 06:00 à 06:00+N, toutes du même sens. */
  const journee = (nombre, type, montant) =>
    Array.from({ length: nombre }, (_, i) =>
      tx({ type, montant, date: ilYA(0, `0${6 + i}:00`.slice(-5)) }),
    )

  it('trop peu d’opérations → aucune projection, plutôt qu’une fausse', () => {
    const transactions = journee(2, 'Dépôt', 100000)
    const b = calculerBalance(soldes, transactions, { maintenant: MAINTENANT })
    expect(projeterRupture(b, transactions, { maintenant: MAINTENANT })).toBeNull()
  })

  it('les dépôts dominent → c’est le STOCK qui se vide', () => {
    const transactions = journee(5, 'Dépôt', 100000)
    const b = calculerBalance(soldes, transactions, { maintenant: MAINTENANT })
    const p = projeterRupture(b, transactions, { maintenant: MAINTENANT })
    expect(p.vase).toBe('stock')
    expect(p.soldeRestant).toBe(1000000)
    expect(p.rupture.getTime()).toBeGreaterThan(MAINTENANT.getTime())
  })

  it('les retraits dominent → c’est la LIQUIDITÉ qui se vide', () => {
    const transactions = journee(5, 'Retrait', 100000)
    const b = calculerBalance(soldes, transactions, { maintenant: MAINTENANT })
    expect(projeterRupture(b, transactions, { maintenant: MAINTENANT }).vase).toBe('liquidite')
  })

  it('journée équilibrée → rien à projeter', () => {
    const transactions = [...journee(3, 'Dépôt', 100000), ...journee(3, 'Retrait', 100000)]
    const b = calculerBalance(soldes, transactions, { maintenant: MAINTENANT })
    expect(projeterRupture(b, transactions, { maintenant: MAINTENANT })).toBeNull()
  })

  it('signale si la rupture tombe hors de la journée de travail', () => {
    // Cadence faible face à un gros stock : l'échéance est lointaine, donc peu
    // actionnable — l'écran doit pouvoir le taire.
    const gros = { Orange: { stock: 900000000 }, Liquidite: { liquidite: 5000000 } }
    const transactions = journee(5, 'Dépôt', 10000)
    const b = calculerBalance(gros, transactions, { maintenant: MAINTENANT })
    expect(projeterRupture(b, transactions, { maintenant: MAINTENANT }).dansLaJournee).toBe(false)
  })
})

describe('TC-105 — flux', () => {
  it('produit un pavé par jour, sur la fenêtre demandée', () => {
    const f = calculerFlux([], { jours: 14, maintenant: MAINTENANT })
    expect(f).toHaveLength(14)
    expect(f.at(-1).libelle).toBe('27/08')
    expect(f[0].libelle).toBe('14/08')
  })

  it('sépare les deux sens, et renvoie les retraits en négatif', () => {
    const transactions = [
      tx({ type: 'Dépôt', montant: 500000, date: ilYA(1) }),
      tx({ type: 'Retrait', montant: 200000, date: ilYA(1) }),
    ]
    const f = calculerFlux(transactions, { jours: 14, maintenant: MAINTENANT })
    const hier = f.at(-2)
    expect(hier.depots).toBe(500000)
    expect(hier.retraits).toBe(200000)
    expect(hier.retraitsNegatifs).toBe(-200000)
  })

  it('ignore les opérations hors fenêtre et les annulées', () => {
    const transactions = [
      tx({ type: 'Dépôt', montant: 1, date: ilYA(60) }),
      tx({ type: 'Dépôt', montant: 1, date: ilYA(1), statut: 'Annulée' }),
    ]
    const f = calculerFlux(transactions, { jours: 14, maintenant: MAINTENANT })
    expect(f.reduce((s, p) => s + p.depots, 0)).toBe(0)
  })
})
