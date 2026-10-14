import { describe, it, expect } from 'vitest'
import {
  plierType,
  montantRestant,
  instantDerniereAction,
  ligneDeDocument,
  construireHistoriqueClient,
} from '../../functions/src/clients/historiqueClient.js'

/**
 * TC-255 — L'historique d'un agent, décidé sans Firestore.
 *
 * ⚠ CETTE FONCTION EST PURE POUR UNE RAISON PRÉCISE : elle décide ce qu'une
 *   boutique voit du travail d'une AUTRE boutique. Chaque cas doit pouvoir être
 *   éprouvé seul, sans émulateur, comme `aggregateOutstandingDrafts`.
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
    clientId: 'c1', type: 'Dépôt', montant: 250000, statut: 'Validée',
    reseau: 'Orange', code: '0123456', date: '13/10/2026 08:00',
    createdAt: ts(MATIN), operatorName: 'Awa',
    ...over,
  },
})

describe('TC-255 — le pli du type', () => {
  it('[TC-255-01] « Dépôt » et « Depot » sont le même type', () => {
    expect(plierType('Dépôt')).toBe('depot')
    expect(plierType('DEPOT')).toBe('depot')
    expect(plierType('  Retrait ')).toBe('retrait')
  })

  it('[TC-255-02] une valeur absente plie en chaîne vide', () => {
    expect(plierType(undefined)).toBe('')
    expect(plierType(null)).toBe('')
  })
})

describe('TC-255 — le montant qui reste', () => {
  /**
   * ⚠ LE RESTE, PAS LE MONTANT D'ORIGINE. Une non terminée partiellement réglée
   *   a déjà vu ses tranches passer dans les soldes.
   */
  it('[TC-255-03] `remainingAmount` fait autorité dès qu\'il est lisible', () => {
    expect(montantRestant({ montant: 100000, remainingAmount: 40000 })).toBe(40000)
    expect(montantRestant({ montant: 100000, remainingAmount: 0 })).toBe(0)
  })

  it('[TC-255-04] à défaut, le montant d\'origine', () => {
    expect(montantRestant({ montant: 100000 })).toBe(100000)
  })

  it('[TC-255-05] rien de lisible rend null, jamais zéro', () => {
    expect(montantRestant({})).toBeNull()
    expect(montantRestant({ montant: 'beaucoup' })).toBeNull()
  })
})

describe('TC-255 — une ligne construite depuis son document', () => {
  it('[TC-255-06] la boutique vient du CHEMIN, pas du champ recopié', () => {
    const ligne = ligneDeDocument({
      ...doc({ storeId: 'store-b', storeName: 'ANCIEN NOM' }),
      nomsDeBoutique: NOMS,
    })
    expect(ligne.storeId).toBe('store-a')
    expect(ligne.storeName).toBe('C2EGF OUAGA')
  })

  /** ⚠ Review Focus 4 : une boutique fermée ne doit ni planter ni afficher « undefined ». */
  it('[TC-255-07] une boutique absente de `stores` retombe sur le champ puis sur l\'id', () => {
    const avecChamp = ligneDeDocument({
      id: 'x', chemin: 'clients/store-z/history/x', source: 'history',
      donnees: { storeName: 'BOUTIQUE FERMÉE', type: 'Dépôt', montant: 1 },
      nomsDeBoutique: NOMS,
    })
    expect(avecChamp.storeName).toBe('BOUTIQUE FERMÉE')

    const sansRien = ligneDeDocument({
      id: 'y', chemin: 'clients/store-z/history/y', source: 'history',
      donnees: { type: 'Dépôt', montant: 1 },
      nomsDeBoutique: NOMS,
    })
    expect(sansRien.storeName).toBe('store-z')
  })

  it('[TC-255-08] les horodatages sont rendus en millisecondes', () => {
    const ligne = ligneDeDocument({ ...doc({ validatedAt: ts(SOIR) }), nomsDeBoutique: NOMS })
    expect(ligne.createdAt).toBe(MATIN)
    expect(ligne.validatedAt).toBe(SOIR)
  })

  it('[TC-255-09] une Date ou une chaîne sont acceptées comme horodatage', () => {
    expect(ligneDeDocument({ ...doc({ createdAt: new Date(MATIN) }), nomsDeBoutique: NOMS }).createdAt).toBe(MATIN)
    expect(ligneDeDocument({ ...doc({ createdAt: new Date(MATIN).toISOString() }), nomsDeBoutique: NOMS }).createdAt).toBe(MATIN)
  })

  it('[TC-255-10] un chemin illisible ne fait pas tomber la construction', () => {
    expect(ligneDeDocument({ id: 'z', chemin: 'nimporte', source: 'history', donnees: { type: 'Dépôt' }, nomsDeBoutique: NOMS }))
      .toMatchObject({ storeId: null, storeName: '—' })
  })
})

describe('TC-255 — ce qui est écarté', () => {
  /**
   * ⚠ Un ravitaillement est un mouvement de la BOUTIQUE. Le laisser ici
   *   l'afficherait sous le nom de l'agent, avec un code vide.
   */
  it('[TC-255-11] les mouvements de boutique ne sont pas des opérations d\'agent', () => {
    for (const type of ['Ravitaillement', 'Clôture', 'cloture', 'RAVITAILLEMENT']) {
      expect(ligneDeDocument({ ...doc({ type }), nomsDeBoutique: NOMS })).toBeNull()
    }
  })

  /** ⚠ Une ligne supprimée RESTE : un historique qui tait les annulations ment. */
  it('[TC-255-12] une ligne supprimée est conservée et marquée', () => {
    const ligne = ligneDeDocument({ ...doc({ deletedAt: ts(SOIR) }), nomsDeBoutique: NOMS })
    expect(ligne).not.toBeNull()
    expect(ligne.deletedAt).toBe(SOIR)
  })
})

describe('TC-255 — les deux sources réunies', () => {
  // Deux `createdAt` DISTINCTS, et c'est voulu : l'ordre attendu ci-dessous doit
  // décrire la clé de tri réelle (`createdAt`), pas un ex æquo départagé par
  // autre chose. Le cas « validée plus tard » a son test à lui, TC-255-17.
  const history = [
    doc({ createdAt: ts(MATIN), montant: 250000 }),
    { ...doc({ createdAt: ts(SOIR), montant: 75000 }), id: 'h2', chemin: 'clients/store-b/history/h2' },
  ]
  const drafts = [{
    id: 'd1', chemin: 'clients/store-a/drafts/d1', source: 'draft',
    donnees: { type: 'Retrait', montant: 100000, remainingAmount: 40000, statut: 'Non Terminées', createdAt: ts(MATIN) },
  }]

  it('[TC-255-13] les non terminées sortent à part, jamais mêlées à l\'historique', () => {
    const { enCours, lignes } = construireHistoriqueClient({ history, drafts, nomsDeBoutique: NOMS })
    expect(enCours.map((l) => l.id)).toEqual(['d1'])
    expect(lignes.map((l) => l.id)).toEqual(['h2', 'h1'])
  })

  /**
   * ⚠ C'EST LA RÈGLE DES NON TERMINÉES, PLUS CELLE DE L'HISTORIQUE. Cette
   *   fonction classe `enCours`, qui est chargé EN ENTIER — il n'y a pas de page
   *   suivante avec laquelle son ordre pourrait se brouiller. Pour `lignes`,
   *   voir TC-255-17 : la pagination impose sa clé.
   */
  it('[TC-255-14] la dernière action, c\'est le plus tard des deux instants', () => {
    expect(instantDerniereAction({ createdAt: MATIN, validatedAt: SOIR })).toBe(SOIR)
    expect(instantDerniereAction({ createdAt: SOIR, validatedAt: MATIN })).toBe(SOIR)
    expect(instantDerniereAction({})).toBe(0)
  })

  /**
   * ⚠ LA PROPRIÉTÉ QUI PROTÈGE LE CUMUL DES PAGES, et le défaut qu'elle ferme.
   *
   *   Le serveur pagine en `orderBy('createdAt','desc')`. Reclasser chaque page
   *   sur `max(createdAt, validatedAt)` trie BIEN la page et MAL son cumul :
   *   mesuré sur émulateur avec quatre lignes de `createdAt` décroissant
   *   d > c > b > a, dont b validée après d, en pages de deux, le cumul rendu
   *   était « d, c, b, a » — non décroissant, et b, l'opération la plus
   *   récemment traitée, se retrouvait en 3e position SOUS deux lignes plus
   *   anciennes. Deux tests passaient pourtant : l'un exigeait le tri sur la
   *   dernière action, l'autre la pagination sur `createdAt`. Aucun ne voyait
   *   leur rencontre.
   *
   *   Ici `recent` est créée APRÈS `ancienne` mais `ancienne` est validée plus
   *   tard. L'ordre doit suivre la création, sinon la clé d'affichage a de
   *   nouveau divergé de la clé de pagination.
   */
  it('[TC-255-17] l\'historique se classe sur `createdAt`, pas sur la validation', () => {
    const ancienne = { ...doc({ createdAt: ts(MATIN), validatedAt: ts(SOIR) }), id: 'ancienne' }
    const recente = { ...doc({ createdAt: ts(SOIR - 1) }), id: 'recente' }

    const { lignes } = construireHistoriqueClient({ history: [ancienne, recente], nomsDeBoutique: NOMS })

    expect(lignes.map((l) => l.id)).toEqual(['recente', 'ancienne'])
  })

  /** Les non terminées, elles, gardent bien la dernière action comme clé. */
  it('[TC-255-18] les non terminées se classent sur la dernière action', () => {
    const brouillon = (id, over) => ({
      id, chemin: `clients/store-a/drafts/${id}`, source: 'draft',
      donnees: { type: 'Retrait', montant: 1000, statut: 'Non Terminées', ...over },
    })
    const { enCours } = construireHistoriqueClient({
      drafts: [
        brouillon('vieille-mais-touchee', { createdAt: ts(MATIN), validatedAt: ts(SOIR) }),
        brouillon('recente', { createdAt: ts(SOIR - 1) }),
      ],
      nomsDeBoutique: NOMS,
    })

    expect(enCours.map((l) => l.id)).toEqual(['vieille-mais-touchee', 'recente'])
  })

  /**
   * ⚠ DEUX RESTES, PAS UN. Un dépôt non terminé est de l'argent que l'agent doit
   *   APPORTER ; un retrait non terminé est de l'argent que la boutique doit
   *   REMETTRE. Les additionner ne décrirait aucune dette réelle.
   */
  it('[TC-255-15] l\'attente sépare ce qu\'on encaisse de ce qu\'on paye', () => {
    const avecDepot = [...drafts, {
      id: 'd2', chemin: 'clients/store-b/drafts/d2', source: 'draft',
      donnees: { type: 'Depot', montant: 80000, statut: 'Non Terminées', createdAt: ts(MATIN) },
    }]
    const { attente } = construireHistoriqueClient({ history, drafts: avecDepot, nomsDeBoutique: NOMS })
    expect(attente).toEqual({ resteAEncaisser: 80000, resteAPayer: 40000, nbEnAttente: 2 })
  })

  /**
   * ⚠ LE DÉFAUT QUE CE GROUPE FERME EMPORTAIT L'APPLICATION ENTIÈRE.
   *
   *   Tous les écrivains d'opération mettent dans `date` une chaîne
   *   « JJ/MM/AAAA » (`dateFr()`), SAUF
   *   `functions/src/collaborations/confirmStoreCollaboration.js:181` qui y pose
   *   un `serverTimestamp()`. Cette ligne-là porte un `clientId` : elle sort de
   *   la requête de groupe comme les autres.
   *
   *   Ce qui suivait, mesuré : l'encodage du callable transforme le Timestamp en
   *   objet nu `{_seconds, _nanoseconds}` ; `LigneHistorique` rend
   *   `{ligne.date}` ; React refuse un objet comme enfant et jette. L'unique
   *   ErrorBoundary enveloppe `AppContent` ENTIER — l'écran complet, navigation
   *   comprise, était remplacé par la carte d'erreur, et toute réouverture de
   *   cet agent y ramenait. Un seul document mal typé rendait la page clients
   *   inutilisable.
   *
   *   La normalisation est ici, dans la fonction pure, parce que c'est le seul
   *   endroit qui voit TOUTES les sources.
   */
  describe('TC-255 — la date est toujours une chaîne', () => {
    it('[TC-255-19] un Timestamp dans `date` est reformaté, jamais recopié', () => {
      const ligne = ligneDeDocument(doc({ date: ts(MATIN), createdAt: ts(MATIN) }))

      expect(typeof ligne.date).toBe('string')
      // 13 octobre 2026 à 08:00 UTC, dans le fuseau de la boutique (UTC+0).
      expect(ligne.date).toBe('13/10/2026')
    })

    it('[TC-255-20] un objet quelconque ne traverse pas non plus', () => {
      const ligne = ligneDeDocument(doc({ date: { _seconds: 1760000000, _nanoseconds: 0 } }))
      expect(typeof ligne.date).toBe('string')
      expect(ligne.date).toBe('13/10/2026')
    })

    it('[TC-255-21] une chaîne est conservée telle quelle, à l\'espace près', () => {
      expect(ligneDeDocument(doc({ date: ' 09/10/2026 14:30 ' })).date).toBe('09/10/2026 14:30')
    })

    it('[TC-255-22] sans date lisible ni createdAt, la ligne rend une chaîne vide', () => {
      const ligne = ligneDeDocument(doc({ date: null, createdAt: null }))
      expect(ligne.date).toBe('')
    })
  })

  it('[TC-255-16] des sources vides rendent des listes vides, pas une erreur', () => {
    expect(construireHistoriqueClient({})).toEqual({
      enCours: [], lignes: [], attente: { resteAEncaisser: 0, resteAPayer: 0, nbEnAttente: 0 },
    })
  })
})
