import { describe, it, expect } from 'vitest'
import {
  plierType,
  montantRestant,
  instantDerniereAction,
  ligneDeDocument,
  construireHistoriqueClient,
} from '../../functions/src/clients/historiqueClient.js'

/**
 * TC-255 — L'historique d'un agent, decide sans Firestore.
 *
 * CETTE FONCTION EST PURE POUR UNE RAISON PRECISE : elle decide ce qu'une
 *   boutique voit du travail d'une AUTRE boutique. Chaque cas doit pouvoir etre
 *   eprouve seul, sans emulateur, comme `aggregateOutstandingDrafts`.
 */

const ts = (ms) => ({ toMillis: () => ms })
const MATIN = Date.UTC(2026, 9, 13, 8, 0)
const SOIR = Date.UTC(2026, 9, 13, 18, 0)

const NOMS = new Map([['store-a', 'C2EGF OUAGA'], ['store-b', 'C2EGF BOBO']])

const doc = (over = {}) => ({
  id: 'h1',
  chemin: 'clients/store-a/history/h1',
  source: 'history',
  donnees: {
    clientId: 'c1', type: 'Depot', montant: 250000, statut: 'Validee',
    reseau: 'Orange', code: '0123456', date: '13/10/2026 08:00',
    createdAt: ts(MATIN), operatorName: 'Awa',
    ...over,
  },
})

describe('TC-255 — le pli du type', () => {
  it('[TC-255-01] Depot et Depot sont le meme type', () => {
    expect(plierType('Depot')).toBe('depot')
    expect(plierType('DEPOT')).toBe('depot')
    expect(plierType('  Retrait ')).toBe('retrait')
  })

  it('[TC-255-02] une valeur absente plie en chaine vide', () => {
    expect(plierType(undefined)).toBe('')
    expect(plierType(null)).toBe('')
  })
})

describe('TC-255 — le montant qui reste', () => {
  /**
   * LE RESTE, PAS LE MONTANT D'ORIGINE. Une non terminee partiellement reglee
   *   a deja vu ses tranches passer dans les soldes.
   */
  it('[TC-255-03] remainingAmount fait autorite des qu il est lisible', () => {
    expect(montantRestant({ montant: 100000, remainingAmount: 40000 })).toBe(40000)
    expect(montantRestant({ montant: 100000, remainingAmount: 0 })).toBe(0)
  })

  it('[TC-255-04] a defaut, le montant d origine', () => {
    expect(montantRestant({ montant: 100000 })).toBe(100000)
  })

  it('[TC-255-05] rien de lisible rend null, jamais zero', () => {
    expect(montantRestant({})).toBeNull()
    expect(montantRestant({ montant: 'beaucoup' })).toBeNull()
  })
})

describe('TC-255 — une ligne construite depuis son document', () => {
  it('[TC-255-06] la boutique vient du CHEMIN, pas du champ recopie', () => {
    const ligne = ligneDeDocument({
      ...doc({ storeId: 'store-b', storeName: 'ANCIEN NOM' }),
      nomsDeBoutique: NOMS,
    })
    expect(ligne.storeId).toBe('store-a')
    expect(ligne.storeName).toBe('C2EGF OUAGA')
  })

  /** Review Focus 4 : une boutique fermee ne doit ni planter ni afficher undefined. */
  it('[TC-255-07] une boutique absente de stores retombe sur le champ puis sur l id', () => {
    const avecChamp = ligneDeDocument({
      id: 'x', chemin: 'clients/store-z/history/x', source: 'history',
      donnees: { storeName: 'BOUTIQUE FERMEE', type: 'Depot', montant: 1 },
      nomsDeBoutique: NOMS,
    })
    expect(avecChamp.storeName).toBe('BOUTIQUE FERMEE')

    const sansRien = ligneDeDocument({
      id: 'y', chemin: 'clients/store-z/history/y', source: 'history',
      donnees: { type: 'Depot', montant: 1 },
      nomsDeBoutique: NOMS,
    })
    expect(sansRien.storeName).toBe('store-z')
  })

  it('[TC-255-08] les horodatages sont rendus en millisecondes', () => {
    const ligne = ligneDeDocument({ ...doc({ validatedAt: ts(SOIR) }), nomsDeBoutique: NOMS })
    expect(ligne.createdAt).toBe(MATIN)
    expect(ligne.validatedAt).toBe(SOIR)
  })

  it('[TC-255-09] une Date ou une chaine sont acceptees comme horodatage', () => {
    expect(ligneDeDocument({ ...doc({ createdAt: new Date(MATIN) }), nomsDeBoutique: NOMS }).createdAt).toBe(MATIN)
    expect(ligneDeDocument({ ...doc({ createdAt: new Date(MATIN).toISOString() }), nomsDeBoutique: NOMS }).createdAt).toBe(MATIN)
  })

  it('[TC-255-10] un chemin illisible ne fait pas tomber la construction', () => {
    expect(ligneDeDocument({ id: 'z', chemin: 'nimporte', source: 'history', donnees: { type: 'Depot' }, nomsDeBoutique: NOMS }))
      .toMatchObject({ storeId: null, storeName: '—' })
  })
})

describe('TC-255 — ce qui est ecarte', () => {
  /**
   * Un ravitaillement est un mouvement de la BOUTIQUE. Le laisser ici
   *   l afficherait sous le nom de l agent, avec un code vide.
   */
  it('[TC-255-11] les mouvements de boutique ne sont pas des operations d agent', () => {
    for (const type of ['Ravitaillement', 'Cloture', 'cloture', 'RAVITAILLEMENT']) {
      expect(ligneDeDocument({ ...doc({ type }), nomsDeBoutique: NOMS })).toBeNull()
    }
  })

  /** Une ligne supprimee RESTE : un historique qui tait les annulations ment. */
  it('[TC-255-12] une ligne supprimee est conservee et marquee', () => {
    const ligne = ligneDeDocument({ ...doc({ deletedAt: ts(SOIR) }), nomsDeBoutique: NOMS })
    expect(ligne).not.toBeNull()
    expect(ligne.deletedAt).toBe(SOIR)
  })
})

describe('TC-255 — les deux sources reunies', () => {
  const history = [
    doc({ createdAt: ts(MATIN), montant: 250000 }),
    { ...doc({ createdAt: ts(MATIN), validatedAt: ts(SOIR), montant: 75000 }), id: 'h2', chemin: 'clients/store-b/history/h2' },
  ]
  const drafts = [{
    id: 'd1', chemin: 'clients/store-a/drafts/d1', source: 'draft',
    donnees: { type: 'Retrait', montant: 100000, remainingAmount: 40000, statut: 'Non Terminees', createdAt: ts(MATIN) },
  }]

  it('[TC-255-13] les non terminees sortent a part, jamais melees a l historique', () => {
    const { enCours, lignes } = construireHistoriqueClient({ history, drafts, nomsDeBoutique: NOMS })
    expect(enCours.map((l) => l.id)).toEqual(['d1'])
    expect(lignes.map((l) => l.id)).toEqual(['h2', 'h1'])
  })

  /** Le classement reprend la regle de l ecran : la derniere action en haut. */
  it('[TC-255-14] l historique est classe sur la derniere action', () => {
    expect(instantDerniereAction({ createdAt: MATIN, validatedAt: SOIR })).toBe(SOIR)
    expect(instantDerniereAction({ createdAt: SOIR, validatedAt: MATIN })).toBe(SOIR)
    expect(instantDerniereAction({})).toBe(0)
  })

  /**
   * DEUX RESTES, PAS UN. Un depot non termine est de l argent que l agent doit
   *   APPORTER ; un retrait non termine est de l argent que la boutique doit
   *   REMETTRE. Les additionner ne decrirait aucune dette reelle.
   */
  it('[TC-255-15] l attente separe ce qu on encaisse de ce qu on paye', () => {
    const avecDepot = [...drafts, {
      id: 'd2', chemin: 'clients/store-b/drafts/d2', source: 'draft',
      donnees: { type: 'Depot', montant: 80000, statut: 'Non Terminees', createdAt: ts(MATIN) },
    }]
    const { attente } = construireHistoriqueClient({ history, drafts: avecDepot, nomsDeBoutique: NOMS })
    expect(attente).toEqual({ resteAEncaisser: 80000, resteAPayer: 40000, nbEnAttente: 2 })
  })

  it('[TC-255-16] des sources vides rendent des listes vides, pas une erreur', () => {
    expect(construireHistoriqueClient({})).toEqual({
      enCours: [], lignes: [], attente: { resteAEncaisser: 0, resteAPayer: 0, nbEnAttente: 0 },
    })
  })
})
