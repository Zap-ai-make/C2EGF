import { describe, it, expect, vi, beforeEach } from 'vitest'

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
 *   des appels et l'arithmétique du service, contre un mock.
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
})

describe('TC-272 — la somme', () => {
  /**
   * ⚠ TROIS AGRÉGATIONS, PAS UNE. Depuis la correction du brief de la tâche 9,
   *   `chiffreAffaires` fait trois allers-retours (total, puis les deux
   *   soustractions) — plus un seul comme le plan d'origine. Un mock unique
   *   (`mockResolvedValue`) appliqué aux trois renverrait ici 847 300 000 pour
   *   CHACUN des trois appels, et la soustraction donnerait un nombre négatif :
   *   on distingue donc les trois réponses avec `mockResolvedValueOnce`, dans
   *   l'ORDRE d'émission (total, annulées, supprimées — voir TC-272-08 plus
   *   bas, qui verrouille cet ordre et cette arithmétique explicitement).
   */
  it('[TC-272-03] elle agrège `montant` sur le groupe `history`', async () => {
    getAggregateFromServer
      .mockResolvedValueOnce({ data: () => ({ total: 847300000 }) }) // total
      .mockResolvedValueOnce({ data: () => ({ total: 0 }) })          // annulées
      .mockResolvedValueOnce({ data: () => ({ total: 0 }) })          // supprimées
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
   * ⚠ REVIEW FOCUS 5 — un `montant` non numérique. Firestore l'ignore
   *   silencieusement dans `sum()`. Le service ne peut pas le détecter seul,
   *   mais il NE DOIT PAS prétendre que la somme est complète : la valeur
   *   `null` rendue par l'agrégat signale exactement ce cas.
   */
  it('[TC-272-06] une somme non numérique est signalée, pas convertie', async () => {
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
   * ⚠ TROIS AGRÉGATIONS ÉMISES, ET L'ARITHMÉTIQUE EXACTE. C'est le montage
   *   corrigé du brief §1 : total − annulées − supprimées, jamais une seule
   *   requête `not-in`.
   */
  it('[TC-272-08] trois agrégations sont émises, et le résultat est total − annulées − supprimées', async () => {
    getAggregateFromServer
      .mockResolvedValueOnce({ data: () => ({ total: 10000 }) }) // total
      .mockResolvedValueOnce({ data: () => ({ total: 1500 }) })  // annulées
      .mockResolvedValueOnce({ data: () => ({ total: 500 }) })   // supprimées
    const r = await chiffreAffaires({ type: 'jour', cle: '2026-10-15' })
    expect(getAggregateFromServer).toHaveBeenCalledTimes(3)
    expect(r).toEqual({ total: 8000, incomplet: false })
  })

  /**
   * ⚠ UN SEUL TERME MANQUANT INTERDIT LA SOUSTRACTION ENTIÈRE. Une
   *   soustraction dont un terme manque n'est pas un chiffre d'affaires
   *   partiel : c'est une absence totale d'information fiable. Rendre le total
   *   brut en ignorant la soustraction en échec AFFICHERAIT un montant trop
   *   haut, avec la même confiance qu'un montant juste.
   */
  it('[TC-272-09] une seule des trois agrégations en échec rend { total: null, incomplet: false }, jamais un total partiel', async () => {
    getAggregateFromServer
      .mockResolvedValueOnce({ data: () => ({ total: 10000 }) }) // total : OK
      .mockRejectedValueOnce(new Error('index manquant'))         // annulées : échoue
      .mockResolvedValueOnce({ data: () => ({ total: 500 }) })    // supprimées : OK
    const r = await chiffreAffaires({ type: 'jour', cle: '2026-10-15' })
    expect(r).toEqual({ total: null, incomplet: false })
  })
})
