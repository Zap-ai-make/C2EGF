# Historique d'un agent, toutes boutiques — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depuis la liste des clients, une colonne « Historique » ouvre un panneau latéral qui montre toutes les opérations d'un agent — y compris celles traitées par les autres boutiques — paginées, virtualisées, et lisibles jusqu'à la dernière ligne.

**Architecture :** `firestore.rules` interdit à une boutique de lire l'historique d'une autre. Une Cloud Function `listClientHistory` lit donc avec l'Admin SDK deux groupes de collections (`history` paginé par curseur, `drafts` en entier), résout le nom des boutiques depuis `stores`, et renvoie des lignes normalisées. Toute la décision vit dans une fonction PURE testable sans Firestore, comme `aggregateOutstandingDrafts` le fait déjà pour le dealer.

**Tech Stack :** Firebase Functions v2 (`onCall`, région `europe-west1`), firebase-admin 13.10 (`AggregateField.count/sum`), React 19, Vite, Tailwind v4, Vitest.

**Spec :** [docs/superpowers/specs/2026-10-13-historique-client-design.md](../specs/2026-10-13-historique-client-design.md)

## Global Constraints

- **Aucune écriture, nulle part.** Toute la fonctionnalité est en lecture seule.
- **`functions/` ne peut rien importer de `src/`.** Le dossier est déployé seul ; un import vers `src/` casse le déploiement. `listOutstandingDrafts.js` réimplémente `remainingAmount` localement pour cette raison — faire pareil.
- **Le dealer est refusé** (`role !== 'dealer'`), comme partout où une identité client circule.
- **Options du callable** : réutiliser la constante `CALLABLE` de `functions/src/index.js` (`region: 'europe-west1'`, `maxInstances: 3`). Ne jamais recopier ces valeurs.
- **Erreurs métier** : lever `DealerRequestError(code, message)` ; `wrapCallable` convertit. Tout code nouveau doit figurer dans `HTTP_CODES` de `functions/src/errors.js`.
- **Les types portent des accents incohérents en base** : « Dépôt » et « Depot » coexistent (`src/utils/caisse.js:12`). Toute comparaison de type passe par un pli accents+casse.
- **Tests** : `npm run test:unit` (jsdom), `npm run test:components`, `npm run test:functions` (émulateur Firestore, projet `demo-akayis-test`). `npx eslint src/ tests/ functions/` doit rester propre.
- **Commits** : français, impératif, sans accent dans le sujet (convention du dépôt). Jamais de `git push`.

## Review Focus

1. **L'émulateur Firestore ne vérifie AUCUN index.** Tous les tests passeront sans les index, et la fonction échouera en production à la première ouverture, avec une erreur que personne ne reliera au code. → Task 3, étape « le fichier d'index contient bien les deux entrées ».
2. **Deux opérations à la même seconde, de part et d'autre d'une page.** C'est courant en caisse. Un curseur posé sur le seul `createdAt` saute des lignes ou les répète. → Task 2, test de pagination avec `createdAt` identique.
3. **Un document d'historique sans `createdAt` est EXCLU par `orderBy`.** Firestore ignore les documents qui ne portent pas le champ trié : ces lignes ne seraient JAMAIS listées, sans message. Le dépôt en contient (tous les replis `parsefrenchDate(item.date)` existent pour ça). → Task 2, le total vient d'un `count()` SANS `orderBy`, et l'écart est annoncé.
4. **Une boutique absente de `stores`** (fermée, renommée, supprimée). Le nom doit retomber sur le champ recopié puis sur l'identifiant, sans planter ni afficher « undefined ». → Task 1.
5. **Un type de transaction inattendu** n'entre dans aucun total et le fausserait en silence. → Task 2, compteur `nonClassees` renvoyé et affiché.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `functions/src/clients/historiqueClient.js` | **créé** — pur : normalise un document en ligne, trie, calcule l'attente |
| `functions/src/clients/listClientHistory.js` | **créé** — le handler : autorisation, lectures, pagination, agrégats |
| `functions/src/errors.js` | **modifié** — trois codes d'erreur |
| `functions/src/index.js` | **modifié** — l'import et l'export du callable |
| `firestore.indexes.json` | **modifié** — deux index de groupe de collections |
| `src/services/clientHistoryService.js` | **créé** — l'appel du callable |
| `src/hooks/useHistoriqueClient.js` | **créé** — cumul des pages, états, dédoublonnage |
| `src/components/ui/Dialog.jsx` | **modifié** — variante latérale (`cote`) |
| `src/components/clients/HistoriqueClientPanel.jsx` | **créé** — le panneau |
| `src/components/clients/LigneHistorique.jsx` | **créé** — une ligne, mémoïsée (la liste est virtualisée) |
| `src/constants/index.js` | **modifié** — la colonne « Historique » |
| `src/components/TableRow.jsx` | **modifié** — la cellule et son bouton |
| `src/components/ClientsTable.jsx` | **modifié** — l'état du panneau ouvert |

---

## Task 1 : la fonction pure qui normalise une ligne

**Files:**
- Create: `functions/src/clients/historiqueClient.js`
- Test: `tests/unit/tc-255-historique-client-pur.test.js`

**Interfaces:**
- Consumes: rien.
- Produces :
  - `plierType(valeur) → string`
  - `montantRestant(ligne) → number|null`
  - `instantDerniereAction(ligne) → number`
  - `ligneDeDocument({ id, chemin, donnees, source, nomsDeBoutique }) → object|null`
  - `construireHistoriqueClient({ history, drafts, nomsDeBoutique }) → { enCours, lignes, attente }`
  - `TYPES_MOUVEMENT_BOUTIQUE`, `VARIANTES_DEPOT`, `VARIANTES_RETRAIT`

- [ ] **Step 1 : écrire le test qui échoue**

Créer `tests/unit/tc-255-historique-client-pur.test.js` :

```js
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
  it('[TC-255-03] `remainingAmount` fait autorité dès qu’il est lisible', () => {
    expect(montantRestant({ montant: 100000, remainingAmount: 40000 })).toBe(40000)
    expect(montantRestant({ montant: 100000, remainingAmount: 0 })).toBe(0)
  })

  it('[TC-255-04] à défaut, le montant d’origine', () => {
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
  it('[TC-255-07] une boutique absente de `stores` retombe sur le champ puis sur l’id', () => {
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
  it('[TC-255-11] les mouvements de boutique ne sont pas des opérations d’agent', () => {
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
  const history = [
    doc({ createdAt: ts(MATIN), montant: 250000 }),
    { ...doc({ createdAt: ts(MATIN), validatedAt: ts(SOIR), montant: 75000 }), id: 'h2', chemin: 'clients/store-b/history/h2' },
  ]
  const drafts = [{
    id: 'd1', chemin: 'clients/store-a/drafts/d1', source: 'draft',
    donnees: { type: 'Retrait', montant: 100000, remainingAmount: 40000, statut: 'Non Terminées', createdAt: ts(MATIN) },
  }]

  it('[TC-255-13] les non terminées sortent à part, jamais mêlées à l’historique', () => {
    const { enCours, lignes } = construireHistoriqueClient({ history, drafts, nomsDeBoutique: NOMS })
    expect(enCours.map((l) => l.id)).toEqual(['d1'])
    expect(lignes.map((l) => l.id)).toEqual(['h2', 'h1'])
  })

  /** ⚠ Le classement reprend la règle de l'écran : la dernière action en haut. */
  it('[TC-255-14] l’historique est classé sur la dernière action', () => {
    expect(instantDerniereAction({ createdAt: MATIN, validatedAt: SOIR })).toBe(SOIR)
    expect(instantDerniereAction({ createdAt: SOIR, validatedAt: MATIN })).toBe(SOIR)
    expect(instantDerniereAction({})).toBe(0)
  })

  /**
   * ⚠ DEUX RESTES, PAS UN. Un dépôt non terminé est de l'argent que l'agent doit
   *   APPORTER ; un retrait non terminé est de l'argent que la boutique doit
   *   REMETTRE. Les additionner ne décrirait aucune dette réelle.
   */
  it('[TC-255-15] l’attente sépare ce qu’on encaisse de ce qu’on paye', () => {
    const avecDepot = [...drafts, {
      id: 'd2', chemin: 'clients/store-b/drafts/d2', source: 'draft',
      donnees: { type: 'Depot', montant: 80000, statut: 'Non Terminées', createdAt: ts(MATIN) },
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
```

- [ ] **Step 2 : lancer le test pour le voir échouer**

```bash
npx vitest run tests/unit/tc-255-historique-client-pur.test.js
```
Attendu : ÉCHEC — `Failed to resolve import ".../functions/src/clients/historiqueClient.js"`.

- [ ] **Step 3 : écrire la fonction pure**

Créer `functions/src/clients/historiqueClient.js` :

```js
/**
 * historiqueClient.js — ce qu'une boutique voit du travail d'une autre.
 *
 * PUR : aucune I/O, aucun Firestore. `listClientHistory.js` apporte les
 * documents ; ce module décide ce qu'ils deviennent. Même séparation que
 * `aggregateOutstandingDrafts`, et pour la même raison : une lecture qui
 * traverse la frontière entre boutiques doit être éprouvable cas par cas.
 *
 * ⚠ CE MODULE NE PEUT RIEN IMPORTER DE `src/`. Le dossier `functions/` est
 *   déployé seul : un import vers l'application casserait le déploiement. D'où
 *   la réimplémentation de `montantRestant`, qui existe aussi dans
 *   `src/utils/argentDehors.js`. `listOutstandingDrafts.js` fait de même.
 */

/** Les mouvements de la BOUTIQUE, qui ne sont pas des opérations d'agent. */
export const TYPES_MOUVEMENT_BOUTIQUE = Object.freeze(['ravitaillement', 'cloture'])

/**
 * Les écritures du type rencontrées en base.
 *
 * ⚠ « Dépôt » ET « Depot » COEXISTENT, et ce n'est pas une hypothèse :
 *   `src/utils/caisse.js` plie déjà les accents pour cette raison exacte. Toute
 *   comparaison directe en manquerait la moitié.
 */
export const VARIANTES_DEPOT = Object.freeze(['Dépôt', 'Depot', 'dépôt', 'depot', 'DÉPÔT', 'DEPOT'])
export const VARIANTES_RETRAIT = Object.freeze(['Retrait', 'retrait', 'RETRAIT'])

/** Accents et casse retirés — « Dépôt » et « Depot » deviennent « depot ». */
export const plierType = (valeur) => String(valeur ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .trim()
  .toLowerCase()

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Le montant qu'une non terminée laisse réellement dehors.
 *
 * `remainingAmount` fait autorité dès qu'il est lisible : il vaut 0 sur une
 * transaction soldée. On ne retombe sur `montant` que s'il est absent.
 */
export function montantRestant(ligne) {
  if (estNombre(ligne?.remainingAmount)) return ligne.remainingAmount
  if (estNombre(ligne?.montant)) return ligne.montant
  return null
}

/** Un Timestamp Firestore, une Date ou une chaîne, ramenés en millisecondes. */
const enMillisecondes = (brut) => {
  if (!brut) return 0
  if (typeof brut.toMillis === 'function') return brut.toMillis()
  const date = brut instanceof Date ? brut : new Date(brut)
  const t = date.getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * L'instant de la DERNIÈRE ACTION — c'est lui qui classe.
 *
 * Une opération notée le matin et validée le soir garde le `createdAt` du
 * brouillon : le serveur le recopie tel quel. Classée là-dessus, elle
 * réapparaîtrait au milieu de la matinée alors qu'on vient de la traiter.
 * Même règle que `src/context/transactions.jsx`.
 */
export const instantDerniereAction = (ligne) => Math.max(
  Number(ligne?.createdAt) || 0,
  Number(ligne?.validatedAt) || 0,
)

/** « clients/store-a/history/h1 » → « store-a ». Null si le chemin n'a pas cette forme. */
const boutiqueDuChemin = (chemin) => {
  const morceaux = String(chemin ?? '').split('/')
  return morceaux.length >= 2 && morceaux[0] === 'clients' ? morceaux[1] : null
}

/**
 * Une ligne affichable, ou `null` si le document n'en est pas une.
 *
 * ⚠ LA BOUTIQUE VIENT DU CHEMIN. `storeName` recopié dans le document peut
 *   dater d'un renommage ; le chemin, lui, ne ment pas. Le nom est résolu
 *   depuis `stores`, puis depuis le champ recopié, puis depuis l'identifiant —
 *   une boutique fermée reste nommée par quelque chose plutôt que par rien.
 */
export function ligneDeDocument({ id, chemin, donnees = {}, source, nomsDeBoutique }) {
  const type = plierType(donnees.type)
  if (TYPES_MOUVEMENT_BOUTIQUE.includes(type)) return null

  const storeId = boutiqueDuChemin(chemin)
  const storeName = (storeId && nomsDeBoutique?.get?.(storeId))
    || String(donnees.storeName ?? '').trim()
    || storeId
    || '—'

  return {
    id,
    source,
    storeId,
    storeName,
    type: donnees.type ?? '',
    typePlie: type,
    montant: estNombre(donnees.montant) ? donnees.montant : null,
    reste: montantRestant(donnees),
    statut: donnees.statut ?? '',
    reseau: donnees.reseau ?? '',
    code: donnees.code ?? '',
    date: donnees.date ?? '',
    createdAt: enMillisecondes(donnees.createdAt),
    validatedAt: enMillisecondes(donnees.validatedAt),
    deletedAt: enMillisecondes(donnees.deletedAt) || null,
    paidAmount: estNombre(donnees.paidAmount) ? donnees.paidAmount : null,
    refundedAmount: estNombre(donnees.refundedAmount) ? donnees.refundedAmount : null,
    settlementStatus: donnees.settlementStatus ?? null,
    operatorName: donnees.operatorName ?? '',
  }
}

/**
 * Les deux sources, réunies et classées.
 *
 * ⚠ LES NON TERMINÉES SORTENT À PART. Ce sont des opérations EN COURS, peu
 *   nombreuses, et ce qu'on vient voir en premier. Les mêler à la liste paginée
 *   produirait un défaut visible : une non terminée vieille de trois mois
 *   s'afficherait dès la première page, puis se ferait dépasser par des lignes
 *   plus récentes à chaque « charger plus ».
 */
export function construireHistoriqueClient({ history = [], drafts = [], nomsDeBoutique = new Map() } = {}) {
  const convertir = (documents, source) => documents
    .map((d) => ligneDeDocument({ ...d, source, nomsDeBoutique }))
    .filter(Boolean)

  const enCours = convertir(drafts, 'draft')
    .sort((a, b) => instantDerniereAction(b) - instantDerniereAction(a))
  const lignes = convertir(history, 'history')
    .sort((a, b) => instantDerniereAction(b) - instantDerniereAction(a))

  const attente = { resteAEncaisser: 0, resteAPayer: 0, nbEnAttente: enCours.length }
  for (const ligne of enCours) {
    const reste = Number(ligne.reste) || 0
    if (ligne.typePlie === 'depot') attente.resteAEncaisser += reste
    else if (ligne.typePlie === 'retrait') attente.resteAPayer += reste
  }

  return { enCours, lignes, attente }
}
```

- [ ] **Step 4 : lancer le test pour le voir passer**

```bash
npx vitest run tests/unit/tc-255-historique-client-pur.test.js
```
Attendu : PASS, 16 tests.

- [ ] **Step 5 : lint**

```bash
npx eslint functions/src/clients/historiqueClient.js tests/unit/tc-255-historique-client-pur.test.js
```
Attendu : aucune sortie.

- [ ] **Step 6 : commit**

```bash
git add functions/src/clients/historiqueClient.js tests/unit/tc-255-historique-client-pur.test.js
git commit -m "feat: normaliser une operation d agent, quelle que soit la boutique

La boutique vient du chemin et non du champ recopie, qui peut dater d un
renommage. Les non terminees sortent a part : melees a la liste paginee, une
non terminee de trois mois s afficherait des la premiere page puis se ferait
depasser a chaque chargement.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2 : le handler, sa pagination et ses agrégats

**Files:**
- Create: `functions/src/clients/listClientHistory.js`
- Modify: `functions/src/errors.js` (ajout de trois codes)
- Test: `tests/functions/tc-256-list-client-history.test.js`

**Interfaces:**
- Consumes: `construireHistoriqueClient`, `plierType`, `VARIANTES_DEPOT`, `VARIANTES_RETRAIT` (Task 1) ; `validateAuthUid`, `validateInputPayload`, `readValidatedProfile` (`functions/src/dealerRequests/shared.js`) ; `DealerRequestError` (`functions/src/errors.js`).
- Produces :
  - `PAGE = 50`
  - `validerClientId(valeur) → string`
  - `validerCurseur(valeur) → null | { createdAt: number, chemin: string }`
  - `listClientHistoryHandler(request, { db }) → { success, enCours, lignes, totaux, curseurSuivant, encore }`

> `enCours` et `totaux` ne sont renseignés QUE sur la première page (curseur absent) ; sur les suivantes ils valent `[]` et `null`.

- [ ] **Step 1 : ajouter les codes d'erreur**

Dans `functions/src/errors.js`, à la suite de `INVALID_CLIENT_ID`, ajouter :

```js
  // Historique d'un agent, toutes boutiques
  INVALID_HISTORY_CURSOR:        'invalid-argument',
  HISTORY_ROLE_FORBIDDEN:        'permission-denied',
```

- [ ] **Step 2 : écrire le test qui échoue**

Créer `tests/functions/tc-256-list-client-history.test.js` :

```js
/**
 * TC-256 — listClientHistory : l'historique d'un agent, toutes boutiques.
 *   Handler integration avec Firestore Emulator, { db } injecté.
 *
 * Comportement protégé :
 *   autorisation : refus sans auth, profil inactif, DEALER refusé (une identité
 *                  client ne doit jamais lui parvenir), payload hors liste blanche.
 *   lecture      : deux boutiques réunies en une seule liste ; non terminées à part.
 *   pagination   : pages de 50, curseur sérialisable, ex æquo sur createdAt.
 *   totaux       : comptés sur TOUT l'historique, pas sur la page.
 *
 * Exécution : npm run test:functions (émulateur Firestore, projet demo-akayis-test).
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { listClientHistoryHandler, PAGE } from '../../functions/src/clients/listClientHistory.js'

let adminApp
let db

const PROJECT_ID = process.env.GCLOUD_PROJECT
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST

beforeAll(() => {
  if (!FIRESTORE_HOST) throw new Error('SÉCURITÉ : FIRESTORE_EMULATOR_HOST non défini. Lancer via : npm run test:functions')
  if (!PROJECT_ID) throw new Error('SÉCURITÉ : GCLOUD_PROJECT non défini. Lancer via : npm run test:functions')
  if (PROJECT_ID !== 'demo-akayis-test') throw new Error(`SÉCURITÉ : projectId doit être "demo-akayis-test". Reçu : "${PROJECT_ID}"`)
  adminApp = getApps().length === 0 ? initializeApp({ projectId: PROJECT_ID }) : getApps()[0]
  db = getFirestore(adminApp)
})

afterAll(async () => { if (adminApp) await deleteApp(adminApp) })

const effacer = async (chemin) => {
  const snap = await db.collection(chemin).get()
  await Promise.all(snap.docs.map((d) => d.ref.delete()))
}

const CAISSIERE = { uid: 'u-caissiere', role: 'store_member', storeId: 'store-a', active: true, name: 'Awa' }
const DEALER = { uid: 'u-dealer', role: 'dealer', active: true, name: 'Le dealer' }
const INACTIVE = { uid: 'u-inactive', role: 'store_member', storeId: 'store-a', active: false, name: 'Ex' }

const appel = (uid, data = { clientId: 'c1' }) =>
  listClientHistoryHandler({ auth: { uid }, data }, { db })

const poser = (chemin, id, donnees) => db.doc(`${chemin}/${id}`).set(donnees)

beforeEach(async () => {
  await Promise.all([
    effacer('clients/store-a/history'), effacer('clients/store-b/history'),
    effacer('clients/store-a/drafts'), effacer('clients/store-b/drafts'),
    effacer('stores'), effacer('users'),
  ])
  for (const p of [CAISSIERE, DEALER, INACTIVE]) await db.doc(`users/${p.uid}`).set(p)
  await db.doc('stores/store-a').set({ name: 'C2EGF OUAGA', active: true })
  await db.doc('stores/store-b').set({ name: 'C2EGF BOBO', active: true })
})

const ligne = (over = {}) => ({
  clientId: 'c1', type: 'Dépôt', montant: 100, statut: 'Validée',
  createdAt: Timestamp.fromMillis(Date.UTC(2026, 9, 13, 8, 0)), operatorName: 'Awa',
  ...over,
})

describe('TC-256 — autorisation', () => {
  it('[TC-256-01] refuse un appel sans authentification', async () => {
    await expect(listClientHistoryHandler({ auth: null, data: { clientId: 'c1' } }, { db }))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('[TC-256-02] refuse un profil inactif', async () => {
    await expect(appel('u-inactive')).rejects.toMatchObject({ code: 'PROFILE_INACTIVE' })
  })

  /**
   * ⚠ LE DEALER EST REFUSÉ, ET CE N'EST PAS UN DÉTAIL. Les règles ne lui donnent
   *   aujourd'hui qu'un agrégat sans aucune identité client ; cette fonction rend
   *   des noms et des montants nominatifs.
   */
  it('[TC-256-03] refuse le dealer', async () => {
    await expect(appel('u-dealer')).rejects.toMatchObject({ code: 'HISTORY_ROLE_FORBIDDEN' })
  })

  it('[TC-256-04] refuse un profil inexistant', async () => {
    await expect(appel('u-fantome')).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND' })
  })

  it('[TC-256-05] refuse une clé hors liste blanche', async () => {
    await expect(appel('u-caissiere', { clientId: 'c1', storeId: 'store-b' }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST_ID' })
  })

  it('[TC-256-06] refuse un clientId vide ou non textuel', async () => {
    await expect(appel('u-caissiere', { clientId: '' })).rejects.toMatchObject({ code: 'INVALID_CLIENT_ID' })
    await expect(appel('u-caissiere', { clientId: 42 })).rejects.toMatchObject({ code: 'INVALID_CLIENT_ID' })
  })

  /** Un curseur mal formé est REFUSÉ, jamais ignoré : l'ignorer renverrait la page 1. */
  it('[TC-256-07] refuse un curseur mal formé', async () => {
    await expect(appel('u-caissiere', { clientId: 'c1', curseur: { createdAt: 'hier' } }))
      .rejects.toMatchObject({ code: 'INVALID_HISTORY_CURSOR' })
    await expect(appel('u-caissiere', { clientId: 'c1', curseur: 'abc' }))
      .rejects.toMatchObject({ code: 'INVALID_HISTORY_CURSOR' })
  })
})

describe('TC-256 — les deux boutiques réunies', () => {
  it('[TC-256-08] rend les opérations des deux boutiques, nommées', async () => {
    await poser('clients/store-a/history', 'h1', ligne({ montant: 250 }))
    await poser('clients/store-b/history', 'h2', ligne({ montant: 75, createdAt: Timestamp.fromMillis(Date.UTC(2026, 9, 12, 8, 0)) }))

    const { lignes } = await appel('u-caissiere')
    expect(lignes.map((l) => l.storeName)).toEqual(['C2EGF OUAGA', 'C2EGF BOBO'])
    expect(lignes.map((l) => l.montant)).toEqual([250, 75])
  })

  it('[TC-256-09] n’inclut jamais les opérations d’un autre client', async () => {
    await poser('clients/store-a/history', 'h1', ligne())
    await poser('clients/store-a/history', 'autre', ligne({ clientId: 'c2' }))

    const { lignes } = await appel('u-caissiere')
    expect(lignes).toHaveLength(1)
  })

  it('[TC-256-10] les non terminées sortent dans `enCours`, pas dans `lignes`', async () => {
    await poser('clients/store-a/history', 'h1', ligne())
    await poser('clients/store-b/drafts', 'd1', ligne({ type: 'Retrait', montant: 100, remainingAmount: 40, statut: 'Non Terminées' }))

    const { lignes, enCours, totaux } = await appel('u-caissiere')
    expect(lignes.map((l) => l.id)).toEqual(['h1'])
    expect(enCours.map((l) => l.id)).toEqual(['d1'])
    expect(totaux.resteAPayer).toBe(40)
    expect(totaux.resteAEncaisser).toBe(0)
  })

  it('[TC-256-11] un client sans aucune opération rend des listes vides, pas une erreur', async () => {
    const reponse = await appel('u-caissiere')
    expect(reponse).toMatchObject({ success: true, lignes: [], enCours: [], encore: false, curseurSuivant: null })
    expect(reponse.totaux.operations).toBe(0)
  })

  it('[TC-256-12] les ravitaillements et clôtures sont écartés', async () => {
    await poser('clients/store-a/history', 'r1', ligne({ type: 'Ravitaillement' }))
    await poser('clients/store-a/history', 'c1', ligne({ type: 'Clôture' }))
    await poser('clients/store-a/history', 'h1', ligne())

    const { lignes } = await appel('u-caissiere')
    expect(lignes.map((l) => l.id)).toEqual(['h1'])
  })
})

describe('TC-256 — la pagination', () => {
  const poserPlusieurs = async (combien, ms = (i) => Date.UTC(2026, 9, 13, 0, 0) + i * 60000) => {
    for (let i = 0; i < combien; i += 1) {
      await poser('clients/store-a/history', `h${String(i).padStart(3, '0')}`, ligne({
        montant: i, createdAt: Timestamp.fromMillis(ms(i)),
      }))
    }
  }

  it('[TC-256-13] la première page est bornée et annonce la suite', async () => {
    await poserPlusieurs(PAGE + 10)
    const page1 = await appel('u-caissiere')

    expect(page1.lignes).toHaveLength(PAGE)
    expect(page1.encore).toBe(true)
    expect(page1.curseurSuivant).toMatchObject({ createdAt: expect.any(Number), chemin: expect.any(String) })
  })

  it('[TC-256-14] la page suivante reprend exactement où la première s’arrête', async () => {
    await poserPlusieurs(PAGE + 10)
    const page1 = await appel('u-caissiere')
    const page2 = await appel('u-caissiere', { clientId: 'c1', curseur: page1.curseurSuivant })

    expect(page2.lignes).toHaveLength(10)
    expect(page2.encore).toBe(false)
    expect(page2.curseurSuivant).toBeNull()

    const tous = [...page1.lignes, ...page2.lignes].map((l) => l.id)
    expect(new Set(tous).size).toBe(PAGE + 10)
  })

  /** Les pages suivantes ne recalculent ni les totaux ni les non terminées. */
  it('[TC-256-15] seule la première page porte les totaux et les non terminées', async () => {
    await poserPlusieurs(PAGE + 1)
    const page1 = await appel('u-caissiere')
    const page2 = await appel('u-caissiere', { clientId: 'c1', curseur: page1.curseurSuivant })

    expect(page1.totaux).not.toBeNull()
    expect(page2.totaux).toBeNull()
    expect(page2.enCours).toEqual([])
  })

  /**
   * ⚠ REVIEW FOCUS 2 — DEUX OPÉRATIONS À LA MÊME SECONDE. C'est courant en
   *   caisse. Sans `__name__` en second critère de tri ET dans le curseur, la
   *   page suivante saute des lignes ou les répète, sans aucun message.
   */
  it('[TC-256-16] des opérations au même instant ne sont ni perdues ni répétées', async () => {
    await poserPlusieurs(PAGE + 5, () => Date.UTC(2026, 9, 13, 10, 0))

    const page1 = await appel('u-caissiere')
    const page2 = await appel('u-caissiere', { clientId: 'c1', curseur: page1.curseurSuivant })

    const tous = [...page1.lignes, ...page2.lignes].map((l) => l.id)
    expect(tous).toHaveLength(PAGE + 5)
    expect(new Set(tous).size).toBe(PAGE + 5)
  })
})

describe('TC-256 — les totaux portent sur tout, pas sur la page', () => {
  it('[TC-256-17] le compte dépasse la page chargée', async () => {
    for (let i = 0; i < PAGE + 7; i += 1) {
      await poser('clients/store-a/history', `h${i}`, ligne({ createdAt: Timestamp.fromMillis(Date.UTC(2026, 9, 13) + i * 1000) }))
    }
    const { lignes, totaux } = await appel('u-caissiere')
    expect(lignes).toHaveLength(PAGE)
    expect(totaux.operations).toBe(PAGE + 7)
  })

  it('[TC-256-18] les montants sont sommés par type, accents compris', async () => {
    await poser('clients/store-a/history', 'h1', ligne({ type: 'Dépôt', montant: 100 }))
    await poser('clients/store-a/history', 'h2', ligne({ type: 'Depot', montant: 50 }))
    await poser('clients/store-b/history', 'h3', ligne({ type: 'Retrait', montant: 30 }))

    const { totaux } = await appel('u-caissiere')
    expect(totaux.depots).toBe(150)
    expect(totaux.retraits).toBe(30)
  })

  /**
   * ⚠ REVIEW FOCUS 5 — UN TYPE INATTENDU N'ENTRE DANS AUCUN TOTAL. Le taire
   *   ferait afficher une somme fausse sans que rien ne le dise. On le compte.
   */
  it('[TC-256-19] les opérations d’un type inattendu sont comptées à part', async () => {
    await poser('clients/store-a/history', 'h1', ligne({ type: 'Dépôt', montant: 100 }))
    await poser('clients/store-a/history', 'h2', ligne({ type: 'Transfert', montant: 999 }))

    const { totaux } = await appel('u-caissiere')
    expect(totaux.depots).toBe(100)
    expect(totaux.nonClassees).toBe(1)
  })

  /**
   * ⚠ REVIEW FOCUS 3 — UN DOCUMENT SANS `createdAt` EST EXCLU PAR `orderBy`.
   *   Firestore ignore les documents qui ne portent pas le champ trié : ces
   *   lignes ne seraient JAMAIS listées, et rien ne le dirait. Le total vient
   *   d'un `count()` SANS `orderBy`, donc l'écart se voit.
   */
  it('[TC-256-20] une ligne sans horodatage est comptée même si elle ne peut pas être listée', async () => {
    await poser('clients/store-a/history', 'h1', ligne())
    await poser('clients/store-a/history', 'vieille', { clientId: 'c1', type: 'Dépôt', montant: 7, date: '01/01/2025' })

    const { lignes, totaux } = await appel('u-caissiere')
    expect(lignes).toHaveLength(1)
    expect(totaux.operations).toBe(2)
    expect(totaux.nonDatees).toBe(1)
  })

  it('[TC-256-21] le récapitulatif par boutique compte chaque boutique', async () => {
    await poser('clients/store-a/history', 'h1', ligne())
    await poser('clients/store-a/history', 'h2', ligne())
    await poser('clients/store-b/history', 'h3', ligne())

    const { totaux } = await appel('u-caissiere')
    expect(totaux.parBoutique).toEqual([
      { storeId: 'store-a', storeName: 'C2EGF OUAGA', operations: 2 },
      { storeId: 'store-b', storeName: 'C2EGF BOBO', operations: 1 },
    ])
  })
})
```

- [ ] **Step 3 : lancer le test pour le voir échouer**

```bash
npx firebase emulators:exec --only firestore --project demo-akayis-test "npx vitest run --config vitest.functions.config.js tests/functions/tc-256-list-client-history.test.js"
```
Attendu : ÉCHEC — module `listClientHistory.js` introuvable.

- [ ] **Step 4 : écrire le handler**

Créer `functions/src/clients/listClientHistory.js` :

```js
/**
 * listClientHistory.js — tout ce qu'un agent a fait, quelle que soit la boutique.
 *
 * POURQUOI CETTE FONCTION EXISTE
 * ──────────────────────────────
 * `firestore.rules` ferme `clients/{storeId}/history` aux autres boutiques, et
 * la lecture par groupe de collections est réservée au gérant système. Aucune
 * requête navigateur ne peut donc répondre à « combien cet agent doit-il, toutes
 * boutiques confondues ». L'Admin SDK le peut, et c'est ici qu'on décide ce qui
 * sort — exactement le motif de `listOutstandingDrafts` pour le dealer.
 *
 * ⚠ LE DEALER EST REFUSÉ. Les règles ne lui donnent qu'un agrégat sans identité
 *   client ; cette fonction rend des noms et des montants nominatifs.
 */

import { AggregateField, Timestamp } from 'firebase-admin/firestore'
import { DealerRequestError } from '../errors.js'
import {
  readValidatedProfile,
  validateAuthUid,
  validateInputPayload,
} from '../dealerRequests/shared.js'
import {
  construireHistoriqueClient,
  VARIANTES_DEPOT,
  VARIANTES_RETRAIT,
} from './historiqueClient.js'

/** La taille d'une page. Le panneau charge la suite à la demande. */
export const PAGE = 50

const estNombreFini = (v) => typeof v === 'number' && Number.isFinite(v)

export function validerClientId(valeur) {
  if (typeof valeur !== 'string' || valeur.trim().length === 0 || valeur !== valeur.trim() || valeur.length > 128) {
    throw new DealerRequestError('INVALID_CLIENT_ID', 'Identifiant client invalide.')
  }
  return valeur
}

/**
 * Le curseur, ou `null` s'il n'y en a pas.
 *
 * ⚠ UN CURSEUR MAL FORMÉ EST REFUSÉ, JAMAIS IGNORÉ. L'ignorer renverrait
 *   silencieusement la première page : l'appelant croirait avancer et relirait
 *   indéfiniment les mêmes lignes.
 *
 * ⚠ C'EST UNE PAIRE DE VALEURS, PAS UN `DocumentSnapshot`. Un snapshot ne
 *   traverse pas la frontière d'un callable.
 */
export function validerCurseur(valeur) {
  if (valeur === undefined || valeur === null) return null
  if (
    typeof valeur !== 'object'
    || Array.isArray(valeur)
    || !estNombreFini(valeur.createdAt)
    || typeof valeur.chemin !== 'string'
    || valeur.chemin.trim().length === 0
  ) {
    throw new DealerRequestError('INVALID_HISTORY_CURSOR', 'Curseur de pagination invalide.')
  }
  return { createdAt: valeur.createdAt, chemin: valeur.chemin }
}

const validerProfilBoutique = (profile) => {
  if (!profile?.active) {
    throw new DealerRequestError('PROFILE_INACTIVE', 'Votre compte est désactivé.')
  }
  if (profile.role === 'dealer') {
    throw new DealerRequestError('HISTORY_ROLE_FORBIDDEN', "L'historique nominatif d'un agent n'est pas accessible au dealer.")
  }
}

/**
 * Les totaux, calculés sur TOUT l'historique du client.
 *
 * ⚠ ILS NE PORTENT PAS SUR LA PAGE. Un « 12 300 000 déposés » qui grandit à
 *   chaque « charger plus » se lit comme un total alors qu'il n'en est pas un.
 *
 * ⚠ LE COMPTE GLOBAL SE FAIT SANS `orderBy`, ET C'EST LE POINT. Firestore exclut
 *   d'une requête triée les documents qui ne portent pas le champ trié : une
 *   vieille ligne sans `createdAt` ne peut pas être listée. Le `count()` la voit,
 *   lui, et l'écart devient `nonDatees` — un nombre affiché plutôt qu'un silence.
 */
async function calculerTotaux(db, clientId) {
  const base = db.collectionGroup('history').where('clientId', '==', clientId)

  const [global, depots, retraits, datees] = await Promise.all([
    base.aggregate({ n: AggregateField.count() }).get(),
    base.where('type', 'in', VARIANTES_DEPOT)
      .aggregate({ n: AggregateField.count(), somme: AggregateField.sum('montant') }).get(),
    base.where('type', 'in', VARIANTES_RETRAIT)
      .aggregate({ n: AggregateField.count(), somme: AggregateField.sum('montant') }).get(),
    base.orderBy('createdAt', 'desc').aggregate({ n: AggregateField.count() }).get(),
  ])

  const operations = global.data().n ?? 0
  const nbDepots = depots.data().n ?? 0
  const nbRetraits = retraits.data().n ?? 0

  return {
    operations,
    depots: depots.data().somme ?? 0,
    retraits: retraits.data().somme ?? 0,
    nonClassees: Math.max(0, operations - nbDepots - nbRetraits),
    nonDatees: Math.max(0, operations - (datees.data().n ?? 0)),
  }
}

/** Le compte d'opérations par boutique — une requête par boutique active. */
async function compterParBoutique(db, clientId, boutiques) {
  const comptes = await Promise.all(boutiques.map(async ({ storeId, storeName }) => {
    const snap = await db.collection(`clients/${storeId}/history`)
      .where('clientId', '==', clientId)
      .aggregate({ n: AggregateField.count() })
      .get()
    return { storeId, storeName, operations: snap.data().n ?? 0 }
  }))
  return comptes
    .filter((b) => b.operations > 0)
    .sort((a, b) => b.operations - a.operations || a.storeName.localeCompare(b.storeName, 'fr'))
}

export async function listClientHistoryHandler(request, { db }) {
  const actorUid = validateAuthUid(request.auth?.uid)
  validateInputPayload(request.data ?? {}, ['clientId', 'curseur'])
  const clientId = validerClientId(request.data?.clientId)
  const curseur = validerCurseur(request.data?.curseur)

  await readValidatedProfile(db, actorUid, validerProfilBoutique)

  // ⚠ `__name__` EN SECOND CRITÈRE : deux opérations peuvent partager la même
  //   seconde. Un curseur posé sur le seul `createdAt` sauterait les ex æquo ou
  //   les rendrait deux fois. Firestore ajoute `__name__` dans la direction du
  //   dernier `orderBy` — l'index composite couvre donc déjà cette requête.
  let requete = db.collectionGroup('history')
    .where('clientId', '==', clientId)
    .orderBy('createdAt', 'desc')
    .orderBy('__name__', 'desc')
  if (curseur) {
    // `startAfter` prend les VALEURS des champs triés, dans l'ordre des
    // `orderBy` : l'horodatage, puis une RÉFÉRENCE de document pour `__name__`.
    requete = requete.startAfter(Timestamp.fromMillis(curseur.createdAt), db.doc(curseur.chemin))
  }

  const premierePage = curseur === null

  // On demande une ligne de plus que la page : sa présence dit qu'il reste à
  // lire, sans coûter une seconde requête pour le savoir.
  const [historySnap, draftsSnap, storesSnap] = await Promise.all([
    requete.limit(PAGE + 1).get(),
    premierePage
      ? db.collectionGroup('drafts').where('clientId', '==', clientId).get()
      : Promise.resolve({ docs: [] }),
    db.collection('stores').get(),
  ])

  const nomsDeBoutique = new Map(storesSnap.docs.map((d) => [d.id, d.data()?.name ?? d.id]))

  const encore = historySnap.docs.length > PAGE
  const documentsPage = encore ? historySnap.docs.slice(0, PAGE) : historySnap.docs

  const { enCours, lignes, attente } = construireHistoriqueClient({
    history: documentsPage.map((d) => ({ id: d.id, chemin: d.ref.path, donnees: d.data() ?? {} })),
    drafts: draftsSnap.docs.map((d) => ({ id: d.id, chemin: d.ref.path, donnees: d.data() ?? {} })),
    nomsDeBoutique,
  })

  // ⚠ LE CURSEUR SORT DU DERNIER DOCUMENT LU, PAS DE LA DERNIÈRE LIGNE RENDUE.
  //   Un ravitaillement écarté par `construireHistoriqueClient` ne figure pas
  //   dans `lignes` mais occupe bien une place dans le tri : partir de la
  //   dernière ligne rendue le relirait à chaque page, et la pagination
  //   tournerait en rond sans jamais atteindre la fin.
  const dernier = documentsPage[documentsPage.length - 1]
  const curseurSuivant = encore && dernier
    ? { createdAt: Number(dernier.get('createdAt')?.toMillis?.() ?? 0), chemin: dernier.ref.path }
    : null

  let totaux = null
  if (premierePage) {
    const boutiques = storesSnap.docs.map((d) => ({ storeId: d.id, storeName: d.data()?.name ?? d.id }))
    const [globaux, parBoutique] = await Promise.all([
      calculerTotaux(db, clientId),
      compterParBoutique(db, clientId, boutiques),
    ])
    totaux = { ...globaux, ...attente, parBoutique }
  }

  return { success: true, enCours, lignes, totaux, curseurSuivant, encore }
}
```

- [ ] **Step 5 : vérifier que le curseur part du bon document**

Ajouter ce test à `tests/functions/tc-256-list-client-history.test.js`, dans le
bloc « la pagination » :

```js
  /**
   * ⚠ LE CURSEUR SORT DU DERNIER DOCUMENT LU, PAS DE LA DERNIÈRE LIGNE RENDUE.
   *   Un ravitaillement est écarté de l'affichage mais occupe une place dans le
   *   tri : si la page se termine sur lui, repartir de la dernière ligne VISIBLE
   *   le relirait à chaque page, et la pagination tournerait en rond sans
   *   jamais atteindre la fin.
   */
  it('[TC-256-22] une page qui finit sur une ligne écartée avance quand même', async () => {
    // Les PAGE-1 premières lignes du tri, les plus récentes.
    for (let i = 0; i < PAGE - 1; i += 1) {
      const id = `h${String(i).padStart(3, '0')}`
      await poser('clients/store-a/history', id, ligne({
        createdAt: Timestamp.fromMillis(Date.UTC(2026, 9, 13) + (1000 - i) * 1000),
      }))
    }
    // La PAGE-ième : un ravitaillement. Il est LU, il n'est jamais RENDU.
    await poser('clients/store-a/history', 'ravito', ligne({
      type: 'Ravitaillement', createdAt: Timestamp.fromMillis(Date.UTC(2026, 9, 13) + 500 * 1000),
    }))
    await poser('clients/store-a/history', 'apres', ligne({
      createdAt: Timestamp.fromMillis(Date.UTC(2026, 9, 13) + 1 * 1000),
    }))

    const page1 = await appel('u-caissiere')
    expect(page1.encore).toBe(true)
    const page2 = await appel('u-caissiere', { clientId: 'c1', curseur: page1.curseurSuivant })

    const tous = [...page1.lignes, ...page2.lignes].map((l) => l.id)
    expect(new Set(tous).size).toBe(tous.length)
    expect(tous).toContain('apres')
  })
```

- [ ] **Step 6 : lancer les tests pour les voir passer**

```bash
npx firebase emulators:exec --only firestore --project demo-akayis-test "npx vitest run --config vitest.functions.config.js tests/functions/tc-256-list-client-history.test.js"
```
Attendu : PASS, 22 tests.

- [ ] **Step 7 : lint**

```bash
npx eslint functions/src/clients/listClientHistory.js tests/functions/tc-256-list-client-history.test.js
```
Attendu : aucune sortie.

- [ ] **Step 8 : commit**

```bash
git add functions/src/clients/listClientHistory.js functions/src/errors.js tests/functions/tc-256-list-client-history.test.js
git commit -m "feat: lire l historique d un agent au-dela de sa boutique

Les regles interdisent a une boutique de lire l historique d une autre : c est
l Admin SDK qui lit, et c est ici qu on decide ce qui sort. Le dealer est
refuse, lui a qui les regles ne donnent qu un agregat sans identite.

Les totaux viennent d un count() sans orderBy, parce que Firestore exclut d une
requete triee les documents sans le champ trie : une vieille ligne sans
createdAt ne peut pas etre listee, et c est l ecart qui le dit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3 : les index et le câblage du callable

**Files:**
- Modify: `firestore.indexes.json`
- Modify: `functions/src/index.js`
- Test: `tests/unit/tc-257-index-historique-client.test.js`
- Modify: `tests/functions/tc-036-callable-wiring.test.js`

**Interfaces:**
- Consumes: `listClientHistoryHandler` (Task 2).
- Produces: le callable exporté `listClientHistory`.

> ⚠ **REVIEW FOCUS 1 — L'ÉMULATEUR FIRESTORE NE VÉRIFIE AUCUN INDEX.** Les tests
> de la Task 2 passent sans qu'aucun index n'existe. En production, la requête
> échouerait à la première ouverture du panneau, avec une erreur qui ne parle que
> d'index et jamais de cette fonctionnalité. Ce test lit le FICHIER.

- [ ] **Step 1 : écrire le test qui échoue**

Créer `tests/unit/tc-257-index-historique-client.test.js` :

```js
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * TC-257 — Les index que `listClientHistory` exige.
 *
 * ⚠ CE TEST LIT UN FICHIER, ET C'EST TOUT L'INTÉRÊT. L'émulateur Firestore crée
 *   les index à la volée : TOUS les tests de TC-256 passent sans qu'aucun index
 *   ne soit déclaré. La production, elle, refuse la requête. C'est le seul
 *   endroit où cet oubli peut être attrapé avant le déploiement.
 */

const index = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'))

const trouve = (collectionGroup, champs) => index.indexes.some((i) =>
  i.collectionGroup === collectionGroup
  && i.queryScope === 'COLLECTION_GROUP'
  && JSON.stringify(i.fields) === JSON.stringify(champs))

describe('TC-257 — les index de l’historique client', () => {
  it('[TC-257-01] history : clientId + createdAt, en portée GROUPE', () => {
    expect(trouve('history', [
      { fieldPath: 'clientId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ])).toBe(true)
  })

  /** Les sommes par type passent par `where('type','in',…)`. */
  it('[TC-257-02] history : clientId + type, en portée GROUPE', () => {
    expect(trouve('history', [
      { fieldPath: 'clientId', order: 'ASCENDING' },
      { fieldPath: 'type', order: 'ASCENDING' },
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
```

- [ ] **Step 2 : lancer le test pour le voir échouer**

```bash
npx vitest run tests/unit/tc-257-index-historique-client.test.js
```
Attendu : ÉCHEC — les trois assertions sont fausses.

- [ ] **Step 3 : ajouter les index**

Dans `firestore.indexes.json`, ajouter à la fin du tableau `indexes` :

```json
    {
      "collectionGroup": "history",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "clientId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "history",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "clientId", "order": "ASCENDING" },
        { "fieldPath": "type", "order": "ASCENDING" }
      ]
    }
```

et à la fin du tableau `fieldOverrides` :

```json
    {
      "collectionGroup": "drafts",
      "fieldPath": "clientId",
      "indexes": [
        { "order": "ASCENDING",  "queryScope": "COLLECTION" },
        { "order": "ASCENDING",  "queryScope": "COLLECTION_GROUP" }
      ]
    }
```

- [ ] **Step 4 : câbler le callable**

Dans `functions/src/index.js`, ajouter l'import à la suite de celui de `listOutstandingDraftsHandler` :

```js
import { listClientHistoryHandler } from './clients/listClientHistory.js'
```

et l'export à la suite de `listOutstandingDrafts` :

```js
// L'historique nominatif d'un agent, toutes boutiques confondues. Le dealer en
// est refusé : les règles ne lui donnent ailleurs qu'un agrégat sans identité.
export const listClientHistory = onCall(
  CALLABLE,
  wrapCallable(listClientHistoryHandler, deps)
)
```

- [ ] **Step 5 : ajouter le callable à l'inventaire du test de câblage**

Dans `tests/functions/tc-036-callable-wiring.test.js`, repérer la liste des noms
de callables attendus et y ajouter `'listClientHistory'`. Lancer :

```bash
npx firebase emulators:exec --only firestore --project demo-akayis-test "npx vitest run --config vitest.functions.config.js tests/functions/tc-036-callable-wiring.test.js"
```
Attendu : PASS. Si le test compte les callables (`23`), incrémenter le nombre.

- [ ] **Step 6 : lancer les deux tests**

```bash
npx vitest run tests/unit/tc-257-index-historique-client.test.js
npm run test:functions
```
Attendu : PASS des deux côtés.

- [ ] **Step 7 : commit**

```bash
git add firestore.indexes.json functions/src/index.js tests/unit/tc-257-index-historique-client.test.js tests/functions/tc-036-callable-wiring.test.js
git commit -m "feat: declarer les index que l historique exige, et cabler le callable

L emulateur cree les index a la volee : tous les tests du handler passent sans
qu aucun index existe, et la production refuse la requete. Ce test lit le
fichier, parce que c est le seul endroit ou l oubli se voit avant le deploiement.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4 : le service et le hook qui cumulent les pages

**Files:**
- Create: `src/services/clientHistoryService.js`
- Create: `src/hooks/useHistoriqueClient.js`
- Test: `tests/unit/tc-258-hook-historique-client.test.jsx`

**Interfaces:**
- Consumes: le callable `listClientHistory` (Task 3).
- Produces :
  - `chargerHistoriqueClient(clientId, curseur) → Promise<{ enCours, lignes, totaux, curseurSuivant, encore }>`
  - `useHistoriqueClient(clientId) → { enCours, lignes, totaux, etat, erreur, encore, chargerPlus, reessayer }`
  - `etat ∈ { 'inactif', 'chargement', 'pret', 'chargementPage', 'erreur' }`

- [ ] **Step 1 : écrire le test qui échoue**

Créer `tests/unit/tc-258-hook-historique-client.test.jsx` :

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const chargerHistoriqueClient = vi.fn()
vi.mock('../../src/services/clientHistoryService.js', () => ({ chargerHistoriqueClient }))

const { useHistoriqueClient } = await import('../../src/hooks/useHistoriqueClient.js')

/**
 * TC-258 — Le cumul des pages de l'historique d'un agent.
 *
 * ⚠ DEUX RÈGLES QUI NE SE VOIENT QU'À L'USAGE :
 *   1. DÉDOUBLONNER À CHAQUE PAGE. Une ligne écrite pendant la lecture décale la
 *      pagination et peut faire revenir un document déjà affiché.
 *   2. REPARTIR DE ZÉRO QUAND LE CLIENT CHANGE. Sans ça, ouvrir le panneau d'un
 *      second agent lui empile les pages du premier.
 */

const page = (ids, over = {}) => ({
  enCours: [],
  lignes: ids.map((id) => ({ id, montant: 1 })),
  totaux: { operations: ids.length, depots: 0, retraits: 0, nonClassees: 0, nonDatees: 0, parBoutique: [] },
  curseurSuivant: null,
  encore: false,
  ...over,
})

beforeEach(() => { chargerHistoriqueClient.mockReset() })

describe('TC-258 — le chargement initial', () => {
  it('[TC-258-01] ne charge rien tant qu’aucun client n’est désigné', () => {
    const { result } = renderHook(() => useHistoriqueClient(null))
    expect(result.current.etat).toBe('inactif')
    expect(chargerHistoriqueClient).not.toHaveBeenCalled()
  })

  it('[TC-258-02] charge la première page et passe à « pret »', async () => {
    chargerHistoriqueClient.mockResolvedValue(page(['a', 'b']))
    const { result } = renderHook(() => useHistoriqueClient('c1'))

    await waitFor(() => expect(result.current.etat).toBe('pret'))
    expect(result.current.lignes.map((l) => l.id)).toEqual(['a', 'b'])
    expect(chargerHistoriqueClient).toHaveBeenCalledWith('c1', null)
  })

  it('[TC-258-03] une erreur est portée, pas avalée', async () => {
    chargerHistoriqueClient.mockRejectedValue(new Error('Accès refusé'))
    const { result } = renderHook(() => useHistoriqueClient('c1'))

    await waitFor(() => expect(result.current.etat).toBe('erreur'))
    expect(result.current.erreur).toMatch(/Accès refusé/)
  })

  it('[TC-258-04] `reessayer` relance le chargement', async () => {
    chargerHistoriqueClient.mockRejectedValueOnce(new Error('réseau'))
    chargerHistoriqueClient.mockResolvedValueOnce(page(['a']))
    const { result } = renderHook(() => useHistoriqueClient('c1'))

    await waitFor(() => expect(result.current.etat).toBe('erreur'))
    await act(async () => { await result.current.reessayer() })
    await waitFor(() => expect(result.current.etat).toBe('pret'))
    expect(result.current.lignes).toHaveLength(1)
  })
})

describe('TC-258 — les pages suivantes', () => {
  it('[TC-258-05] `chargerPlus` empile sans écraser', async () => {
    chargerHistoriqueClient.mockResolvedValueOnce(page(['a', 'b'], { encore: true, curseurSuivant: { createdAt: 1, chemin: 'x' } }))
    chargerHistoriqueClient.mockResolvedValueOnce(page(['c'], { totaux: null }))
    const { result } = renderHook(() => useHistoriqueClient('c1'))

    await waitFor(() => expect(result.current.etat).toBe('pret'))
    await act(async () => { await result.current.chargerPlus() })

    expect(result.current.lignes.map((l) => l.id)).toEqual(['a', 'b', 'c'])
    expect(chargerHistoriqueClient).toHaveBeenLastCalledWith('c1', { createdAt: 1, chemin: 'x' })
  })

  /** ⚠ Les totaux de la première page ne sont pas effacés par une page suivante. */
  it('[TC-258-06] les totaux survivent aux pages suivantes', async () => {
    chargerHistoriqueClient.mockResolvedValueOnce(page(['a'], { encore: true, curseurSuivant: { createdAt: 1, chemin: 'x' } }))
    chargerHistoriqueClient.mockResolvedValueOnce(page(['b'], { totaux: null }))
    const { result } = renderHook(() => useHistoriqueClient('c1'))

    await waitFor(() => expect(result.current.etat).toBe('pret'))
    const avant = result.current.totaux
    await act(async () => { await result.current.chargerPlus() })

    expect(result.current.totaux).toEqual(avant)
  })

  it('[TC-258-07] une ligne revenue deux fois n’apparaît qu’une fois', async () => {
    chargerHistoriqueClient.mockResolvedValueOnce(page(['a', 'b'], { encore: true, curseurSuivant: { createdAt: 1, chemin: 'x' } }))
    chargerHistoriqueClient.mockResolvedValueOnce(page(['b', 'c'], { totaux: null }))
    const { result } = renderHook(() => useHistoriqueClient('c1'))

    await waitFor(() => expect(result.current.etat).toBe('pret'))
    await act(async () => { await result.current.chargerPlus() })

    expect(result.current.lignes.map((l) => l.id)).toEqual(['a', 'b', 'c'])
  })

  it('[TC-258-08] `chargerPlus` ne fait rien quand tout est chargé', async () => {
    chargerHistoriqueClient.mockResolvedValue(page(['a']))
    const { result } = renderHook(() => useHistoriqueClient('c1'))

    await waitFor(() => expect(result.current.etat).toBe('pret'))
    await act(async () => { await result.current.chargerPlus() })

    expect(chargerHistoriqueClient).toHaveBeenCalledTimes(1)
  })
})

describe('TC-258 — changer de client', () => {
  it('[TC-258-09] repart de zéro, sans empiler les pages du précédent', async () => {
    chargerHistoriqueClient.mockResolvedValueOnce(page(['a', 'b']))
    chargerHistoriqueClient.mockResolvedValueOnce(page(['z']))
    const { result, rerender } = renderHook(({ id }) => useHistoriqueClient(id), { initialProps: { id: 'c1' } })

    await waitFor(() => expect(result.current.etat).toBe('pret'))
    rerender({ id: 'c2' })

    await waitFor(() => expect(result.current.lignes.map((l) => l.id)).toEqual(['z']))
  })
})
```

- [ ] **Step 2 : lancer le test pour le voir échouer**

```bash
npx vitest run tests/unit/tc-258-hook-historique-client.test.jsx
```
Attendu : ÉCHEC — modules introuvables.

- [ ] **Step 3 : écrire le service**

Créer `src/services/clientHistoryService.js` :

```js
/**
 * clientHistoryService.js — l'appel du callable `listClientHistory`.
 *
 * Le navigateur ne peut pas lire l'historique d'une autre boutique : les règles
 * l'interdisent. Il demande, le serveur décide. Même forme que
 * `listArgentDehors` dans `dealerService.js`.
 */

import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebase'
import { mapFirestoreError } from '../utils/errorHandler'

/**
 * @param {string} clientId
 * @param {{createdAt: number, chemin: string}|null} curseur
 * @returns {Promise<{enCours: object[], lignes: object[], totaux: object|null, curseurSuivant: object|null, encore: boolean}>}
 */
export async function chargerHistoriqueClient(clientId, curseur = null) {
  try {
    const reponse = await httpsCallable(functions, 'listClientHistory')({
      clientId,
      ...(curseur ? { curseur } : {}),
    })
    const { success: _success, ...donnees } = reponse.data ?? {}
    return donnees
  } catch (err) {
    throw mapFirestoreError(err)
  }
}
```

> Vérifier que `functions` et `mapFirestoreError` sont bien exportés aux chemins
> indiqués : `grep -n "export" src/config/firebase.js | grep functions` et
> `grep -n "mapFirestoreError" src/utils/errorHandler.js`. Si les noms diffèrent,
> aligner sur ceux de `src/services/dealerService.js`, qui fait le même appel.

- [ ] **Step 4 : écrire le hook**

Créer `src/hooks/useHistoriqueClient.js` :

```js
import { useCallback, useEffect, useRef, useState } from 'react'
import { chargerHistoriqueClient } from '../services/clientHistoryService.js'

/**
 * Le cumul des pages de l'historique d'un agent.
 *
 * ⚠ ON DÉDOUBLONNE À CHAQUE PAGE. Une opération écrite pendant la lecture décale
 *   la pagination et peut faire revenir un document déjà affiché. Deux lignes
 *   identiques dans une liste d'argent se lisent comme deux opérations.
 *
 * ⚠ UN CHANGEMENT DE CLIENT REMET TOUT À ZÉRO. Sans ça, ouvrir le panneau d'un
 *   second agent lui empilerait les pages du premier — et le panneau afficherait
 *   sous son nom des opérations qui ne sont pas les siennes.
 */
export function useHistoriqueClient(clientId) {
  const [etat, setEtat] = useState('inactif')
  const [erreur, setErreur] = useState(null)
  const [enCours, setEnCours] = useState([])
  const [lignes, setLignes] = useState([])
  const [totaux, setTotaux] = useState(null)
  const [encore, setEncore] = useState(false)
  const curseurRef = useRef(null)
  // Le client EN COURS de chargement : une réponse arrivée après un changement
  // de client ne doit pas s'afficher sous le nom du nouveau.
  const clientRef = useRef(null)

  const charger = useCallback(async (id, curseur) => {
    clientRef.current = id
    setEtat(curseur ? 'chargementPage' : 'chargement')
    setErreur(null)
    try {
      const reponse = await chargerHistoriqueClient(id, curseur)
      if (clientRef.current !== id) return

      setLignes((precedentes) => {
        const base = curseur ? precedentes : []
        const vues = new Set(base.map((l) => l.id))
        return [...base, ...(reponse.lignes ?? []).filter((l) => !vues.has(l.id))]
      })
      if (!curseur) {
        setEnCours(reponse.enCours ?? [])
        setTotaux(reponse.totaux ?? null)
      }
      curseurRef.current = reponse.curseurSuivant ?? null
      setEncore(Boolean(reponse.encore))
      setEtat('pret')
    } catch (err) {
      if (clientRef.current !== id) return
      setErreur(err?.message || 'Impossible de charger l’historique.')
      setEtat('erreur')
    }
  }, [])

  useEffect(() => {
    if (!clientId) {
      clientRef.current = null
      curseurRef.current = null
      setEtat('inactif')
      setLignes([])
      setEnCours([])
      setTotaux(null)
      setEncore(false)
      return
    }
    curseurRef.current = null
    setLignes([])
    setEnCours([])
    setTotaux(null)
    void charger(clientId, null)
  }, [clientId, charger])

  const chargerPlus = useCallback(async () => {
    if (!clientId || !encore || !curseurRef.current) return
    await charger(clientId, curseurRef.current)
  }, [charger, clientId, encore])

  const reessayer = useCallback(async () => {
    if (!clientId) return
    await charger(clientId, curseurRef.current)
  }, [charger, clientId])

  return { enCours, lignes, totaux, etat, erreur, encore, chargerPlus, reessayer }
}
```

- [ ] **Step 5 : lancer les tests pour les voir passer**

```bash
npx vitest run tests/unit/tc-258-hook-historique-client.test.jsx
```
Attendu : PASS, 9 tests.

- [ ] **Step 6 : lint et commit**

```bash
npx eslint src/services/clientHistoryService.js src/hooks/useHistoriqueClient.js tests/unit/tc-258-hook-historique-client.test.jsx
git add src/services/clientHistoryService.js src/hooks/useHistoriqueClient.js tests/unit/tc-258-hook-historique-client.test.jsx
git commit -m "feat: cumuler les pages de l historique sans les melanger

Une ligne ecrite pendant la lecture decale la pagination et peut revenir deux
fois : deux lignes identiques dans une liste d argent se lisent comme deux
operations. Et changer de client repart de zero, sinon le panneau afficherait
sous un nom les operations d un autre.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5 : la variante latérale du dialogue

**Files:**
- Modify: `src/components/ui/Dialog.jsx`
- Test: `tests/components/tc-259-dialog-lateral.test.jsx`

**Interfaces:**
- Consumes: rien.
- Produces: `<Dialog cote>` — le panneau s'ancre à droite, pleine hauteur.

> ⚠ **ON N'ÉCRIT PAS UN SECOND COMPOSANT.** `Dialog` porte déjà le piège à focus,
> la fermeture par `Échap`, le `aria-modal`, la restauration du focus et le
> verrouillage du défilement de fond. Un panneau latéral écrit à côté
> réimplémenterait tout ça — et en oublierait une partie. Seul le positionnement
> change.

- [ ] **Step 1 : écrire le test qui échoue**

Créer `tests/components/tc-259-dialog-lateral.test.jsx` :

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import Dialog from '../../src/components/ui/Dialog.jsx'

/**
 * TC-259 — Le dialogue, ancré sur le côté.
 *
 * ⚠ LA VARIANTE NE CHANGE QUE LE POSITIONNEMENT. Tout ce qui rend un dialogue
 *   utilisable — piège à focus, Échap, aria-modal, retour du focus — reste celui
 *   de `Dialog`. Ces tests vérifient précisément que la variante ne l'a pas perdu.
 */

afterEach(cleanup)

const ouvrir = (props = {}) => render(
  <Dialog open onClose={vi.fn()} title="Historique" {...props}>
    <button type="button">Dedans</button>
  </Dialog>,
)

describe('TC-259 — la variante latérale', () => {
  it('[TC-259-01] sans `cote`, le dialogue reste centré comme avant', () => {
    ouvrir()
    expect(screen.getByRole('dialog').className).not.toMatch(/inset-y-0/)
  })

  it('[TC-259-02] avec `cote`, le panneau occupe toute la hauteur à droite', () => {
    ouvrir({ cote: true })
    const panneau = screen.getByRole('dialog')
    expect(panneau.className).toMatch(/inset-y-0/)
    expect(panneau.className).toMatch(/right-0/)
  })

  it('[TC-259-03] la variante garde le rôle et le titre accessible', () => {
    ouvrir({ cote: true })
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Historique')
  })

  it('[TC-259-04] la variante se ferme toujours par Échap', () => {
    const onClose = vi.fn()
    ouvrir({ cote: true, onClose })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2 : lancer le test pour le voir échouer**

```bash
npx vitest run tests/components/tc-259-dialog-lateral.test.jsx
```
Attendu : ÉCHEC sur `[TC-259-02]` — la classe `inset-y-0` est absente.

> Si `[TC-259-01]`, `[TC-259-03]` ou `[TC-259-04]` échouent aussi, c'est que les
> sélecteurs ne correspondent pas au composant réel. Lire `Dialog.jsx` et ajuster
> les requêtes AVANT de toucher au composant — ces trois-là décrivent le
> comportement existant.

- [ ] **Step 3 : ajouter la variante**

Dans `src/components/ui/Dialog.jsx` :

1. Ajouter `cote = false` à la signature, après `spacious = false`.
2. Documenter au-dessus de la signature :

```jsx
/**
 * `cote` ancre le panneau à droite, sur toute la hauteur, au lieu de le centrer.
 *
 * ⚠ C'EST UNE VARIANTE, PAS UN SECOND COMPOSANT. Le piège à focus, la fermeture
 *   par Échap, `aria-modal` et la restauration du focus sont ici et doivent le
 *   rester : un panneau latéral écrit à côté les réimplémenterait, et en
 *   oublierait une partie.
 */
```

3. Sur l'élément qui porte `role="dialog"`, remplacer la classe de positionnement
   par une expression qui bascule :

```jsx
className={cote
  ? `fixed inset-y-0 right-0 z-50 flex w-full ${largeur} flex-col overflow-hidden bg-surface shadow-xl`
  : /* …la chaîne de classes existante, inchangée… */}
```

- [ ] **Step 4 : lancer les tests pour les voir passer**

```bash
npx vitest run tests/components/tc-259-dialog-lateral.test.jsx
npx vitest run tests/components
```
Attendu : PASS partout. Les tests de composants existants qui utilisent `Dialog`
doivent rester verts — c'est la preuve que la variante n'a rien changé au défaut.

- [ ] **Step 5 : lint et commit**

```bash
npx eslint src/components/ui/Dialog.jsx tests/components/tc-259-dialog-lateral.test.jsx
git add src/components/ui/Dialog.jsx tests/components/tc-259-dialog-lateral.test.jsx
git commit -m "feat: ancrer un dialogue sur le cote sans en reecrire un second

Le piege a focus, Echap, aria-modal et le retour du focus vivent dans Dialog.
Un panneau lateral ecrit a cote les reimplementerait, et en oublierait une
partie. Seul le positionnement change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6 : la ligne d'historique

**Files:**
- Create: `src/components/clients/LigneHistorique.jsx`
- Test: `tests/components/tc-260-ligne-historique.test.jsx`

**Interfaces:**
- Consumes: une ligne telle que produite par `ligneDeDocument` (Task 1).
- Produces: `<LigneHistorique ligne={…} maintenant={…} />`, mémoïsée.

- [ ] **Step 1 : écrire le test qui échoue**

Créer `tests/components/tc-260-ligne-historique.test.jsx` :

```jsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import LigneHistorique from '../../src/components/clients/LigneHistorique.jsx'

/**
 * TC-260 — Une ligne de l'historique d'un agent.
 *
 * ⚠ CE QUI DOIT SE LIRE SANS CLIQUER : quand, combien, quel sens, quel statut,
 *   QUELLE BOUTIQUE. La boutique est la raison d'être de cet écran : sans elle,
 *   on ne sait pas si l'opération est la nôtre.
 */

const MAINTENANT = Date.UTC(2026, 9, 13, 14, 0)

const ligne = (over = {}) => ({
  id: 'h1', source: 'history', storeId: 'store-a', storeName: 'C2EGF OUAGA',
  type: 'Dépôt', typePlie: 'depot', montant: 250000, reste: null,
  statut: 'Validée', reseau: 'Orange', code: '0123456',
  date: '13/10/2026 08:00', createdAt: Date.UTC(2026, 9, 13, 8, 0),
  validatedAt: 0, deletedAt: null, operatorName: 'Awa',
  ...over,
})

afterEach(cleanup)

const afficher = (over) => render(<LigneHistorique ligne={ligne(over)} maintenant={MAINTENANT} />)

describe('TC-260 — ce qu’une ligne montre', () => {
  it('[TC-260-01] la date, le montant, le type et le statut', () => {
    afficher()
    expect(screen.getByText(/13\/10\/2026 08:00/)).toBeInTheDocument()
    expect(screen.getByText(/250\s?000/)).toBeInTheDocument()
    expect(screen.getByText('Dépôt')).toBeInTheDocument()
    expect(screen.getByText('Validée')).toBeInTheDocument()
  })

  it('[TC-260-02] la boutique et l’opérateur', () => {
    afficher()
    expect(screen.getByText(/C2EGF OUAGA/)).toBeInTheDocument()
    expect(screen.getByText(/Awa/)).toBeInTheDocument()
  })

  it('[TC-260-03] un opérateur absent ne laisse pas « undefined »', () => {
    afficher({ operatorName: '' })
    expect(screen.queryByText(/undefined/)).toBeNull()
  })
})

describe('TC-260 — une non terminée', () => {
  it('[TC-260-04] affiche ce qui reste et depuis combien de temps', () => {
    afficher({
      source: 'draft', statut: 'Non Terminées', type: 'Retrait', typePlie: 'retrait',
      montant: 100000, reste: 40000, createdAt: Date.UTC(2026, 9, 13, 8, 0),
    })
    expect(screen.getByText(/reste 40\s?000/)).toBeInTheDocument()
    expect(screen.getByText(/6 h/)).toBeInTheDocument()
  })

  it('[TC-260-05] une attente de plusieurs jours se dit en jours', () => {
    afficher({ source: 'draft', reste: 1000, createdAt: Date.UTC(2026, 9, 9, 14, 0) })
    expect(screen.getByText(/4 j/)).toBeInTheDocument()
  })

  it('[TC-260-06] une ligne sans horodatage n’annonce aucune durée', () => {
    afficher({ source: 'draft', reste: 1000, createdAt: 0 })
    expect(screen.queryByText(/en attente depuis/)).toBeNull()
  })
})

describe('TC-260 — une ligne supprimée', () => {
  /** ⚠ Elle RESTE visible : un historique qui tait les annulations ment. */
  it('[TC-260-07] est marquée et barrée, pas masquée', () => {
    const { container } = afficher({ deletedAt: Date.UTC(2026, 9, 13, 10, 0), statut: 'Supprimée' })
    expect(screen.getByText('Supprimée')).toBeInTheDocument()
    expect(container.querySelector('.line-through')).not.toBeNull()
  })
})
```

- [ ] **Step 2 : lancer le test pour le voir échouer**

```bash
npx vitest run tests/components/tc-260-ligne-historique.test.jsx
```
Attendu : ÉCHEC — module introuvable.

- [ ] **Step 3 : écrire le composant**

Créer `src/components/clients/LigneHistorique.jsx` :

```jsx
import { memo } from 'react'

/**
 * Une opération d'agent, telle qu'elle se lit dans son historique.
 *
 * ⚠ MÉMOÏSÉE PARCE QUE LA LISTE EST VIRTUALISÉE. Le conteneur rerend à chaque
 *   défilement ; sans `memo`, chaque ligne visible se reconstruirait à chaque
 *   pixel parcouru.
 *
 * ⚠ `maintenant` EST UNE PROP, PAS UN `Date.now()` INTERNE. Un minuteur par
 *   ligne ferait tourner soixante horloges pour un seul chiffre — le panneau
 *   n'en tient qu'un, comme `TransactionTable` le fait déjà.
 */

const MINUTE = 60000
const HEURE = 60 * MINUTE
const JOUR = 24 * HEURE

/** « 6 h », « 4 j », « 12 min ». Vide si l'instant est inconnu. */
export function depuisQuand(instant, maintenant) {
  if (!instant || !maintenant || maintenant <= instant) return ''
  const ecart = maintenant - instant
  if (ecart >= JOUR) return `${Math.floor(ecart / JOUR)} j`
  if (ecart >= HEURE) return `${Math.floor(ecart / HEURE)} h`
  return `${Math.max(1, Math.floor(ecart / MINUTE))} min`
}

const francs = (montant) => (
  typeof montant === 'number' && Number.isFinite(montant) ? montant.toLocaleString('fr-FR') : '—'
)

const LigneHistorique = memo(function LigneHistorique({ ligne, maintenant }) {
  const supprimee = Boolean(ligne.deletedAt)
  const entrant = ligne.typePlie === 'depot'
  const attente = ligne.source === 'draft' ? depuisQuand(ligne.createdAt, maintenant) : ''

  return (
    <div className={`border-b border-line px-4 py-3 ${supprimee ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm tabular-nums text-ink-muted">{ligne.date || '—'}</span>
        <span className={`text-sm font-medium ${entrant ? 'text-inflow' : 'text-outflow'}`}>
          {ligne.type || '—'}
        </span>
        <span className={`text-base font-semibold tabular-nums ${supprimee ? 'line-through' : ''}`}>
          {francs(ligne.montant)}
        </span>
        <span className="text-sm text-ink-muted">{ligne.statut || '—'}</span>
        <span className="ml-auto inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
          {ligne.storeName}
        </span>
        {ligne.operatorName && <span className="text-xs text-ink-muted">{ligne.operatorName}</span>}
      </div>

      {ligne.source === 'draft' && typeof ligne.reste === 'number' && (
        <p className="mt-1 text-sm text-warn">
          reste {francs(ligne.reste)}
          {attente && <> — en attente depuis {attente}</>}
        </p>
      )}
    </div>
  )
})

export default LigneHistorique
```

- [ ] **Step 4 : lancer les tests pour les voir passer**

```bash
npx vitest run tests/components/tc-260-ligne-historique.test.jsx
```
Attendu : PASS, 7 tests.

- [ ] **Step 5 : lint et commit**

```bash
npx eslint src/components/clients/LigneHistorique.jsx tests/components/tc-260-ligne-historique.test.jsx
git add src/components/clients/LigneHistorique.jsx tests/components/tc-260-ligne-historique.test.jsx
git commit -m "feat: une operation d agent, lisible sans cliquer

La boutique est la raison d etre de cet ecran : sans elle, on ne sait pas si
l operation est la notre. Le minuteur est une prop et non un Date.now interne,
sinon chaque ligne ferait tourner sa propre horloge.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7 : le panneau

**Files:**
- Create: `src/components/clients/HistoriqueClientPanel.jsx`
- Test: `tests/components/tc-261-panneau-historique.test.jsx`

**Interfaces:**
- Consumes: `useHistoriqueClient` (Task 4), `<Dialog cote>` (Task 5), `LigneHistorique` (Task 6), `useWindowedRows` (`src/hooks/useWindowedRows.js`), `LoadMoreButton`, `SkeletonList`, `ErrorState`, `EmptyState`.
- Produces: `<HistoriqueClientPanel client={client} onClose={fn} />` — rend `null` si `client` est nul.

- [ ] **Step 1 : écrire le test qui échoue**

Créer `tests/components/tc-261-panneau-historique.test.jsx` :

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const useHistoriqueClient = vi.fn()
vi.mock('../../src/hooks/useHistoriqueClient.js', () => ({ useHistoriqueClient }))

const { default: HistoriqueClientPanel } = await import('../../src/components/clients/HistoriqueClientPanel.jsx')

/**
 * TC-261 — Le panneau d'historique d'un agent.
 *
 * ⚠ CINQ ÉTATS, ET AUCUN NE DOIT RESSEMBLER À UN AUTRE. « Vide » n'est pas une
 *   erreur, « page suivante en cours » n'est pas « chargement », et une liste
 *   qui s'arrête sans le dire laisse croire qu'il en manque.
 */

const CLIENT = {
  id: 'c1', nom: 'OUEDRAOGO', prenom: 'SALIF',
  codeAgent: '0123456', numeroAgent: '01234567', localite: 'POUYTENGA',
}

const ligne = (id, over = {}) => ({
  id, source: 'history', storeId: 'store-a', storeName: 'C2EGF OUAGA',
  type: 'Dépôt', typePlie: 'depot', montant: 250000, reste: null,
  statut: 'Validée', date: '13/10/2026 08:00', createdAt: 1, validatedAt: 0,
  deletedAt: null, operatorName: 'Awa', ...over,
})

const etatPar = (over = {}) => ({
  enCours: [], lignes: [], totaux: null, etat: 'pret', erreur: null,
  encore: false, chargerPlus: vi.fn(), reessayer: vi.fn(), ...over,
})

const TOTAUX = {
  operations: 437, depots: 12300000, retraits: 8100000,
  nonClassees: 0, nonDatees: 0, resteAEncaisser: 80000, resteAPayer: 40000, nbEnAttente: 2,
  parBoutique: [
    { storeId: 'store-a', storeName: 'OUAGA', operations: 312 },
    { storeId: 'store-b', storeName: 'BOBO', operations: 125 },
  ],
}

const afficher = (etat) => {
  useHistoriqueClient.mockReturnValue(etatPar(etat))
  return render(<HistoriqueClientPanel client={CLIENT} onClose={vi.fn()} />)
}

beforeEach(() => { useHistoriqueClient.mockReset() })
afterEach(cleanup)

describe('TC-261 — l’identité, toujours visible', () => {
  it('[TC-261-01] le nom et les identifiants sont là dès le chargement', () => {
    afficher({ etat: 'chargement' })
    expect(screen.getByText(/OUEDRAOGO SALIF/)).toBeInTheDocument()
    expect(screen.getByText(/0123456/)).toBeInTheDocument()
    expect(screen.getByText(/POUYTENGA/)).toBeInTheDocument()
  })

  it('[TC-261-02] sans client, le panneau ne rend rien', () => {
    useHistoriqueClient.mockReturnValue(etatPar())
    const { container } = render(<HistoriqueClientPanel client={null} onClose={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('TC-261 — les cinq états', () => {
  it('[TC-261-03] chargement : un squelette, pas un vide', () => {
    afficher({ etat: 'chargement' })
    expect(screen.queryByText(/Aucune opération/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('[TC-261-04] vide : un message qui n’est pas une erreur', () => {
    afficher({ etat: 'pret', lignes: [], totaux: { ...TOTAUX, operations: 0 } })
    expect(screen.getByText(/Aucune opération/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('[TC-261-05] erreur : un message et un bouton Réessayer', () => {
    const reessayer = vi.fn()
    afficher({ etat: 'erreur', erreur: 'Accès refusé', reessayer })
    expect(screen.getByRole('alert')).toHaveTextContent('Accès refusé')
    fireEvent.click(screen.getByRole('button', { name: /Réessayer/ }))
    expect(reessayer).toHaveBeenCalled()
  })

  it('[TC-261-06] page suivante : le bouton change, la liste reste', () => {
    afficher({ etat: 'chargementPage', lignes: [ligne('a')], totaux: TOTAUX, encore: true })
    expect(screen.getByText(/13\/10\/2026 08:00/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Chargement/ })).toBeDisabled()
  })

  /** ⚠ Une liste qui s'arrête sans le dire laisse croire qu'il en manque. */
  it('[TC-261-07] tout chargé : le bouton disparaît et le compte le confirme', () => {
    afficher({ etat: 'pret', lignes: [ligne('a')], totaux: { ...TOTAUX, operations: 1 }, encore: false })
    expect(screen.queryByRole('button', { name: /Charger plus/ })).toBeNull()
    expect(screen.getByText(/c'est tout/i)).toBeInTheDocument()
  })
})

describe('TC-261 — ce que les totaux disent', () => {
  it('[TC-261-08] le compte total, pas celui de la page', () => {
    afficher({ etat: 'pret', lignes: [ligne('a')], totaux: TOTAUX, encore: true })
    expect(screen.getByText(/437 opérations/)).toBeInTheDocument()
  })

  /** ⚠ DEUX RESTES, PAS UN : ils vont dans des sens opposés. */
  it('[TC-261-09] sépare ce qu’on encaisse de ce qu’on paye', () => {
    afficher({ etat: 'pret', lignes: [], totaux: TOTAUX, enCours: [ligne('d1', { source: 'draft', reste: 40000 })] })
    expect(screen.getByText(/80\s?000 à encaisser/)).toBeInTheDocument()
    expect(screen.getByText(/40\s?000 à payer/)).toBeInTheDocument()
  })

  it('[TC-261-10] le récapitulatif par boutique tient sur une ligne', () => {
    afficher({ etat: 'pret', lignes: [ligne('a')], totaux: TOTAUX })
    expect(screen.getByText(/OUAGA 312/)).toBeInTheDocument()
    expect(screen.getByText(/BOBO 125/)).toBeInTheDocument()
  })

  /**
   * ⚠ REVIEW FOCUS 3 et 5 — CE QUI NE PEUT PAS ÊTRE LISTÉ DOIT ÊTRE DIT. Une
   *   vieille ligne sans `createdAt` est exclue de la requête triée ; un type
   *   inattendu n'entre dans aucun total. Les taire ferait afficher des chiffres
   *   faux sans que rien ne le signale.
   */
  it('[TC-261-11] annonce les lignes non datées et les types non classés', () => {
    afficher({ etat: 'pret', lignes: [ligne('a')], totaux: { ...TOTAUX, nonDatees: 3, nonClassees: 2 } })
    expect(screen.getByText(/3 opération/)).toBeInTheDocument()
    expect(screen.getByText(/2 opération/)).toBeInTheDocument()
  })

  it('[TC-261-12] ne dit rien quand il n’y a rien à signaler', () => {
    afficher({ etat: 'pret', lignes: [ligne('a')], totaux: TOTAUX })
    expect(screen.queryByText(/non datée/i)).toBeNull()
  })
})

describe('TC-261 — les non terminées, épinglées', () => {
  it('[TC-261-13] apparaissent dans leur bloc, au-dessus de l’historique', () => {
    afficher({
      etat: 'pret',
      enCours: [ligne('d1', { source: 'draft', statut: 'Non Terminées', reste: 40000 })],
      lignes: [ligne('h1')],
      totaux: TOTAUX,
    })
    expect(screen.getByText(/EN COURS/i)).toBeInTheDocument()
    expect(screen.getByText(/reste 40\s?000/)).toBeInTheDocument()
  })

  it('[TC-261-14] le bloc disparaît quand il n’y a rien en cours', () => {
    afficher({ etat: 'pret', enCours: [], lignes: [ligne('h1')], totaux: TOTAUX })
    expect(screen.queryByText(/EN COURS/i)).toBeNull()
  })
})

describe('TC-261 — charger la suite', () => {
  it('[TC-261-15] le bouton appelle `chargerPlus`', () => {
    const chargerPlus = vi.fn()
    afficher({ etat: 'pret', lignes: [ligne('a')], totaux: TOTAUX, encore: true, chargerPlus })
    fireEvent.click(screen.getByRole('button', { name: /Charger plus/ }))
    expect(chargerPlus).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2 : lancer le test pour le voir échouer**

```bash
npx vitest run tests/components/tc-261-panneau-historique.test.jsx
```
Attendu : ÉCHEC — module introuvable.

- [ ] **Step 3 : écrire le panneau**

Créer `src/components/clients/HistoriqueClientPanel.jsx` :

```jsx
import { useEffect, useMemo, useState } from 'react'
import Dialog from '../ui/Dialog'
import ErrorState from '../ui/ErrorState'
import EmptyState from '../ui/EmptyState'
import SkeletonList from '../ui/SkeletonList'
import LoadMoreButton from '../ui/LoadMoreButton'
import LigneHistorique from './LigneHistorique'
import { useHistoriqueClient } from '../../hooks/useHistoriqueClient.js'
import { useWindowedRows } from '../../hooks/useWindowedRows.js'
import { champsAgent } from '../../utils/agentFields.js'

/**
 * Tout ce qu'un agent a fait, quelle que soit la boutique.
 *
 * ⚠ LES NON TERMINÉES SONT ÉPINGLÉES, PAS INTERCALÉES. Chargées en entier dès le
 *   premier appel, elles répondent à « où en est son remboursement ». Mêlées à
 *   la liste paginée, une non terminée de trois mois s'afficherait dès la
 *   première page puis se ferait dépasser à chaque « charger plus ».
 *
 * ⚠ UN SEUL MINUTEUR POUR TOUT LE PANNEAU. Chaque non terminée affiche depuis
 *   combien de temps elle attend ; un `setInterval` par ligne ferait tourner
 *   autant d'horloges pour un seul chiffre.
 */

const HAUTEUR_LIGNE = 64

const francs = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('fr-FR') : '—')

function HistoriqueClientPanel({ client, onClose }) {
  const clientId = client?.id ?? null
  const { enCours, lignes, totaux, etat, erreur, encore, chargerPlus, reessayer } = useHistoriqueClient(clientId)

  const [maintenant, setMaintenant] = useState(() => Date.now())
  const riendACompter = enCours.length === 0
  useEffect(() => {
    if (riendACompter) return undefined
    setMaintenant(Date.now())
    const minuteur = setInterval(() => setMaintenant(Date.now()), 30000)
    return () => clearInterval(minuteur)
  }, [riendACompter])

  const fenetre = useWindowedRows({ itemCount: lignes.length, defaultRowHeight: HAUTEUR_LIGNE })
  const visibles = useMemo(
    () => lignes.slice(fenetre.startIndex, fenetre.endIndex),
    [lignes, fenetre.startIndex, fenetre.endIndex],
  )

  if (!client) return null

  const agent = champsAgent(client)
  const identite = [
    agent.codeAgent && `Code ${agent.codeAgent}`,
    agent.numeroAgent && `N° ${agent.numeroAgent}`,
    client.localite,
  ].filter(Boolean).join(' · ')

  return (
    <Dialog
      open
      cote
      onClose={onClose}
      title={`${client.nom ?? ''} ${client.prenom ?? ''}`.trim() || 'Fiche sans nom'}
      description={identite}
      largeur="max-w-2xl"
      testId="historique-client-panel"
    >
      {totaux && (
        <div className="border-b border-line pb-3">
          <p className="text-sm text-ink">
            {francs(totaux.operations)} opérations · {francs(totaux.depots)} déposés · {francs(totaux.retraits)} retirés
          </p>
          {totaux.parBoutique?.length > 0 && (
            <p className="mt-1 text-sm text-ink-muted">
              {totaux.parBoutique.map((b) => `${b.storeName} ${francs(b.operations)}`).join(' · ')}
            </p>
          )}
          {(totaux.nonDatees > 0 || totaux.nonClassees > 0) && (
            <p className="mt-1 text-sm text-warn">
              {totaux.nonDatees > 0 && <>{francs(totaux.nonDatees)} opération(s) sans date ne peuvent pas être listées. </>}
              {totaux.nonClassees > 0 && <>{francs(totaux.nonClassees)} opération(s) d’un type inattendu ne sont dans aucun total.</>}
            </p>
          )}
        </div>
      )}

      {enCours.length > 0 && (
        <section className="mt-3 rounded-lg border border-warn/40 bg-warn-soft">
          <h3 className="px-4 pt-3 text-sm font-semibold uppercase tracking-wide text-warn">En cours</h3>
          {enCours.map((ligne) => (
            <LigneHistorique key={ligne.id} ligne={ligne} maintenant={maintenant} />
          ))}
          <p className="px-4 py-2 text-sm font-medium text-ink">
            {francs(totaux?.resteAEncaisser ?? 0)} à encaisser · {francs(totaux?.resteAPayer ?? 0)} à payer
          </p>
        </section>
      )}

      {etat === 'chargement' && <div className="mt-3"><SkeletonList /></div>}

      {etat === 'erreur' && (
        <div className="mt-3">
          <ErrorState message={erreur} onRetry={reessayer} />
        </div>
      )}

      {etat !== 'chargement' && etat !== 'erreur' && lignes.length === 0 && (
        <div className="mt-3">
          <EmptyState
            title="Aucune opération pour cet agent"
            message="Rien n’a encore été enregistré sous ce code, dans aucune boutique."
          />
        </div>
      )}

      {lignes.length > 0 && (
        <>
          <div
            ref={fenetre.containerRef}
            onScroll={fenetre.onScroll}
            className="mt-3 max-h-[60vh] overflow-y-auto"
          >
            <div style={{ height: fenetre.topPad }} />
            {visibles.map((ligne, index) => (
              <div key={ligne.id} ref={index === 0 ? fenetre.rowRef : undefined}>
                <LigneHistorique ligne={ligne} maintenant={maintenant} />
              </div>
            ))}
            <div style={{ height: fenetre.bottomPad }} />
          </div>

          {encore
            ? <LoadMoreButton loading={etat === 'chargementPage'} onClick={chargerPlus} />
            : (
              <p className="mt-3 text-center text-sm text-ink-muted">
                {francs(totaux?.operations ?? lignes.length)} opérations, c’est tout.
              </p>
            )}
        </>
      )}
    </Dialog>
  )
}

export default HistoriqueClientPanel
```

- [ ] **Step 4 : lancer les tests pour les voir passer**

```bash
npx vitest run tests/components/tc-261-panneau-historique.test.jsx
```
Attendu : PASS, 15 tests.

> Si `[TC-261-06]` échoue parce que `LoadMoreButton` ne porte pas « Chargement »,
> lire le composant et aligner la requête du test sur son libellé réel.

- [ ] **Step 5 : lint et commit**

```bash
npx eslint src/components/clients/HistoriqueClientPanel.jsx tests/components/tc-261-panneau-historique.test.jsx
git add src/components/clients/HistoriqueClientPanel.jsx tests/components/tc-261-panneau-historique.test.jsx
git commit -m "feat: le panneau qui montre tout ce qu un agent a fait

Les non terminees sont epinglees et non intercalees : melees a la liste
paginee, une non terminee de trois mois s afficherait des la premiere page puis
se ferait depasser a chaque chargement. Et ce qui ne peut pas etre liste - une
ligne sans date, un type inattendu - est annonce plutot que taise.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8 : la colonne « Historique » dans le tableau des clients

**Files:**
- Modify: `src/constants/index.js`
- Modify: `src/components/TableRow.jsx`
- Modify: `src/components/ClientsTable.jsx`
- Test: `tests/components/tc-262-colonne-historique.test.jsx`

**Interfaces:**
- Consumes: `HistoriqueClientPanel` (Task 7).
- Produces: une colonne `historique` et un bouton par ligne.

- [ ] **Step 1 : écrire le test qui échoue**

Créer `tests/components/tc-262-colonne-historique.test.jsx` :

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import TableRow from '../../src/components/TableRow.jsx'
import { CLIENT_TABLE_COLUMNS } from '../../src/constants/index.js'

/**
 * TC-262 — La colonne « Historique » du tableau des clients.
 *
 * ⚠ LE TABLEAU PORTE DÉJÀ DIX COLONNES. La colonne ajoutée doit être un en-tête
 *   déclaré, pas un bouton glissé dans « Actions » : l'utilisateur a demandé un
 *   en-tête, et c'est aussi ce qui garde l'alignement des cellules.
 */

const CLIENT = {
  id: 'c1', nom: 'OUEDRAOGO', prenom: 'SALIF',
  codeAgent: '0123456', numeroAgent: '01234567',
  registeredStoreName: 'C2EGF OUAGA', dateAjout: '13/10/2026',
}

const rendre = (props = {}) => render(
  <table><tbody>
    <TableRow client={CLIENT} index={0} onEdit={vi.fn()} {...props} />
  </tbody></table>,
)

afterEach(cleanup)

describe('TC-262 — la colonne', () => {
  it('[TC-262-01] « Historique » est un en-tête déclaré', () => {
    expect(CLIENT_TABLE_COLUMNS.some((c) => c.key === 'historique' && c.label === 'Historique')).toBe(true)
  })

  it('[TC-262-02] chaque ligne porte autant de cellules que d’en-têtes, plus les actions', () => {
    const { container } = rendre()
    expect(container.querySelectorAll('td')).toHaveLength(CLIENT_TABLE_COLUMNS.length + 1)
  })

  it('[TC-262-03] le bouton nomme le client, pour les lecteurs d’écran', () => {
    rendre()
    expect(screen.getByRole('button', { name: /Historique de OUEDRAOGO SALIF/ })).toBeInTheDocument()
  })

  it('[TC-262-04] le bouton remonte le client cliqué', () => {
    const onHistorique = vi.fn()
    rendre({ onHistorique })
    fireEvent.click(screen.getByRole('button', { name: /Historique/ }))
    expect(onHistorique).toHaveBeenCalledWith(CLIENT)
  })

  /** Sans gestionnaire, pas de bouton inerte : la colonne reste vide. */
  it('[TC-262-05] sans `onHistorique`, aucun bouton n’est proposé', () => {
    rendre({ onHistorique: undefined })
    expect(screen.queryByRole('button', { name: /Historique/ })).toBeNull()
  })
})
```

- [ ] **Step 2 : lancer le test pour le voir échouer**

```bash
npx vitest run tests/components/tc-262-colonne-historique.test.jsx
```
Attendu : ÉCHEC sur `[TC-262-01]`.

- [ ] **Step 3 : déclarer la colonne**

Dans `src/constants/index.js`, ajouter après l'entrée `dateAjout` :

```js
  // L'historique d'un agent, toutes boutiques confondues. La colonne ne porte
  // pas une donnée du client mais une PORTE vers ses opérations : son contenu
  // est un bouton, et c'est voulu — l'en-tête existe pour que la cellule soit
  // alignée comme les autres, et pour que l'écran annonce ce qu'il propose.
  { key: 'historique', label: 'Historique', width: 'min-w-28' }
```

- [ ] **Step 4 : ajouter la cellule**

Dans `src/components/TableRow.jsx`, ajouter `onHistorique` à la signature :

```jsx
const TableRow = memo(({ client, index, onEdit, onHistorique }) => {
```

et, juste avant la cellule des actions (`<td className="px-4 py-3 text-center">`) :

```jsx
      <td className="px-4 py-3 text-center">
        {onHistorique && (
          <button
            type="button"
            onClick={() => onHistorique(client)}
            aria-label={`Historique de ${client.nom ?? ''} ${client.prenom ?? ''}`.trim()}
            className="rounded border border-line px-3 py-1 text-sm font-medium text-ink transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            Historique
          </button>
        )}
      </td>
```

- [ ] **Step 5 : brancher le panneau dans le tableau**

Dans `src/components/ClientsTable.jsx` :

1. Importer le panneau et `useState` s'il ne l'est pas déjà :

```jsx
import HistoriqueClientPanel from './clients/HistoriqueClientPanel'
```

2. Ajouter l'état, à côté des autres états du composant :

```jsx
  // Le client dont on regarde l'historique. `null` ferme le panneau — et le hook
  // remet alors tout à zéro, donc rien du client précédent ne survit.
  const [clientHistorique, setClientHistorique] = useState(null)
```

3. Passer `onHistorique={setClientHistorique}` à chaque `<TableRow …>`.

4. Rendre le panneau à la fin du composant, à côté des autres surcouches :

```jsx
      <HistoriqueClientPanel client={clientHistorique} onClose={() => setClientHistorique(null)} />
```

- [ ] **Step 6 : lancer les tests**

```bash
npx vitest run tests/components/tc-262-colonne-historique.test.jsx
npx vitest run tests/components
```
Attendu : PASS. Tout test existant qui compte les colonnes du tableau doit être
mis à jour — c'est attendu, la colonne est nouvelle.

- [ ] **Step 7 : vérification d'ensemble**

```bash
npx eslint src/ tests/ functions/
npx vitest run
npm run test:functions
npm run build
```
Attendu : lint propre, suites vertes, build réussi. Les deux fichiers de
`tests/integration/` échouent sous `npx vitest run` — c'est normal, ils exigent
l'émulateur et se lancent par `npm run test:integration`.

- [ ] **Step 8 : commit**

```bash
git add src/constants/index.js src/components/TableRow.jsx src/components/ClientsTable.jsx tests/components/tc-262-colonne-historique.test.jsx
git commit -m "feat: une colonne Historique qui ouvre le dossier d un agent

Un en-tete declare plutot qu un bouton glisse dans Actions : c est ce qui garde
l alignement des cellules, et ce qui fait que l ecran annonce ce qu il propose.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Après l'implémentation : le déploiement

Trois commandes, dans cet ordre, **chacune étant une décision humaine** (`AGENTS.md`) :

```powershell
firebase use production

# 1. Les index D'ABORD. Attendre « Enabled » dans la console Firestore :
#    un index en construction fait échouer la requête exactement comme un index absent.
firebase deploy --only firestore:indexes

# 2. La fonction.
$env:FUNCTIONS_DISCOVERY_TIMEOUT = 120
firebase deploy --only "functions:listClientHistory"

# 3. L'application, qui seule rend la colonne visible.
git push origin codex/fix-historique-firebase-date
```
