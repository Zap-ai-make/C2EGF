import { describe, it, expect } from 'vitest'
import {
  choisirNomLePlusComplet,
  planifierGrappe,
  planifierFusion,
  verifierSauvegarde,
  enDitPlus,
  scinderParNomExact,
  CHAMPS_COMPLETABLES,
} from '../../scripts/lib/fusionClients.mjs'

/**
 * TC-248 — Fusionner deux fiches qui désignent le même commerce.
 *
 * POURQUOI CE FICHIER EST PLUS SÉVÈRE QUE LES AUTRES
 * ──────────────────────────────────────────────────
 * TC-247 décrit des fiches ; celui-ci en SUPPRIME. Une erreur de TC-247 produit
 * un rapport faux, qu'on relit. Une erreur ici détruit des fiches en production,
 * et une opération rattachée à une fiche effacée ne se retrouve pas — la
 * sauvegarde permet de restaurer, pas de savoir qu'il fallait le faire.
 *
 * LES TROIS CHOSES QUI NE DOIVENT JAMAIS ARRIVER
 * ──────────────────────────────────────────────
 *   1. Supprimer une fiche qui porte des opérations sans les avoir repointées.
 *   2. Perdre une annotation (« INTERDIT », « PAS DE DEPOT ») en gardant la
 *      fiche au nom le plus court.
 *   3. Fusionner deux commerces distincts — d'où le lot C, jamais touché.
 */
describe('TC-248 — le nom que la survivante doit porter', () => {
  /**
   * ⚠ L'ANNOTATION EST DANS LE NOM LE PLUS LONG, ET C'EST TOUT L'ENJEU.
   *   Garder « SOUBEIGA INOUSSA » plutôt que « SOUBEIGA INOUSSA INTERDIT »
   *   réautoriserait un client banni, sans trace et sans compteur pour le dire.
   */
  it('[TC-248-01] retient le nom qui porte l’annotation', () => {
    const choisie = choisirNomLePlusComplet([
      { id: 'a', nom: 'SOUBEIGA', prenom: 'INOUSSA' },
      { id: 'b', nom: 'SOUBEIGA', prenom: 'INOUSSA INTERDIT' },
    ])

    expect(choisie.id).toBe('b')
  })

  it('[TC-248-02] retient l’orthographe la plus développée', () => {
    const choisie = choisirNomLePlusComplet([
      { id: 'v1', nom: 'ILBOUDO', prenom: 'T.ALAYE' },
      { id: 'v2', nom: 'ILBOUDO', prenom: 'TONGONOMA ALAYE' },
      { id: 'v3', nom: 'ILBOUDO', prenom: 'T ALAYE' },
    ])

    expect(choisie.id).toBe('v2')
  })

  /**
   * À nombre de mots égal, la chaîne la plus longue — « TONGONOMA » en dit plus
   * que « T ». Et à égalité parfaite, l'id : il faut un ordre TOTAL, sinon le
   * dry-run ne décrit pas ce que `--execute` fera.
   */
  it('[TC-248-03] départage à mots égaux, puis de façon stable', () => {
    expect(choisirNomLePlusComplet([
      { id: 'a', nom: 'ILBOUDO', prenom: 'T' },
      { id: 'b', nom: 'ILBOUDO', prenom: 'TONGONOMA' },
    ]).id).toBe('b')

    const identiques = [
      { id: 'z', nom: 'KONE', prenom: 'ALI' },
      { id: 'a', nom: 'KONE', prenom: 'ALI' },
    ]
    expect(choisirNomLePlusComplet(identiques).id).toBe('a')
    expect(choisirNomLePlusComplet([...identiques].reverse()).id).toBe('a')
  })
})

describe('TC-248 — le plan d’une grappe', () => {
  const grappe = (membres) => ({ cle: 'agent:code:1234567', membres })

  it('[TC-248-04] range en lot A des noms identiques dont les perdantes ne servent pas', () => {
    const plan = planifierGrappe(
      grappe([
        { id: 'a', nom: 'CISSE', prenom: 'ADAMA' },
        { id: 'b', nom: 'CISSE', prenom: 'ADAMA' },
      ]),
      new Map([['a', 5]]),
    )

    expect(plan.lot).toBe('A')
    expect(plan.survivante.id).toBe('a')
    expect(plan.perdantes.map((p) => p.id)).toEqual(['b'])
    expect(plan.perdantesReferencees).toEqual([])
    expect(plan.nomAReporter).toBeNull()
  })

  /**
   * ⚠ LA SURVIVANTE EST LA PLUS RÉFÉRENCÉE, PAS LA PLUS RICHE.
   *   Garder la fiche la plus complète obligerait à repointer plus d'opérations,
   *   donc à multiplier les écritures qui peuvent échouer. Une fiche riche mais
   *   orpheline se recopie ; une opération rattachée au vide, non. Et le nom se
   *   reporte, donc ce choix ne coûte aucune information.
   */
  it('[TC-248-05] garde la fiche la plus utilisée, et lui reporte le nom complet', () => {
    const plan = planifierGrappe(
      grappe([
        { id: 'court', nom: 'ILBOUDO', prenom: 'T ALAYE' },
        { id: 'long', nom: 'ILBOUDO', prenom: 'TONGONOMA ALAYE' },
      ]),
      new Map([['court', 8], ['long', 2]]),
    )

    expect(plan.lot).toBe('B')
    expect(plan.survivante.id).toBe('court')
    expect(plan.nomAReporter).toEqual({ nom: 'ILBOUDO', prenom: 'TONGONOMA ALAYE', depuis: 'long' })
    // « long » porte deux opérations : elles doivent être repointées AVANT
    // qu'il ne soit supprimé.
    expect(plan.perdantesReferencees).toEqual(['long'])
  })

  it('[TC-248-06] bascule en lot B dès qu’une perdante porte une opération', () => {
    const plan = planifierGrappe(
      grappe([
        { id: 'a', nom: 'CISSE', prenom: 'ADAMA' },
        { id: 'b', nom: 'CISSE', prenom: 'ADAMA' },
      ]),
      new Map([['a', 5], ['b', 1]]),
    )

    expect(plan.lot).toBe('B')
    expect(plan.perdantesReferencees).toEqual(['b'])
  })

  /**
   * ⚠ LE LOT C N'A PAS DE PLAN, ET C'EST VOULU.
   *   Un même code agent sur « SAWADOGO HAMIDOU » et « BELEM WENDKUNI » : soit
   *   le code a été mal saisi, soit le commerce a changé de main. Les deux
   *   hypothèses appellent des gestes opposés, et aucune règle ne les sépare.
   */
  it('[TC-248-07] refuse de planifier des noms sans aucun mot commun', () => {
    expect(planifierGrappe(
      grappe([
        { id: 's', nom: 'SAWADOGO', prenom: 'HAMIDOU' },
        { id: 'b', nom: 'BELEM', prenom: 'WENDKUNI' },
      ]),
      new Map([['b', 1]]),
    )).toBeNull()
  })

  /**
   * ⚠ UN REPORT DE NOM QUI NE CHANGE RIEN POLLUE LA PISTE D'AUDIT.
   *   À mots et longueur égaux, `choisirNomLePlusComplet` départage par id : elle
   *   peut donc désigner une autre fiche portant le MÊME nom. Reporter alors
   *   écrirait pour rien et, surtout, journaliserait un changement de nom
   *   inexistant — dans le journal qu'on consultera si une fusion tourne mal.
   *   Trouvé au dry-run sur l'émulateur : « KONE ALI → KONE ALI ».
   */
  it('[TC-248-18] ne reporte pas un nom identique à celui de la survivante', () => {
    const plan = planifierGrappe(
      grappe([
        { id: 't1', nom: 'KONE', prenom: 'ALI' },
        { id: 't2', nom: 'KONE', prenom: 'ALI', numeroPersonnel: '76445566' },
      ]),
      new Map([['t1', 1], ['t2', 1]]),
    )

    // t2 survit (même nombre de références, mais plus complète) et c'est t1 que
    // l'ordre par id désigne comme porteuse du nom : le report serait vide.
    expect(plan.survivante.id).toBe('t2')
    expect(plan.nomAReporter).toBeNull()
  })

  /**
   * ⚠ LE REPORT ARBITRAIRE — le défaut le plus coûteux de ce script, parce qu'il
   *   a réécrit de vrais noms en production avant d'être vu.
   *
   *   « BOUKARY » et « BOUKARE » ont le même nombre de mots et la même longueur.
   *   `choisirNomLePlusComplet` doit rendre une fiche, donc elle les départage
   *   par identifiant Firestore — un ordre technique. Reporter sur cette base
   *   réécrit le nom d'une fiche active avec celui d'une fiche abandonnée, au
   *   seul motif qu'un identifiant vient avant l'autre.
   *
   *   Le test fixe l'identifiant de la perdante AVANT celui de la survivante,
   *   pour reproduire exactement l'ordre qui a produit le report en base.
   */
  it('[TC-248-20] ne réécrit pas un nom au seul motif de l’ordre des identifiants', () => {
    const plan = planifierGrappe(
      grappe([
        { id: 'aaa', nom: 'OUEDRAOGO', prenom: 'BOUKARE' },
        { id: 'zzz', nom: 'OUEDRAOGO', prenom: 'BOUKARY' },
      ]),
      new Map([['zzz', 4]]),
    )

    expect(plan.survivante.id).toBe('zzz')
    expect(plan.nomAReporter).toBeNull()
  })

  it('[TC-248-21] reporte quand le nom en dit vraiment plus', () => {
    const plusLong = planifierGrappe(
      grappe([
        { id: 'aaa', nom: 'SANKARA', prenom: 'ABIBA' },
        { id: 'zzz', nom: 'SANKARA', prenom: 'ABBA' },
      ]),
      new Map([['zzz', 4]]),
    )
    expect(plusLong.nomAReporter.prenom).toBe('ABIBA')

    const plusDeMots = planifierGrappe(
      grappe([
        { id: 'aaa', nom: 'SAWADOGO', prenom: 'A RAZAK' },
        { id: 'zzz', nom: 'SAWADOGO', prenom: 'RAZAK' },
      ]),
      new Map([['zzz', 4]]),
    )
    expect(plusDeMots.nomAReporter.prenom).toBe('A RAZAK')
  })

  it('[TC-248-22] compare les noms, pas les identifiants', () => {
    expect(enDitPlus({ nom: 'A', prenom: 'B C' }, { nom: 'A', prenom: 'B' })).toBe(true)
    expect(enDitPlus({ nom: 'SANKARA', prenom: 'ABIBA' }, { nom: 'SANKARA', prenom: 'ABBA' })).toBe(true)
    // Même composition, même longueur : rien ne les sépare.
    expect(enDitPlus({ nom: 'OUEDRAOGO', prenom: 'BOUKARE' }, { nom: 'OUEDRAOGO', prenom: 'BOUKARY' })).toBe(false)
    expect(enDitPlus({ nom: 'A', prenom: 'B' }, { nom: 'A', prenom: 'B C' })).toBe(false)
  })

  /** La casse et les accents ne font pas un nom différent — donc pas un report. */
  it('[TC-248-19] ne reporte pas une simple différence de casse ou d’accent', () => {
    const plan = planifierGrappe(
      grappe([
        { id: 'a', nom: 'OUEDRAOGO', prenom: 'AISSATA', numeroPersonnel: '70112233' },
        { id: 'b', nom: 'OUÉDRAOGO', prenom: 'Aïssata' },
      ]),
      new Map([['a', 2], ['b', 1]]),
    )

    expect(plan.survivante.id).toBe('a')
    expect(plan.nomAReporter).toBeNull()
  })

  it('[TC-248-08] complète un champ vide de la survivante depuis une perdante', () => {
    const plan = planifierGrappe(
      grappe([
        { id: 'a', nom: 'KONE', prenom: 'ALI' },
        { id: 'b', nom: 'KONE', prenom: 'ALI', numeroPersonnel: '70112233' },
      ]),
      new Map([['a', 3]]),
    )

    expect(plan.champsACompleter).toEqual({ numeroPersonnel: '70112233' })
  })

  /**
   * ⚠ JAMAIS D'ÉCRASEMENT. Une « fusion » qui remplace un téléphone à jour par
   *   celui d'une fiche abandonnée dégrade la donnée qu'elle prétend consolider.
   */
  it('[TC-248-09] ne touche pas un champ que la survivante porte déjà', () => {
    const plan = planifierGrappe(
      grappe([
        { id: 'a', nom: 'KONE', prenom: 'ALI', numeroPersonnel: '76000000' },
        { id: 'b', nom: 'KONE', prenom: 'ALI', numeroPersonnel: '70112233' },
      ]),
      new Map([['a', 3]]),
    )

    expect(plan.champsACompleter).toEqual({})
  })

  it('[TC-248-10] ne complète jamais l’identité agent, qui a formé la grappe', () => {
    expect(CHAMPS_COMPLETABLES).toEqual(['numeroPersonnel'])
    expect(CHAMPS_COMPLETABLES).not.toContain('codeAgent')
    expect(CHAMPS_COMPLETABLES).not.toContain('numeroAgent')
    expect(CHAMPS_COMPLETABLES).not.toContain('orange')
  })

  /** Le même jeu doit donner le même plan, sinon le dry-run ne vaut rien. */
  it('[TC-248-11] choisit la même survivante quel que soit l’ordre de lecture', () => {
    const membres = [
      { id: 'z', nom: 'KONE', prenom: 'ALI' },
      { id: 'a', nom: 'KONE', prenom: 'ALI' },
      { id: 'm', nom: 'KONE', prenom: 'ALI' },
    ]

    const premier = planifierGrappe(grappe(membres), new Map())
    const second = planifierGrappe(grappe([...membres].reverse()), new Map())

    expect(premier.survivante.id).toBe(second.survivante.id)
  })
})

describe('TC-248 — le plan d’ensemble', () => {
  it('[TC-248-12] sépare les trois lots et compte ce qu’il va faire', () => {
    const grappes = [
      {
        cle: 'agent:code:1',
        membres: [{ id: 'a1', nom: 'A', prenom: 'A' }, { id: 'a2', nom: 'A', prenom: 'A' }],
      },
      {
        cle: 'agent:code:2',
        membres: [
          { id: 'b1', nom: 'ILBOUDO', prenom: 'T ALAYE' },
          { id: 'b2', nom: 'ILBOUDO', prenom: 'TONGONOMA ALAYE' },
        ],
      },
      {
        cle: 'agent:code:3',
        membres: [{ id: 'c1', nom: 'SAWADOGO', prenom: 'HAMIDOU' }, { id: 'c2', nom: 'BELEM', prenom: 'WENDKUNI' }],
      },
    ]

    const plan = planifierFusion(grappes, new Map([['b1', 4], ['b2', 1]]))

    expect(plan.lotA).toHaveLength(1)
    expect(plan.lotB).toHaveLength(1)
    expect(plan.ecartees).toEqual([
      { cle: 'agent:code:3', raison: 'noms sans rapport', membres: grappes[2].membres },
    ])
    expect(plan.fichesSupprimees).toBe(2)
    expect(plan.operationsRepointees).toBe(1)
    expect(plan.nomsReportes).toBe(1)
  })

  it('[TC-248-13] ne planifie rien sur une liste vide', () => {
    expect(planifierFusion([], new Map())).toEqual({
      lotA: [], lotB: [], lotC: [], lotD: [], ecartees: [],
      fichesSupprimees: 0, operationsRepointees: 0, nomsReportes: 0, nomsAbandonnes: 0,
    })
  })
})

/**
 * TC-248 — LE LOT C : le doublon franc noyé dans une grappe à intruses.
 *
 * `planifierGrappe` écarte une grappe dès qu'aucun mot n'est commun à TOUS ses
 * membres. Une seule fiche étrangère suffit donc à jeter un doublon évident. Vu
 * en production parmi les écartées : « SEOGO SYPRIEN · TAPSOBA SERGE · SEOGO
 * SYPRIEN ».
 */
describe('TC-248 — scinder une grappe à intruses', () => {
  it('[TC-248-23] isole les deux fiches identiques et laisse l’intruse', () => {
    const sous = scinderParNomExact({
      cle: 'agent:code:1234567',
      membres: [
        { id: 's1', nom: 'SEOGO', prenom: 'SYPRIEN' },
        { id: 't1', nom: 'TAPSOBA', prenom: 'SERGE' },
        { id: 's2', nom: 'SEOGO', prenom: 'SYPRIEN' },
      ],
    })

    expect(sous).toHaveLength(1)
    expect(sous[0].membres.map((m) => m.id)).toEqual(['s1', 's2'])
    expect(sous[0].cle).toBe('agent:code:1234567|seogo syprien')
  })

  it('[TC-248-24] rapproche malgré la casse, les accents et les espaces doublés', () => {
    const sous = scinderParNomExact({
      cle: 'agent:code:2',
      membres: [
        { id: 'a', nom: 'SAWADOGO ', prenom: ' HAMIDOU' },
        { id: 'b', nom: 'BELEM', prenom: 'WENDKUNI' },
        { id: 'c', nom: 'Sawadogo', prenom: 'Hamidou' },
      ],
    })

    expect(sous).toHaveLength(1)
    expect(sous[0].membres.map((m) => m.id)).toEqual(['a', 'c'])
  })

  it('[TC-248-25] ne rend rien quand aucune fiche ne se répète', () => {
    expect(scinderParNomExact({
      cle: 'agent:code:3',
      membres: [
        { id: 'a', nom: 'SAWADOGO', prenom: 'ILIASSE' },
        { id: 'b', nom: 'ZOUANGA', prenom: 'OUMAROU' },
        { id: 'c', nom: 'KOUSSE', prenom: 'ALIOUNE' },
      ],
    })).toEqual([])
  })

  /**
   * ⚠ ICI LE NOM DOIT ÊTRE STRICTEMENT IDENTIQUE, pas « d'un noyau commun »
   *   comme au lot B. Ces grappes ont déjà échoué au test global : les rouvrir
   *   avec un critère large y réunirait deux prénoms distincts partageant un
   *   patronyme. Le prix est qu'une variante d'orthographe reste écartée.
   */
  it('[TC-248-26] ne réunit pas deux prénoms différents sous un même patronyme', () => {
    expect(scinderParNomExact({
      cle: 'agent:code:4',
      membres: [
        { id: 'a', nom: 'OUEDRAOGO', prenom: 'ALI' },
        { id: 'b', nom: 'KABORE', prenom: 'MOUSSA' },
        { id: 'c', nom: 'OUEDRAOGO', prenom: 'SALIF' },
      ],
    })).toEqual([])
  })

  it('[TC-248-27] range le sous-doublon en lot C et déclare l’intruse intacte', () => {
    const grappe = {
      cle: 'agent:code:5',
      membres: [
        { id: 's1', nom: 'SANFO', prenom: 'SIDIKI' },
        { id: 's2', nom: 'SANFO', prenom: 'SIDIKI' },
        { id: 'n1', nom: 'NAGRAOGO', prenom: 'YOUSSIF' },
      ],
    }

    const plan = planifierFusion([grappe], new Map([['s1', 3]]))

    expect(plan.lotA).toEqual([])
    expect(plan.lotB).toEqual([])
    expect(plan.lotC).toHaveLength(1)
    expect(plan.lotC[0].lot).toBe('C')
    expect(plan.lotC[0].survivante.id).toBe('s1')
    expect(plan.lotC[0].perdantes.map((m) => m.id)).toEqual(['s2'])
    expect(plan.fichesSupprimees).toBe(1)

    // L'intruse n'est pas fusionnée, et le plan le dit — sans cette ligne, elle
    // disparaîtrait du rapport et la boutique croirait la grappe réglée.
    expect(plan.ecartees).toEqual([{
      cle: 'agent:code:5',
      raison: "intruses d'une grappe scindée",
      membres: [grappe.membres[2]],
    }])
  })

  it('[TC-248-28] repointe aussi dans un lot C, si la perdante sert', () => {
    const plan = planifierFusion([{
      cle: 'agent:code:6',
      membres: [
        { id: 's1', nom: 'SEOGO', prenom: 'SYPRIEN' },
        { id: 's2', nom: 'SEOGO', prenom: 'SYPRIEN' },
        { id: 'x', nom: 'TAPSOBA', prenom: 'SERGE' },
      ],
    }], new Map([['s1', 4], ['s2', 2]]))

    expect(plan.lotC[0].perdantesReferencees).toEqual(['s2'])
    expect(plan.operationsRepointees).toBe(1)
  })

  /** Une grappe dont rien ne se récupère reste écartée, et le dit autrement. */
  it('[TC-248-29] garde sa raison d’origine quand la scission ne donne rien', () => {
    const plan = planifierFusion([{
      cle: 'agent:code:7',
      membres: [
        { id: 'a', nom: 'SAWADOGO', prenom: 'HAMIDOU' },
        { id: 'b', nom: 'BELEM', prenom: 'WENDKUNI' },
      ],
    }], new Map())

    expect(plan.lotC).toEqual([])
    expect(plan.ecartees[0].raison).toBe('noms sans rapport')
    expect(plan.ecartees[0].membres).toHaveLength(2)
  })
})

/**
 * ⚠ LA PORTE DE VÉRIFICATION — rien ne s'écrit avant elle.
 *   Une sauvegarde qu'on n'a pas relue n'est pas une sauvegarde, c'est un
 *   fichier. Ces tests décrivent ce qui doit faire ABANDONNER.
 */
describe('TC-248 — la sauvegarde doit être relue avant toute écriture', () => {
  const plan = {
    lotA: [{
      cle: 'agent:code:1',
      survivante: { id: 'a1', nom: 'KONE', prenom: 'ALI' },
      perdantes: [{ id: 'a2', nom: 'KONE', prenom: 'ALI' }],
      perdantesReferencees: [],
    }],
    lotB: [{
      cle: 'agent:code:2',
      survivante: { id: 'b1', nom: 'ILBOUDO', prenom: 'T ALAYE' },
      perdantes: [{ id: 'b2', nom: 'ILBOUDO', prenom: 'TONGONOMA ALAYE' }],
      perdantesReferencees: ['b2'],
    }],
  }

  const sauvegardeComplete = {
    fichesSauvees: [
      { id: 'a1', nom: 'KONE', prenom: 'ALI' },
      { id: 'a2', nom: 'KONE', prenom: 'ALI' },
      { id: 'b1', nom: 'ILBOUDO', prenom: 'T ALAYE' },
      { id: 'b2', nom: 'ILBOUDO', prenom: 'TONGONOMA ALAYE' },
    ],
    operationsSauvees: [
      { chemin: 'clients/s1/history/h1', clientId: 'b2' },
    ],
  }

  it('[TC-248-14] ne signale rien quand tout est sauvegardé', () => {
    expect(verifierSauvegarde({ plan, ...sauvegardeComplete })).toEqual([])
  })

  it('[TC-248-15] abandonne si une fiche à supprimer manque', () => {
    const manques = verifierSauvegarde({
      plan,
      ...sauvegardeComplete,
      fichesSauvees: sauvegardeComplete.fichesSauvees.filter((f) => f.id !== 'a2'),
    })

    expect(manques).toEqual(['fiche absente de la sauvegarde : a2'])
  })

  /**
   * Le nom est ce qu'un report peut écraser. S'il diffère entre la sauvegarde et
   * la lecture, la fusion n'est pas annulable — et c'est probablement qu'une
   * saisie a eu lieu pendant le script.
   */
  it('[TC-248-16] abandonne si un nom sauvegardé ne correspond plus', () => {
    const manques = verifierSauvegarde({
      plan,
      ...sauvegardeComplete,
      fichesSauvees: sauvegardeComplete.fichesSauvees.map((f) => (
        f.id === 'b2' ? { ...f, nom: 'AUTRE' } : f
      )),
    })

    expect(manques).toEqual(['fiche b2 : nom sauvegardé différent de celui lu'])
  })

  /**
   * ⚠ REPOINTER MODIFIE UNE OPÉRATION. Son état d'avant doit donc être
   *   récupérable, sinon on ne sait plus à qui elle appartenait.
   */
  it('[TC-248-17] abandonne si les opérations d’une perdante ne sont pas sauvegardées', () => {
    const manques = verifierSauvegarde({
      plan, fichesSauvees: sauvegardeComplete.fichesSauvees, operationsSauvees: [],
    })

    expect(manques).toEqual(['aucune opération sauvegardée pour la perdante référencée b2'])
  })
})

/**
 * LE LOT D — la décision de la boutique du 2026-10-12.
 *
 * Après l'arbitrage des 175 grappes restantes (0 succession, des écarts
 * d'orthographe, 174 à cheval sur plusieurs boutiques), la consigne a été :
 * réduire chaque grappe à une fiche, prendre un des deux noms.
 *
 * ⚠ CE QUE CES TESTS PROTÈGENT N'EST PAS LA RÈGLE — C'EST SA RETENUE. Une
 *   fusion décidée reste une fusion : elle ne doit ni écraser le nom de la
 *   survivante par un libellé étranger, ni faire disparaître l'autre nom sans
 *   le nommer, ni se cumuler avec le lot C dont elle reprend le périmètre.
 */
describe('TC-248 — le lot D, quand la boutique tranche', () => {
  const sansRapport = {
    cle: 'agent:code:5558862',
    membres: [
      { id: 'd1', nom: 'MME', prenom: 'SAWADOGO', numeroPersonnel: '70112233' },
      { id: 'd2', nom: 'BANQUE RETRAIT', prenom: 'DEPOT' },
    ],
  }

  /**
   * ⚠ LE TEST QUI DIT POURQUOI LE LOT D NE REPORTE PAS DE NOM.
   *   « BANQUE RETRAIT DEPOT » compte trois mots contre deux : la règle du « nom
   *   le plus complet », juste et utile pour une variante d'orthographe, ferait
   *   ici gagner un libellé technique sur un vrai nom de cliente. Dans une
   *   grappe sans noyau commun, « plus de mots » ne veut plus dire « mieux
   *   écrit » — ça ne veut plus rien dire du tout.
   */
  it('[TC-248-18] ne reporte jamais un nom étranger sur la survivante', () => {
    const [plan] = planifierFusion([sansRapport], new Map([['d1', 4]]), {
      fusionnerSansRapport: true,
    }).lotD

    expect(plan.survivante.id).toBe('d1')
    expect(plan.nomAReporter).toBeNull()
  })

  /** La survivante reste la plus référencée : les opérations ne bougent pas. */
  it('[TC-248-19] garde la fiche qui porte les opérations', () => {
    const { lotD } = planifierFusion([sansRapport], new Map([['d2', 9]]), {
      fusionnerSansRapport: true,
    })

    expect(lotD[0].survivante.id).toBe('d2')
    expect(lotD[0].perdantesReferencees).toEqual([])
  })

  /**
   * ⚠ C'EST LE SEUL LOT OÙ UNE INFORMATION DISPARAÎT POUR DE BON. Ailleurs, le
   *   nom abandonné était une autre écriture de celui qui reste. Ici c'est un
   *   nom étranger : s'il n'est pas nommé, « on a pris un des deux noms » n'est
   *   plus une phrase vérifiable.
   */
  it('[TC-248-20] nomme le nom abandonné', () => {
    const { lotD, nomsAbandonnes } = planifierFusion([sansRapport], new Map([['d1', 4]]), {
      fusionnerSansRapport: true,
    })

    expect(lotD[0].nomsAbandonnes).toEqual(['BANQUE RETRAIT DEPOT'])
    expect(nomsAbandonnes).toBe(1)
  })

  /**
   * ⚠ D REMPLACE C, IL NE S'Y AJOUTE PAS. Le lot C ne fusionnait que les
   *   doublons de nom exact d'une grappe à intruses ; D réduit la grappe
   *   entière. Les produire tous les deux planifierait deux fois la suppression
   *   de la même fiche, et la seconde transaction échouerait sur une fiche déjà
   *   partie — un « incident » dans le rapport final, pour une fusion pourtant
   *   réussie.
   */
  it('[TC-248-21] vide le lot C quand le lot D est demandé', () => {
    const aIntruse = {
      cle: 'agent:code:7000001',
      membres: [
        { id: 'x1', nom: 'SEOGO', prenom: 'SYPRIEN' },
        { id: 'x2', nom: 'TAPSOBA', prenom: 'SERGE' },
        { id: 'x3', nom: 'SEOGO', prenom: 'SYPRIEN' },
      ],
    }

    const avec = planifierFusion([aIntruse], new Map(), { fusionnerSansRapport: true })
    expect(avec.lotC).toEqual([])
    expect(avec.lotD).toHaveLength(1)
    expect(avec.lotD[0].perdantes).toHaveLength(2)

    const sans = planifierFusion([aIntruse], new Map())
    expect(sans.lotD).toEqual([])
    expect(sans.lotC).toHaveLength(1)
  })

  /**
   * Une perdante au nom identique à la survivante n'est pas un nom « abandonné »
   * : rien ne se perd à l'effacer. Compter ces cas gonflerait la liste que la
   * boutique doit relire avec des lignes qui ne disent rien.
   */
  it('[TC-248-22] ne compte pas comme abandonné un nom identique à celui qui reste', () => {
    const { lotD } = planifierFusion([{
      cle: 'agent:code:7000002',
      membres: [
        { id: 'y1', nom: 'SEOGO', prenom: 'SYPRIEN' },
        { id: 'y2', nom: 'TAPSOBA', prenom: 'SERGE' },
        { id: 'y3', nom: 'SEOGO', prenom: 'SYPRIEN' },
      ],
    }], new Map(), { fusionnerSansRapport: true })

    expect(lotD[0].nomsAbandonnes).toEqual(['TAPSOBA SERGE'])
  })

  /**
   * ⚠ LE LOT D NE DOIT PAS RAMASSER CE QUE LES AUTRES TRAITENT DÉJÀ. Une grappe
   *   au noyau commun (« ILBOUDO T.ALAYE » / « ILBOUDO TONGONOMA ALAYE ») reste
   *   un lot B, avec son report de nom — c'est ainsi que les annotations
   *   survivent. Si D l'attrapait, le nom le plus complet ne serait plus reporté
   *   et « SOUBEIGA INOUSSA INTERDIT » redeviendrait « SOUBEIGA INOUSSA ».
   */
  it('[TC-248-23] laisse au lot B les grappes qui ont un noyau commun', () => {
    const { lotB, lotD } = planifierFusion([{
      cle: 'agent:code:7000003',
      membres: [
        { id: 'z1', nom: 'SOUBEIGA', prenom: 'INOUSSA' },
        { id: 'z2', nom: 'SOUBEIGA', prenom: 'INOUSSA INTERDIT' },
      ],
    }], new Map(), { fusionnerSansRapport: true })

    expect(lotD).toEqual([])
    expect(lotB).toHaveLength(1)
    expect(lotB[0].nomAReporter.prenom).toBe('INOUSSA INTERDIT')
  })

  /** Le téléphone manquant chez la survivante se complète ; rien ne s'écrase. */
  it('[TC-248-24] complète le téléphone vide sans toucher à celui qui existe', () => {
    const { lotD } = planifierFusion([{
      cle: 'agent:code:7000004',
      membres: [
        { id: 'w1', nom: 'KOANDA', prenom: 'ALI', numeroPersonnel: '' },
        { id: 'w2', nom: 'ZONGO', prenom: 'SALIF', numeroPersonnel: '70445566' },
      ],
    }], new Map([['w1', 3]]), { fusionnerSansRapport: true })

    expect(lotD[0].survivante.id).toBe('w1')
    expect(lotD[0].champsACompleter).toEqual({ numeroPersonnel: '70445566' })
    expect(CHAMPS_COMPLETABLES).not.toContain('codeAgent')
  })
})
