import { describe, it, expect } from 'vitest'
import {
  ANNULATION,
  CIBLE_NON_TERMINEE,
  CIBLE_RETOUR,
  CIBLE_VALIDEE,
  CORRECTION,
  EN_ATTENTE,
  MODIFICATION,
  RAVITAILLEMENT,
  REFUSEE,
  REGLEMENT,
  RETOUR,
  SAISIE,
} from '../../src/services/fileEnvoi.js'
import { appliquerFile, resumeLigne, soldesProvisoires } from '../../src/utils/envoisEnAttente.js'
import { ravitaillementsEnCours } from '../../src/utils/ravitaillement.js'
import {
  applyInitialTransactionImpact,
  applySettlementImpact,
} from '../../src/utils/financialImpact.js'

/**
 * TC-360 — le ravitaillement, la modification et l'annulation en attente, à l'écran
 * et dans les soldes (lot G4c, docs/rester-dans-le-quota-gratuit.md §G4).
 *
 * Ce que ce fichier verrouille :
 * - la file se rejoue dans l'ordre : chaque geste part de ce que le précédent a laissé ;
 * - une ligne que le serveur a déjà rendue l'emporte sur la copie locale ;
 * - les soldes provisoires valent ce que le serveur calculera : les chiffres attendus
 *   sont ceux de TC-357 et TC-358, joués sur l'émulateur.
 */

const CREE_LE = Date.UTC(2026, 10, 6, 10, 0)
const op = (id, type, charge, autres = {}) => ({ id, type, charge, etat: EN_ATTENTE, creeLe: CREE_LE, tentatives: 0, erreur: null, ...autres })
const nt = (id, autres) => ({ id, clientId: 'c1', type: 'Dépôt', reseau: 'Orange', montant: 100, statut: 'Non Terminées', ...autres })
const saisie = (id, autres) => op(id, SAISIE, { transaction: { clientId: 'c1', type: 'Dépôt', reseau: 'Orange', montant: 100, statut: 'Non Terminées', ...autres } })
const SOLDES = { Orange: { stock: 1000, liquidite: 500 } }
const soldes = (operations) => soldesProvisoires(SOLDES, operations).soldes.Orange

const annuler = (cible, ligne) => op(`${ANNULATION}-${ligne.id}`, ANNULATION, { cible, cibleId: ligne.id, avant: resumeLigne(ligne) })
const modifier = (id, ligne, updates) => op(id, MODIFICATION, { draftId: ligne.id, updates, avant: resumeLigne(ligne) })
const corriger = (id, ligne, updates) => op(id, CORRECTION, { historyId: ligne.id, updates, avant: resumeLigne(ligne) })
const ravitailler = (id, autres) => op(id, RAVITAILLEMENT, { commande: { action: 'replenish', amount: 300, balanceType: 'stock', expediteur: 'Mme Sawadogo', ...autres }, reseau: 'Orange' })
const rendre = (id, replenishmentId, autres) => op(id, RETOUR, { commande: { action: 'returnReplenishment', replenishmentId, amount: 100, balanceType: 'stock', ...autres }, reseau: 'Orange' })

describe('TC-360 — le ravitaillement', () => {
  it('[GA-01] il apparaît dans l’historique avec ce qu’il reste à rendre, et crédite la réserve choisie', () => {
    const { historique } = appliquerFile([], [], [ravitailler('r1')])
    expect(historique[0]).toMatchObject({
      id: 'r1', type: 'Ravitaillement', montant: 300, reseau: 'Orange', balanceType: 'stock', expediteur: 'Mme Sawadogo',
      returnedAmount: 0, remainingAmount: 300, replenishmentStatus: 'open', envoi: { etat: EN_ATTENTE },
    })
    expect(ravitaillementsEnCours(historique).map((l) => l.id)).toEqual(['r1'])
    expect(soldes([ravitailler('r1')])).toEqual({ stock: 1300, liquidite: 500 })
    expect(soldes([ravitailler('r1', { balanceType: 'liquidite' })])).toEqual({ stock: 1000, liquidite: 800 })
  })

  it('[GA-02] sans stock, il rend la saisie possible : l’ordre compte', () => {
    const vide = { Orange: { stock: 0, liquidite: 0 } }
    const operations = [ravitailler('r1', { amount: 200 }), saisie('s1', { montant: 150 })]
    const { soldes: apres, appliquees } = soldesProvisoires(vide, operations)
    expect(apres.Orange).toEqual({ stock: 50, liquidite: 0 })
    expect(appliquees).toBe(2)
  })

  it('[GA-03] déjà rendu par le serveur, il ne se double pas', () => {
    const serveur = [{ id: 'r1', type: 'Ravitaillement', montant: 300, remainingAmount: 300 }]
    const { historique } = appliquerFile([], serveur, [ravitailler('r1')])
    expect(historique).toHaveLength(1)
    expect(historique[0].envoi).toBeUndefined()
  })

  it('[GA-04] refusé, il ne change ni les lignes ni les soldes', () => {
    const refuse = { ...ravitailler('r1'), etat: REFUSEE }
    expect(appliquerFile([], [], [refuse]).historique).toEqual([])
    expect(soldes([refuse])).toEqual(SOLDES.Orange)
  })
})

describe('TC-360 — le retour', () => {
  const livraison = { id: 'r1', type: 'Ravitaillement', montant: 300, returnedAmount: 0, remainingAmount: 300, expediteur: 'Mme Sawadogo', replenishmentStatus: 'open' }

  it('[GA-05] il baisse le reste dû de sa livraison et sort de la réserve choisie', () => {
    const { historique } = appliquerFile([], [livraison], [rendre('t1', 'r1')])
    expect(historique.find((l) => l.id === 'r1')).toMatchObject({ returnedAmount: 100, remainingAmount: 200, replenishmentStatus: 'open' })
    expect(historique.find((l) => l.id === 't1')).toMatchObject({ type: 'Retour', montant: 100, replenishmentId: 'r1', expediteur: 'Mme Sawadogo' })
    expect(soldes([rendre('t1', 'r1')])).toEqual({ stock: 900, liquidite: 500 })
  })

  it('[GA-06] il peut viser une livraison qui attend encore de partir, et la solder', () => {
    const { historique } = appliquerFile([], [], [ravitailler('r1'), rendre('t1', 'r1', { amount: 300 })])
    expect(historique.find((l) => l.id === 'r1')).toMatchObject({ remainingAmount: 0, replenishmentStatus: 'settled' })
    expect(ravitaillementsEnCours(historique)).toEqual([])
  })

  it('[GA-07] déjà rendu par le serveur, il ne baisse pas le reste dû une seconde fois', () => {
    const serveur = [{ ...livraison, returnedAmount: 100, remainingAmount: 200 }, { id: 't1', type: 'Retour', montant: 100, replenishmentId: 'r1' }]
    const { historique } = appliquerFile([], serveur, [rendre('t1', 'r1')])
    expect(historique.find((l) => l.id === 'r1').remainingAmount).toBe(200)
    expect(historique).toHaveLength(2)
  })

  it('[GA-08] annulé, il rend la réserve et fait remonter le reste dû', () => {
    const retour = { id: 't1', type: 'Retour', montant: 100, reseau: 'Orange', balanceType: 'liquidite', replenishmentId: 'r1', statut: 'Validee' }
    const operations = [annuler(CIBLE_RETOUR, retour)]
    const { historique } = appliquerFile([], [{ ...livraison, returnedAmount: 100, remainingAmount: 200 }, retour], operations)
    expect(historique.find((l) => l.id === 'r1')).toMatchObject({ returnedAmount: 0, remainingAmount: 300, replenishmentStatus: 'open' })
    expect(historique.find((l) => l.id === 't1')).toMatchObject({ statut: 'Supprimée', origin: 'return', envoi: { etat: EN_ATTENTE } })
    expect(historique.find((l) => l.id === 't1').deletedAt).toEqual(new Date(CREE_LE))
    expect(soldes(operations)).toEqual({ stock: 1000, liquidite: 600 })
  })
})

describe('TC-360 — la modification d’une non terminée', () => {
  it('[GA-09] la ligne prend les nouvelles valeurs, sans changer de statut, et le stock suit', () => {
    const ligne = nt('d1')
    const operations = [modifier('m1', ligne, { montant: 150, code: '000222', statut: 'Validée' })]
    const { nonTerminees } = appliquerFile([ligne], [], operations)
    expect(nonTerminees[0]).toMatchObject({ id: 'd1', montant: 150, code: '000222', statut: 'Non Terminées', envoi: { etat: EN_ATTENTE } })
    const avec100Deja = { Orange: { stock: 900, liquidite: 500 } }
    expect(soldesProvisoires(avec100Deja, operations).soldes.Orange).toEqual({ stock: 850, liquidite: 500 })
  })

  it('[GA-10] elle vise une saisie qui attend encore, dans l’ordre', () => {
    const s = saisie('s1')
    const { nonTerminees } = appliquerFile([], [], [s, modifier('m1', { id: 's1', montant: 100, type: 'Dépôt', reseau: 'Orange', statut: 'Non Terminées' }, { montant: 150 })])
    expect(nonTerminees).toHaveLength(1)
    expect(nonTerminees[0].montant).toBe(150)
  })

  it('[GA-11] déjà appliquée par le serveur, elle ne s’applique pas une seconde fois à l’écran', () => {
    const { nonTerminees } = appliquerFile([nt('d1', { montant: 150, derniereCommande: 'm1' })], [], [modifier('m1', nt('d1'), { montant: 150 })])
    expect(nonTerminees[0].envoi).toBeUndefined()
  })

  it('[GA-12] refusée, la ligne garde ses valeurs : la liste des envois la montre', () => {
    const refusee = { ...modifier('m1', nt('d1'), { montant: 150 }), etat: REFUSEE, erreur: { message: 'non' } }
    const { nonTerminees } = appliquerFile([nt('d1')], [], [refusee])
    expect(nonTerminees[0].montant).toBe(100)
    expect(nonTerminees[0].envoi).toBeUndefined()
    expect(soldes([refusee])).toEqual(SOLDES.Orange)
  })
})

describe('TC-360 — l’annulation', () => {
  it('[GA-13] d’une non terminée : elle quitte les non terminées pour la corbeille, et le stock revient', () => {
    const ligne = nt('d1')
    const operations = [annuler(CIBLE_NON_TERMINEE, ligne)]
    const { nonTerminees, historique } = appliquerFile([ligne], [], operations)
    expect(nonTerminees).toEqual([])
    expect(historique[0]).toMatchObject({ id: `${ANNULATION}-d1`, statut: 'Supprimée', origin: 'draft', montant: 100, envoi: { etat: EN_ATTENTE } })
    expect(soldesProvisoires({ Orange: { stock: 900, liquidite: 500 } }, operations).soldes.Orange).toEqual({ stock: 1000, liquidite: 500 })
  })

  it('[GA-14] d’une saisie qui attend encore : saisie et annulation s’annulent', () => {
    const s = saisie('s1')
    const ligneVue = { id: 's1', type: 'Dépôt', reseau: 'Orange', montant: 100, statut: 'Non Terminées' }
    const operations = [s, annuler(CIBLE_NON_TERMINEE, ligneVue)]
    const { nonTerminees, historique } = appliquerFile([], [], operations)
    expect(nonTerminees).toEqual([])
    expect(historique).toHaveLength(1)
    expect(soldes(operations)).toEqual(SOLDES.Orange)
  })

  it('[GA-15] d’une validée : marquée à sa place, et les deux jambes reviennent', () => {
    const ligne = { id: 'h1', type: 'Dépôt', reseau: 'Orange', montant: 100, statut: 'Validée', directValidation: true, validatedAt: true }
    const operations = [annuler(CIBLE_VALIDEE, ligne)]
    const { historique } = appliquerFile([], [ligne], operations)
    expect(historique[0]).toMatchObject({ id: 'h1', statut: 'Supprimée', origin: 'history' })
    expect(soldesProvisoires({ Orange: { stock: 900, liquidite: 600 } }, operations).soldes.Orange).toEqual({ stock: 1000, liquidite: 500 })
  })

  it('[GA-16] déjà marquée par le serveur, rien ne change', () => {
    const ligne = { id: 'h1', statut: 'Supprimée', deletedAt: new Date(1) }
    const { historique } = appliquerFile([], [ligne], [annuler(CIBLE_VALIDEE, { ...ligne, type: 'Dépôt', montant: 100, reseau: 'Orange' })])
    expect(historique[0].envoi).toBeUndefined()
  })

  it('[GA-17] un retrait validé d’un geste hors ligne se défait aussi : la répartition est posée sur la ligne locale', () => {
    const s = saisie('s1', { type: 'Retrait', statut: 'Validée' })
    const { historique } = appliquerFile([], [], [s])
    const operations = [s, annuler(CIBLE_VALIDEE, historique[0])]
    expect(soldes(operations)).toEqual(SOLDES.Orange)
  })
})

describe('TC-360 — la correction d’une validée', () => {
  const encaissee = { id: 'h1', clientId: 'c1', type: 'Dépôt', reseau: 'Orange', montant: 100, statut: 'Encaissé par Cash', paymentMethod: 'Cash', effectiveNetwork: 'Liquidite', validatedAt: true, date: '05/11/2026' }

  it('[GA-18] la ligne change d’identifiant, garde son jour et remonte en tête', () => {
    const { historique } = appliquerFile([], [encaissee], [corriger('c1', encaissee, { montant: 80 })])
    expect(historique).toHaveLength(1)
    expect(historique[0]).toMatchObject({
      id: 'c1', montant: 80, date: '05/11/2026', statut: 'Encaissé par Cash', paymentMethod: 'Cash',
      paidAmount: 80, originalAmount: 80, settlementAmount: 80, remainingAmount: 0, reopenedFromHistoryId: 'h1', envoi: { etat: EN_ATTENTE },
    })
    expect(historique[0].validatedAt.toMillis()).toBe(CREE_LE)
  })

  it('[GA-19] déjà rendue par le serveur, c’est la sienne qui reste', () => {
    const { historique } = appliquerFile([], [{ id: 'c1', montant: 80 }], [corriger('c1', encaissee, { montant: 80 })])
    expect(historique).toEqual([{ id: 'c1', montant: 80 }])

    // La nouvelle ligne arrive avant que l'ancienne ne parte (une période relue, par
    // exemple) : on ne recouvre pas la version du serveur par la copie locale.
    const lesDeux = appliquerFile([], [encaissee, { id: 'c1', montant: 80 }], [corriger('c1', encaissee, { montant: 80 })]).historique
    expect(lesDeux.find((l) => l.id === 'c1').envoi).toBeUndefined()
  })

  it('[GA-20] refusée, la ligne reste telle quelle', () => {
    const refusee = { ...corriger('c1', encaissee, { montant: 80 }), etat: REFUSEE }
    expect(appliquerFile([], [encaissee], [refusee]).historique).toEqual([encaissee])
  })

  // Les soldes attendus sont ceux que TC-358 obtient au serveur, partant de 500 000 /
  // 300 000 et corrigeant 100 000 en 80 000.
  const DEPART = { Orange: { stock: 500_000, liquidite: 300_000 } }
  const montant = 100_000
  const base = { id: 'h', clientId: 'c1', reseau: 'Orange', montant }

  it.each([
    ['dépôt encaissé en Cash', { ...base, type: 'Dépôt', statut: 'Encaissé par Cash', paymentMethod: 'Cash', effectiveNetwork: 'Liquidite', validatedAt: true },
      (s) => applySettlementImpact(applyInitialTransactionImpact(s, { type: 'Dépôt', montant, reseau: 'Orange', statut: 'Non Terminées' }), { type: 'Dépôt', montant }, 'Cash'),
      { stock: 420_000, liquidite: 380_000 }],
    ['retrait payé en Cash', { ...base, type: 'Retrait', statut: 'Payé par Cash', paymentMethod: 'Cash', effectiveNetwork: 'Liquidite', validatedAt: true },
      (s) => applySettlementImpact(applyInitialTransactionImpact(s, { type: 'Retrait', montant, reseau: 'Orange', statut: 'Non Terminées' }), { type: 'Retrait', montant }, 'Cash'),
      { stock: 580_000, liquidite: 220_000 }],
    ['dépôt encaissé en Orange Money', { ...base, type: 'Dépôt', statut: 'Encaissé par Orange Money', paymentMethod: 'Orange Money', effectiveNetwork: 'Orange', validatedAt: true },
      (s) => applySettlementImpact(applyInitialTransactionImpact(s, { type: 'Dépôt', montant, reseau: 'Orange', statut: 'Non Terminées' }), { type: 'Dépôt', montant }, 'Orange Money'),
      { stock: 500_000, liquidite: 300_000 }],
    ['dépôt validé d’un geste', { ...base, type: 'Dépôt', statut: 'Validée', directValidation: true },
      (s) => applyInitialTransactionImpact(s, { type: 'Dépôt', montant, reseau: 'Orange', statut: 'Validée' }),
      { stock: 420_000, liquidite: 380_000 }],
    ['retrait validé d’un geste', { ...base, type: 'Retrait', statut: 'Validée', directValidation: true, liquiditySplit: { Orange: montant } },
      (s) => applyInitialTransactionImpact(s, { type: 'Retrait', montant, reseau: 'Orange', statut: 'Validée' }),
      { stock: 580_000, liquidite: 220_000 }],
    ['validée sans règlement ni drapeau', { ...base, type: 'Dépôt', statut: 'Validée', validatedAt: true },
      (s) => applyInitialTransactionImpact(s, { type: 'Dépôt', montant, reseau: 'Orange', statut: 'Non Terminées' }),
      { stock: 420_000, liquidite: 300_000 }],
    ['dépôt réglé en deux tranches', { ...base, type: 'Dépôt', statut: 'Encaissé par Orange Money', paymentMethod: 'Orange Money', effectiveNetwork: 'Orange', validatedAt: true, settlementSummary: { netByNetwork: { Liquidite: { paid: 40_000, refunded: 0 }, Orange: { paid: 60_000, refunded: 0 } } } },
      (s) => applySettlementImpact(applySettlementImpact(applyInitialTransactionImpact(s, { type: 'Dépôt', montant, reseau: 'Orange', statut: 'Non Terminées' }), { type: 'Dépôt', montant: 40_000 }, 'Cash'), { type: 'Dépôt', montant: 60_000 }, 'Orange Money'),
      { stock: 500_000, liquidite: 300_000 }],
  ])('[GA-21] %s : les soldes provisoires valent ceux du serveur', (_nom, ligne, avant, attendu) => {
    const depart = avant(DEPART)
    const { soldes: apres, appliquees } = soldesProvisoires(depart, [corriger('c1', ligne, { montant: 80_000 })])
    expect(appliquees).toBe(1)
    expect(apres.Orange).toEqual(attendu)
  })
})

describe('TC-360 — tout s’enchaîne sur la même ligne, sans réseau', () => {
  it('[GA-22] saisir, encaisser en entier, puis annuler : l’annulation vise la ligne passée dans l’historique', () => {
    const s = saisie('s1')
    const regle = op('rg', REGLEMENT, { draftId: 's1', amount: 100, paymentMethod: 'Cash', type: 'Dépôt' })
    const { nonTerminees, historique } = appliquerFile([], [], [s, regle])
    expect(nonTerminees).toEqual([])
    expect(historique[0]).toMatchObject({ id: 's1', statut: 'Encaissé par Cash' })

    const operations = [s, regle, annuler(CIBLE_VALIDEE, historique[0])]
    const apres = appliquerFile([], [], operations)
    expect(apres.historique[0]).toMatchObject({ id: 's1', statut: 'Supprimée' })
    expect(soldes(operations)).toEqual(SOLDES.Orange)
  })

  it('[GA-23] saisir, encaisser en entier, puis corriger : le stock et la liquidité suivent le nouveau montant', () => {
    const s = saisie('s1')
    const regle = op('rg', REGLEMENT, { draftId: 's1', amount: 100, paymentMethod: 'Cash', type: 'Dépôt' })
    const { historique } = appliquerFile([], [], [s, regle])
    const operations = [s, regle, corriger('c1', historique[0], { montant: 80 })]
    expect(appliquerFile([], [], operations).historique[0]).toMatchObject({ id: 'c1', montant: 80, paymentMethod: 'Cash' })
    expect(soldes(operations)).toEqual({ stock: 920, liquidite: 580 })
  })

  it('[GA-24] corriger deux fois de suite vise la ligne que la première correction a créée', () => {
    const ligne = { id: 'h1', clientId: 'c1', type: 'Dépôt', reseau: 'Orange', montant: 100, statut: 'Encaissé par Cash', paymentMethod: 'Cash', effectiveNetwork: 'Liquidite', validatedAt: true }
    const c1 = corriger('c1', ligne, { montant: 80 })
    const { historique } = appliquerFile([], [ligne], [c1])
    const c2 = corriger('c2', historique[0], { montant: 70 })
    const apres = appliquerFile([], [ligne], [c1, c2])
    expect(apres.historique.map((l) => [l.id, l.montant])).toEqual([['c2', 70]])
    expect(soldesProvisoires({ Orange: { stock: 900, liquidite: 600 } }, [c1, c2]).soldes.Orange).toEqual({ stock: 930, liquidite: 570 })
  })

  it('[GA-25] une ligne partiellement réglée en attente est reconnue pour ce qu’elle est', () => {
    const { nonTerminees } = appliquerFile([nt('d1')], [], [op('rg', REGLEMENT, { draftId: 'd1', amount: 40, paymentMethod: 'Cash' })])
    expect(nonTerminees[0]).toMatchObject({ paidAmount: 40, remainingAmount: 60, settlementStatus: 'partial' })
  })
})

describe('TC-360 — resumeLigne', () => {
  it('[GA-26] il garde ce qu’il faut pour défaire la ligne, et rien de ce qu’IndexedDB ne garderait pas', () => {
    const resume = resumeLigne({
      id: 'h', client: { nom: 'X' }, type: 'Retrait', montant: 100, reseau: 'Orange', statut: 'Validée',
      directValidation: true, liquiditySplit: { Orange: 100 }, validatedAt: { toMillis: () => 1 }, createdAt: { toMillis: () => 1 },
      settlementSummary: { netByNetwork: { Orange: { paid: 1, refunded: 0 } }, agentCodes: ['x'] },
    })
    expect(resume).toEqual({
      type: 'Retrait', montant: 100, reseau: 'Orange', statut: 'Validée', paymentMethod: null, effectiveNetwork: null,
      directValidation: true, liquiditySplit: { Orange: 100 }, validatedAt: true,
      settlementSummary: { netByNetwork: { Orange: { paid: 1, refunded: 0 } } },
    })
    expect(resumeLigne(undefined)).toBeNull()
  })

  it('[GA-27] sans résumé, le provisoire ne devine rien', () => {
    const { appliquees } = soldesProvisoires(SOLDES, [op('m', MODIFICATION, { draftId: 'd', updates: {}, avant: null }), op('c', CORRECTION, { historyId: 'h', updates: {}, avant: null }), op('a', ANNULATION, { cible: CIBLE_VALIDEE, cibleId: 'h', avant: null })])
    expect(appliquees).toBe(0)
  })
})
