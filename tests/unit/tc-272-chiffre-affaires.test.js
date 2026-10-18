import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * TC-272 — le chiffre d'affaires du réseau, journalier par défaut.
 *
 * ⚠ ZÉRO ET « INDISPONIBLE » SONT DEUX CHOSES, ET LES CONFONDRE EST LE PIÈGE
 *   CENTRAL DE CET ÉCRAN. Une journée sans opération vaut 0 FCFA — c'est une
 *   information, et le patron doit pouvoir la lire. Une requête qui échoue ne
 *   vaut pas 0 : afficher zéro ferait croire à une journée morte un jour où la
 *   boutique a travaillé.
 *
 * ⚠ CE FICHIER NE PEUT PAS PROUVER QUE LA REQUÊTE EST ACCEPTABLE PAR
 *   FIRESTORE — voir `tests/functions/tc-273-ca-forme-de-requete.test.js`, qui
 *   tourne contre le vrai émulateur pour ça. Ici, on ne vérifie que la FORME
 *   des appels et l'arithmétique du service, contre un mock. C'est aussi ce
 *   fichier, et lui seul, qui verrouille RÉELLEMENT le code du service contre
 *   un retour en arrière (`not-in`/`in`) — `tc-273` atteste une propriété de
 *   Firestore, pas du code (voir son en-tête).
 */

const getAggregateFromServer = vi.fn()
const sum = vi.fn((champ) => ({ champ }))
const collectionGroup = vi.fn((_db, nom) => ({ nom }))
const query = vi.fn((base, ...c) => ({ base, c }))
const where = vi.fn((f, op, v) => ({ f, op, v }))
vi.mock('firebase/firestore', () => ({
  getAggregateFromServer: (...a) => getAggregateFromServer(...a),
  sum: (...a) => sum(...a),
  collectionGroup: (...a) => collectionGroup(...a),
  query: (...a) => query(...a),
  where: (...a) => where(...a),
}))
vi.mock('../../src/config/firebase.js', () => ({ db: {} }))

const { chiffreAffaires, bornesPeriode } = await import('../../src/services/chiffreAffairesService.js')

beforeEach(() => {
  // `mockReset()` pour l'agrégat : chaque test pose son propre comportement
  // (résolu, rejeté, une fois puis une autre). `mockClear()` pour le reste :
  // ce sont des fabriques de requête dont l'IMPLÉMENTATION doit survivre
  // (sinon `where(...)` renverrait `undefined` au test suivant) — seul leur
  // historique d'appels doit repartir à zéro.
  getAggregateFromServer.mockReset()
  sum.mockClear()
  collectionGroup.mockClear()
  query.mockClear()
  where.mockClear()
})

describe('TC-272 — les bornes', () => {
  it('[TC-272-01] le jour passe par la journée d’exploitation', () => {
    const { debut, fin } = bornesPeriode({ type: 'jour', cle: '2026-10-15' })
    expect(debut).toBeInstanceOf(Date)
    expect(fin.getTime()).toBeGreaterThan(debut.getTime())
    expect(fin.getTime() - debut.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('[TC-272-02] le mois couvre tout le mois', () => {
    const { debut, fin } = bornesPeriode({ type: 'mois', cle: '2026-10' })
    expect(debut.getUTCMonth()).toBe(9)
    expect(fin.getUTCMonth()).toBe(10)
  })

  /**
   * ⚠ RONDE DE CORRECTION 1 (I1) — LE MOIS PASSE DÉSORMAIS PAR
   *   `getBusinessDayBounds`, COMME LE JOUR. La version précédente construisait
   *   les deux bornes du mois en `Date.UTC` brut, quatre lignes après un
   *   commentaire qui explique pourquoi le JOUR, lui, ne le fait pas — sans
   *   effet pour C2EGF (UTC+0), mais faux pour toute instance décalée. Ce test
   *   couvre le bascule d'année, où une erreur de fuseau se verrait le plus.
   */
  it('[TC-272-02b] le mois couvre le bascule décembre → janvier de l’année suivante', () => {
    const { debut, fin } = bornesPeriode({ type: 'mois', cle: '2026-12' })
    expect(debut.getUTCFullYear()).toBe(2026)
    expect(debut.getUTCMonth()).toBe(11)
    expect(fin.getUTCFullYear()).toBe(2027)
    expect(fin.getUTCMonth()).toBe(0)
  })

  /** Un mois de 28 jours (février, année non bissextile) n'est pas arrondi. */
  it('[TC-272-02c] un mois de 28 jours (février, année non bissextile) est couvert exactement', () => {
    const { debut, fin } = bornesPeriode({ type: 'mois', cle: '2026-02' })
    expect((fin.getTime() - debut.getTime()) / (24 * 60 * 60 * 1000)).toBe(28)
  })
})

describe('TC-272 — les trois index existent réellement (ronde de correction 1, I5 ; ronde 2, R52)', () => {
  /**
   * ⚠ UNE LISTE BLANCHE (`tc-257`) N'EST QUE LA MOITIÉ DE LA GARDE. Rien
   *   n'empêchait quelqu'un de retirer un index de `firestore.indexes.json`
   *   sans qu'aucun test ne proteste : `tc-257` constaterait l'ABSENCE de
   *   surplus (vrai), `tc-272` passerait contre un mock (aveugle à la vraie
   *   forme), et `tc-273` passerait aussi — L'ÉMULATEUR CRÉE SES INDEX À LA
   *   VOLÉE, contrairement à la production. Le déploiement casserait alors les
   *   agrégations filtrées en silence, et la carte dirait « Chiffre
   *   indisponible » pour toujours. Ces trois tests lisent le fichier réel et
   *   EXIGENT que les trois index existent.
   */
  const index = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'))
  const composite = (fields) => index.indexes.some((i) =>
    i.collectionGroup === 'history'
    && i.queryScope === 'COLLECTION_GROUP'
    && JSON.stringify(i.fields) === JSON.stringify(fields))

  it('[TC-272-10] l’index {statut, createdAt} existe (sert les soustractions Annulée/Supprimée)', () => {
    expect(composite([
      { fieldPath: 'statut', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
    ])).toBe(true)
  })

  it('[TC-272-11] l’index {type, createdAt} existe (sert les soustractions Ravitaillement/Retour/Clôture)', () => {
    expect(composite([
      { fieldPath: 'type', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
    ])).toBe(true)
  })

  /**
   * ⚠ RONDE DE CORRECTION 2 (R52) — SERT LES SIX INTERSECTIONS DE
   *   L'INCLUSION-EXCLUSION (`type == … ET statut == …`), nécessaires depuis
   *   qu'une clôture ANNULÉE ou un retour SUPPRIMÉ se sont révélés possibles
   *   (`cancelClosure`, `trashReplenishmentReturn` — voir l'en-tête du
   *   service). Sans cet index, les six agrégations d'intersection échouent en
   *   production et `chiffreAffaires` rend `{ total: null, incomplet: false }`
   *   à chaque ouverture.
   */
  it('[TC-272-11b] l’index {type, statut, createdAt} existe (sert les six intersections)', () => {
    expect(composite([
      { fieldPath: 'type', order: 'ASCENDING' },
      { fieldPath: 'statut', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
    ])).toBe(true)
  })
})

describe('TC-272 — la somme', () => {
  /**
   * ⚠ DOUZE AGRÉGATIONS, PAS UNE. Depuis la ronde de correction 2 (R52),
   *   `chiffreAffaires` fait DOUZE allers-retours : le total, trois sommes par
   *   type dealer, deux sommes par statut défait, et six intersections
   *   type × statut (inclusion-exclusion complète — voir l'en-tête du
   *   service) — jamais une seule requête `not-in` ou `type in [...]`. Un
   *   mock unique (`mockResolvedValue`) appliqué aux douze renverrait
   *   847 300 000 pour CHACUN des douze appels, et l'arithmétique ne
   *   donnerait pas 847 300 000 : on distingue donc les douze réponses avec
   *   `mockResolvedValueOnce`, dans l'ORDRE d'émission (voir TC-272-14 plus
   *   bas, qui verrouille cet ordre et cette arithmétique explicitement).
   */
  it('[TC-272-03] elle agrège `montant` sur le groupe `history`', async () => {
    getAggregateFromServer
      .mockResolvedValueOnce({ data: () => ({ total: 847300000 }) }) // total
      .mockResolvedValueOnce({ data: () => ({ total: 0 }) })          // type: Ravitaillement
      .mockResolvedValueOnce({ data: () => ({ total: 0 }) })          // type: Retour
      .mockResolvedValueOnce({ data: () => ({ total: 0 }) })          // type: Clôture
      .mockResolvedValueOnce({ data: () => ({ total: 0 }) })          // statut: Annulée
      .mockResolvedValueOnce({ data: () => ({ total: 0 }) })          // statut: Supprimée
      .mockResolvedValueOnce({ data: () => ({ total: 0 }) })          // Ravitaillement∩Annulée
      .mockResolvedValueOnce({ data: () => ({ total: 0 }) })          // Ravitaillement∩Supprimée
      .mockResolvedValueOnce({ data: () => ({ total: 0 }) })          // Retour∩Annulée
      .mockResolvedValueOnce({ data: () => ({ total: 0 }) })          // Retour∩Supprimée
      .mockResolvedValueOnce({ data: () => ({ total: 0 }) })          // Clôture∩Annulée
      .mockResolvedValueOnce({ data: () => ({ total: 0 }) })          // Clôture∩Supprimée
    const r = await chiffreAffaires({ type: 'jour', cle: '2026-10-15' })
    expect(r).toEqual({ total: 847300000, incomplet: false })
    expect(sum).toHaveBeenCalledWith('montant')
  })

  /** ⚠ REVIEW FOCUS 1 — une journée réellement vide vaut 0, et se lit. */
  it('[TC-272-04] une journée sans opération vaut 0, pas null', async () => {
    getAggregateFromServer.mockResolvedValue({ data: () => ({ total: 0 }) })
    expect(await chiffreAffaires({ type: 'jour', cle: '2026-10-15' }))
      .toEqual({ total: 0, incomplet: false })
  })

  /** ⚠ Et une panne ne vaut PAS 0. */
  it('[TC-272-05] une requête en échec rend null', async () => {
    getAggregateFromServer.mockRejectedValue(new Error('index manquant'))
    expect(await chiffreAffaires({ type: 'jour', cle: '2026-10-15' }))
      .toEqual({ total: null, incomplet: false })
  })

  /**
   * ⚠ CE QUE CE TEST VÉRIFIE VRAIMENT (ronde de correction 1, I2) — LA GARDE
   *   DE TYPE DU SERVICE, PAS UN COMPORTEMENT RÉEL DE FIRESTORE. Mesuré contre
   *   le vrai émulateur (`tc-273-04`) : un `montant` non numérique n'EST PAS
   *   ignoré en rendant `total` non numérique — `sum()` l'exclut purement du
   *   calcul et répond un nombre tout à fait valide. Ce test ne reproduit donc
   *   PAS ce cas réel ; il vérifie que SI un jour l'agrégat répondait une
   *   forme inattendue (`total` absent, SDK qui change), le service refuserait
   *   de la convertir en 0 ou en erreur silencieuse.
   */
  it('[TC-272-06] une réponse dont `total` n’est pas un nombre est signalée, pas convertie', async () => {
    getAggregateFromServer.mockResolvedValue({ data: () => ({ total: null }) })
    expect(await chiffreAffaires({ type: 'jour', cle: '2026-10-15' }))
      .toEqual({ total: null, incomplet: true })
  })

  /**
   * ⚠ LE VERROU DE LA TÂCHE 9. `TC-272-07` du plan d'origine asserte
   *   `where('statut', 'not-in', STATUTS_EXCLUS)` — contre un mock, qui ne
   *   peut PAS voir que Firestore écarte en silence les documents sans
   *   `statut` (voir le brief de la tâche 9, §1, et `tc-273` qui le mesure
   *   contre le vrai émulateur : 1 000 au lieu de 8 000 sur le même jeu). Ce
   *   test remplace l'ancien par son inverse exact : aucun appel à `where` ne
   *   doit jamais porter `not-in`, pour empêcher un retour en arrière vers la
   *   requête fautive.
   */
  it('[TC-272-07] aucun appel à where n’utilise not-in (verrou contre un retour en arrière)', async () => {
    getAggregateFromServer.mockResolvedValue({ data: () => ({ total: 0 }) })
    await chiffreAffaires({ type: 'jour', cle: '2026-10-15' })
    const operateurs = where.mock.calls.map(([, op]) => op)
    expect(operateurs).not.toContain('not-in')
  })

  /**
   * ⚠ LE MÊME VERROU, POUR LE DÉFAUT DE LA RONDE DE CORRECTION 1. Le brief
   *   demandait explicitement de NE PAS remplacer les trois soustractions de
   *   `type` par un `where('type', 'in', [...])` positif : il écarterait en
   *   silence tout type inattendu ou absent — le piège exact de `not-in`,
   *   déplacé sur un autre champ.
   */
  it('[TC-272-08] aucun appel à where n’utilise in (jamais de liste positive sur type)', async () => {
    getAggregateFromServer.mockResolvedValue({ data: () => ({ total: 0 }) })
    await chiffreAffaires({ type: 'jour', cle: '2026-10-15' })
    const operateurs = where.mock.calls.map(([, op]) => op)
    expect(operateurs).not.toContain('in')
  })

  /**
   * ⚠ RONDE DE CORRECTION 1 (CRITIQUE) — LES TROIS SOUSTRACTIONS DE `type`
   *   SONT ÉMISES. `history` porte aussi le float du dealer (ravitaillement,
   *   clôture, retour — voir l'en-tête de `chiffreAffairesService.js`) :
   *   sans ces trois agrégations, la carte additionnerait de l'argent que le
   *   réseau s'envoie à lui-même.
   */
  it('[TC-272-09] les trois soustractions de type (Ravitaillement, Retour, Clôture) sont bien émises', async () => {
    getAggregateFromServer.mockResolvedValue({ data: () => ({ total: 0 }) })
    await chiffreAffaires({ type: 'jour', cle: '2026-10-15' })
    const filtresType = where.mock.calls
      .filter(([f, op]) => f === 'type' && op === '==')
      .map(([, , v]) => v)
    // ⚠ CHAQUE TYPE APPARAÎT DEUX FOIS DEPUIS R52 : une fois seul (Σ(A)), une
    //   fois dans chacune des deux intersections — d'où `expect.arrayContaining`
    //   plutôt qu'une égalité stricte sur un ensemble de 3, et le test dédié
    //   ci-dessous (TC-272-12) qui verrouille spécifiquement les SIX paires.
    expect(filtresType).toEqual(expect.arrayContaining(['Clôture', 'Ravitaillement', 'Retour']))
  })

  /**
   * ⚠ RONDE DE CORRECTION 2 (R52) — LES SIX INTERSECTIONS type × statut SONT
   *   ÉMISES, EN BOUCLE. Chaque appel à `query()` reçoit les clauses `where`
   *   de CETTE requête précise (`query(base, ...clauses)`) : on peut donc
   *   retrouver, par appel, quelle paire (type, statut) a été interrogée
   *   ENSEMBLE — pas seulement que les deux champs ont chacun été utilisés
   *   quelque part. Sans ces six requêtes, une clôture annulée ou un retour
   *   supprimé seraient de nouveau comptés deux fois (voir `tc-273-05`, qui
   *   mesure ce défaut contre l'émulateur : −1 870 000 au lieu de 350 000).
   */
  it('[TC-272-12] les six intersections type × statut sont bien émises, chacune sur sa propre requête', async () => {
    getAggregateFromServer.mockResolvedValue({ data: () => ({ total: 0 }) })
    await chiffreAffaires({ type: 'jour', cle: '2026-10-15' })
    const combinaisons = query.mock.calls
      .map(([, ...clauses]) => clauses)
      .filter((clauses) => clauses.some((c) => c.f === 'type') && clauses.some((c) => c.f === 'statut'))
      .map((clauses) => {
        const type = clauses.find((c) => c.f === 'type').v
        const statut = clauses.find((c) => c.f === 'statut').v
        return `${type}×${statut}`
      })
    expect(combinaisons.sort()).toEqual([
      'Clôture×Annulée', 'Clôture×Supprimée',
      'Ravitaillement×Annulée', 'Ravitaillement×Supprimée',
      'Retour×Annulée', 'Retour×Supprimée',
    ].sort())
  })

  /**
   * ⚠ DOUZE AGRÉGATIONS ÉMISES, ET L'ARITHMÉTIQUE EXACTE DE L'INCLUSION-
   *   EXCLUSION (ronde de correction 2, R52) : total − Σ(A) − Σ(B∪C) +
   *   Σ(intersections), JAMAIS la simple soustraction à six termes de la
   *   ronde 1 (qui double-comptait — voir `tc-273-05`). Dans l'ORDRE
   *   d'émission : total, 3× type, 2× statut, 6× intersection.
   *   100000 − (1000+2000+3000) − (4000+5000) + (100+200+300+400+500+600)
   *   = 100000 − 6000 − 9000 + 2100 = 87100.
   */
  it('[TC-272-14] douze agrégations sont émises, et le résultat suit l’inclusion-exclusion complète', async () => {
    getAggregateFromServer
      .mockResolvedValueOnce({ data: () => ({ total: 100000 }) }) // total
      .mockResolvedValueOnce({ data: () => ({ total: 1000 }) })   // type: Ravitaillement
      .mockResolvedValueOnce({ data: () => ({ total: 2000 }) })   // type: Retour
      .mockResolvedValueOnce({ data: () => ({ total: 3000 }) })   // type: Clôture
      .mockResolvedValueOnce({ data: () => ({ total: 4000 }) })   // statut: Annulée
      .mockResolvedValueOnce({ data: () => ({ total: 5000 }) })   // statut: Supprimée
      .mockResolvedValueOnce({ data: () => ({ total: 100 }) })    // Ravitaillement∩Annulée
      .mockResolvedValueOnce({ data: () => ({ total: 200 }) })    // Ravitaillement∩Supprimée
      .mockResolvedValueOnce({ data: () => ({ total: 300 }) })    // Retour∩Annulée
      .mockResolvedValueOnce({ data: () => ({ total: 400 }) })    // Retour∩Supprimée
      .mockResolvedValueOnce({ data: () => ({ total: 500 }) })    // Clôture∩Annulée
      .mockResolvedValueOnce({ data: () => ({ total: 600 }) })    // Clôture∩Supprimée
    const r = await chiffreAffaires({ type: 'jour', cle: '2026-10-15' })
    expect(getAggregateFromServer).toHaveBeenCalledTimes(12)
    expect(r).toEqual({ total: 87100, incomplet: false })
  })

  /**
   * ⚠ UN SEUL TERME MANQUANT INTERDIT LA SOUSTRACTION ENTIÈRE — Y COMPRIS UN
   *   TERME DU MILIEU, ET DÉSORMAIS PARMI LES INTERSECTIONS DE LA RONDE 2.
   *   Une soustraction dont un terme manque n'est pas un chiffre d'affaires
   *   partiel : c'est une absence totale d'information fiable. Le terme en
   *   échec ici est la 7ᵉ des douze requêtes (la première intersection,
   *   Ravitaillement∩Annulée — pile au milieu, et le genre de terme ajouté
   *   par R52 qu'un code bâclé pourrait exclure de sa vérification).
   */
  it('[TC-272-15] une panne sur le terme du MILIEU (une intersection) rend { total: null, incomplet: false }, jamais un total partiel', async () => {
    getAggregateFromServer
      .mockResolvedValueOnce({ data: () => ({ total: 100000 }) }) // total : OK
      .mockResolvedValueOnce({ data: () => ({ total: 1000 }) })   // type: Ravitaillement : OK
      .mockResolvedValueOnce({ data: () => ({ total: 2000 }) })   // type: Retour : OK
      .mockResolvedValueOnce({ data: () => ({ total: 3000 }) })   // type: Clôture : OK
      .mockResolvedValueOnce({ data: () => ({ total: 4000 }) })   // statut: Annulée : OK
      .mockResolvedValueOnce({ data: () => ({ total: 5000 }) })   // statut: Supprimée : OK
      .mockRejectedValueOnce(new Error('index manquant'))          // Ravitaillement∩Annulée : échoue
      .mockResolvedValueOnce({ data: () => ({ total: 200 }) })    // Ravitaillement∩Supprimée : OK
      .mockResolvedValueOnce({ data: () => ({ total: 300 }) })    // Retour∩Annulée : OK
      .mockResolvedValueOnce({ data: () => ({ total: 400 }) })    // Retour∩Supprimée : OK
      .mockResolvedValueOnce({ data: () => ({ total: 500 }) })    // Clôture∩Annulée : OK
      .mockResolvedValueOnce({ data: () => ({ total: 600 }) })    // Clôture∩Supprimée : OK
    const r = await chiffreAffaires({ type: 'jour', cle: '2026-10-15' })
    expect(r).toEqual({ total: null, incomplet: false })
  })
})
