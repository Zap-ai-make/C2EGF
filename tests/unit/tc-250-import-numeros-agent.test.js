import { describe, it, expect } from 'vitest'
import {
  normaliserCodeAgent,
  normaliserNumeroAgent,
  indexerParCodeAgent,
  trouverColonnes,
  planifierImport,
  compterBilan,
  ecrituresDe,
  STATUTS,
  COLONNE_CODE,
  COLONNE_NUMERO,
  resoudreCode,
  longueursDeCode,
} from '../../scripts/lib/importNumerosAgent.mjs'
import { analyserCsv, detecterSeparateur, valeurCellule } from '../../scripts/lib/lireTableur.mjs'
import { champsAgent } from '../../src/utils/agentFields.js'

/**
 * TC-250 — Compléter le « Numéro agent » des fiches existantes par import.
 *
 * CE QUE CET IMPORT PEUT CASSER, ET QUI NE SE VERRAIT PAS
 * ──────────────────────────────────────────────────────
 *   1. ÉCRIRE SUR LA MAUVAISE FICHE. Le code agent est la seule clé ; un zéro
 *      initial perdu par le tableur le fait pointer ailleurs. Rien dans le
 *      résultat ne dirait que c'est arrivé.
 *   2. FAIRE DISPARAÎTRE LE CODE AGENT DE L'ÉCRAN. `champsAgent` tranche par la
 *      PRÉSENCE des clés : écrire `numeroAgent` seul sur une fiche héritée fait
 *      cesser la lecture de `orange`. Un import qui ajoute une information en
 *      aurait effacé une autre, sans erreur.
 *   3. PRENDRE LE NUMÉRO PERSONNEL POUR LE NUMÉRO AGENT. Les deux font huit
 *      chiffres : aucune règle de longueur ne s'en plaindrait.
 *   4. ÉCRASER UN NUMÉRO EXISTANT. La consigne l'interdit : conflit, jamais
 *      remplacement.
 *
 * Chacun de ces quatre a son test ci-dessous.
 */

const fiche = (over = {}) => ({
  id: 'f1',
  nom: 'OUEDRAOGO',
  prenom: 'SALIF',
  numeroPersonnel: '70112233',
  registeredStoreId: 'store-A',
  ...over,
})

const ligne = (code, numero, n = 2) => ({ ligne: n, code, numero })

// ─────────────────────────────────────────────────────────────────────────────

describe('TC-250 — le numéro agent, normalisé', () => {
  it('[TC-250-01] garde huit chiffres tels quels', () => {
    expect(normaliserNumeroAgent('01234567')).toEqual({ numero: '01234567', zerosRestitues: 0 })
  })

  /** La seule complétion autorisée par la consigne. */
  it('[TC-250-02] complète sept chiffres par un zéro devant', () => {
    expect(normaliserNumeroAgent('1234567')).toEqual({ numero: '01234567', zerosRestitues: 1 })
  })

  it('[TC-250-03] retire les espaces autour', () => {
    expect(normaliserNumeroAgent('  01234567  ')).toEqual({ numero: '01234567', zerosRestitues: 0 })
    expect(normaliserNumeroAgent('\t1234567\n')).toEqual({ numero: '01234567', zerosRestitues: 1 })
  })

  /**
   * « 01 23 45 67 » est UN numéro écrit avec des espaces. Le refuser rejetterait
   * une saisie parfaitement lisible ; la longueur protège du reste.
   */
  it('[TC-250-04] accepte un numéro écrit avec des espaces intérieurs', () => {
    expect(normaliserNumeroAgent('01 23 45 67')).toEqual({ numero: '01234567', zerosRestitues: 0 })
  })

  it('[TC-250-05] ignore une case vide', () => {
    expect(normaliserNumeroAgent('').refus).toBe('vide')
    expect(normaliserNumeroAgent('   ').refus).toBe('vide')
    expect(normaliserNumeroAgent(null).refus).toBe('vide')
    expect(normaliserNumeroAgent(undefined).refus).toBe('vide')
  })

  /**
   * ⚠ LE CAS MULTIPLE EST RÉEL. La base contient « 06629924/55772628 » et
   *   « 07796503/66553459/75928339 ». En choisir un serait inventer.
   */
  it('[TC-250-06] ignore un champ qui contient plusieurs numéros', () => {
    expect(normaliserNumeroAgent('06629924/55772628').refus).toBe('multiple')
    expect(normaliserNumeroAgent('01234567, 07654321').refus).toBe('multiple')
    expect(normaliserNumeroAgent('01234567 et 07654321').refus).toBe('multiple')
    expect(normaliserNumeroAgent('01234567;07654321').refus).toBe('multiple')
  })

  /** Deux numéros séparés par un espace : la longueur les attrape. */
  it('[TC-250-07] refuse deux numéros collés par un espace', () => {
    expect(normaliserNumeroAgent('1234567 7654321').refus).toBe('longueur')
  })

  it('[TC-250-08] refuse les longueurs impossibles', () => {
    expect(normaliserNumeroAgent('123').refus).toBe('longueur')
    expect(normaliserNumeroAgent('123456789').refus).toBe('longueur')
  })

  it('[TC-250-09] refuse ce qui n’est pas un nombre', () => {
    expect(normaliserNumeroAgent('AG-12345').refus).toBe('non-numerique')
    expect(normaliserNumeroAgent('0123456X').refus).toBe('non-numerique')
  })
})

describe('TC-250 — le code agent, jamais complété', () => {
  it('[TC-250-10] conserve les zéros initiaux', () => {
    expect(normaliserCodeAgent('0123456')).toBe('0123456')
    expect(normaliserCodeAgent('  0000123  ')).toBe('0000123')
  })

  /**
   * ⚠ LA DISSYMÉTRIE EST VOULUE. On complète un numéro parce que sa longueur est
   *   GARANTIE (8). Le code n'a pas de longueur garantie — la base en contient de
   *   1 à 10 chiffres. Compléter un code à l'aveugle le ferait pointer vers la
   *   fiche d'un autre commerce, et l'import écrirait sur le mauvais client.
   */
  it('[TC-250-11] ne complète JAMAIS un code court', () => {
    expect(normaliserCodeAgent('123456')).toBe('123456')
    expect(normaliserCodeAgent('12')).toBe('12')
  })
})

describe('TC-250 — les colonnes du fichier', () => {
  it('[TC-250-12] trouve les deux colonnes exactes', () => {
    expect(trouverColonnes([COLONNE_CODE, COLONNE_NUMERO]))
      .toEqual({ code: COLONNE_CODE, numero: COLONNE_NUMERO })
  })

  /** Un intitulé mal accentué ou mal capitalisé reste le même intitulé. */
  it('[TC-250-13] tolère l’accent, la casse et les espaces', () => {
    const trouvees = trouverColonnes(['  CODE AGENT ', 'Numero Agent'])
    expect(trouvees).toEqual({ code: '  CODE AGENT ', numero: 'Numero Agent' })
  })

  /**
   * ⚠ LE PIÈGE N° 3 : les deux colonnes les plus faciles à confondre. Prendre le
   *   numéro personnel pour le numéro agent écrirait le téléphone du commerçant
   *   dans sa case agent, sur des milliers de fiches, et les deux faisant huit
   *   chiffres aucune règle de longueur ne s'en plaindrait.
   */
  it('[TC-250-14] ne prend JAMAIS « Numéro personnel » pour « Numéro agent »', () => {
    const refus = trouverColonnes([COLONNE_CODE, 'Numéro personnel'])
    expect(refus.erreur).toMatch(/Numéro agent/)
    expect(refus.erreur).toMatch(/deux champs distincts/)
    expect(refus.code).toBeUndefined()
  })

  it('[TC-250-15] refuse un fichier sans la colonne de code', () => {
    expect(trouverColonnes(['Nom', COLONNE_NUMERO]).erreur).toMatch(/Code agent/)
  })

  /** Deux colonnes du même nom : on ne devine pas laquelle est la bonne. */
  it('[TC-250-16] refuse une colonne en double', () => {
    expect(trouverColonnes([COLONNE_CODE, COLONNE_NUMERO, 'code agent']).erreur)
      .toMatch(/2 fois|Ambigu/)
  })

  it('[TC-250-17] refuse un fichier sans en-tête', () => {
    expect(trouverColonnes([]).erreur).toMatch(/Code agent/)
  })
})

describe('TC-250 — retrouver la fiche par son code', () => {
  /** Le code d'une fiche héritée vient de `orange`, lu comme à l'écran. */
  it('[TC-250-18] indexe aussi les fiches d’avant la séparation', () => {
    const index = indexerParCodeAgent([
      fiche({ id: 'neuve', codeAgent: '0123456', numeroAgent: '' }),
      fiche({ id: 'heritee', orange: '7654321' }),
    ])

    expect(index.get('0123456').map((f) => f.id)).toEqual(['neuve'])
    expect(index.get('7654321').map((f) => f.id)).toEqual(['heritee'])
  })

  /**
   * Une valeur héritée de huit chiffres est un NUMÉRO, pas un code : la fiche
   * n'est donc pas trouvable par code — et c'est juste, elle a déjà un numéro.
   */
  it('[TC-250-19] ne range pas un `orange` de huit chiffres comme un code', () => {
    const index = indexerParCodeAgent([fiche({ id: 'h', orange: '01234567' })])
    expect(index.size).toBe(0)
  })

  it('[TC-250-20] ne rapproche jamais par le nom', () => {
    const { lignes } = planifierImport(
      [ligne('9999999', '01234567')],
      [fiche({ id: 'f1', nom: 'OUEDRAOGO', prenom: 'SALIF', orange: '1111111' })],
    )
    expect(lignes[0].statut).toBe(STATUTS.INTROUVABLE)
  })
})

describe('TC-250 — ce que chaque ligne devient', () => {
  const vide = fiche({ id: 'cible', codeAgent: '0123456', numeroAgent: '' })

  it('[TC-250-21] complète un numéro agent vide', () => {
    const { lignes, bilan } = planifierImport([ligne('0123456', '01234567')], [vide])

    expect(lignes[0]).toMatchObject({
      statut: STATUTS.A_COMPLETER,
      code: '0123456',
      nom: 'OUEDRAOGO SALIF',
      actuel: '',
      propose: '01234567',
    })
    expect(bilan.misAJour).toBe(1)
  })

  /** Rule 5, premier cas : le même numéro est déjà là. */
  it('[TC-250-22] ne change rien si le numéro est déjà identique', () => {
    const { lignes, bilan, ecritures } = planifierImport(
      [ligne('0123456', '01234567')],
      [fiche({ id: 'cible', codeAgent: '0123456', numeroAgent: '01234567' })],
    )

    expect(lignes[0].statut).toBe(STATUTS.INCHANGE)
    expect(bilan.inchanges).toBe(1)
    expect(ecritures).toEqual([])
  })

  /**
   * ⚠ LE PIÈGE N° 4. « Signale un conflit sans l'écraser » : la ligne sort du
   *   plan d'écriture, pas seulement du rapport.
   */
  it('[TC-250-23] signale un conflit et n’écrase pas', () => {
    const { lignes, bilan, ecritures } = planifierImport(
      [ligne('0123456', '01234567')],
      [fiche({ id: 'cible', codeAgent: '0123456', numeroAgent: '09999999' })],
    )

    expect(lignes[0].statut).toBe(STATUTS.CONFLIT)
    expect(lignes[0].detail).toMatch(/09999999/)
    expect(bilan.conflits).toBe(1)
    expect(ecritures).toEqual([])
  })

  /**
   * Un espace résiduel ou un zéro manquant en base n'est pas un conflit : c'est
   * la même valeur écrite autrement. Compter ces lignes comme des conflits
   * enverrait la boutique vérifier des centaines de faux problèmes.
   */
  it('[TC-250-24] une écriture différente du même numéro reste « inchangée »', () => {
    const { lignes } = planifierImport(
      [ligne('0123456', '01234567')],
      [fiche({ id: 'cible', codeAgent: '0123456', numeroAgent: ' 1234567 ' })],
    )

    expect(lignes[0].statut).toBe(STATUTS.INCHANGE)
    expect(lignes[0].detail).toMatch(/déjà présent/)
  })

  it('[TC-250-25] signale un code introuvable sans rien créer', () => {
    const { lignes, bilan, ecritures } = planifierImport([ligne('7777777', '01234567')], [vide])

    expect(lignes[0].statut).toBe(STATUTS.INTROUVABLE)
    expect(bilan.ignores).toBe(1)
    expect(ecritures).toEqual([])
  })

  /**
   * ⚠ LE PIÈGE N° 1, ET LE SEUL MOYEN HONNÊTE DE LE TRAITER. Un code stocké en
   *   NOMBRE par le tableur a perdu son zéro dans le fichier lui-même : rien ne
   *   le récupère. On ne le devine donc pas — on dit que la variante existe.
   *   Le deviner écrirait sur une fiche voisine, sans trace.
   */
  it('[TC-250-26] sur une case TEXTE, signale la variante sans la corriger', () => {
    const { lignes, ecritures } = planifierImport([ligne('123456', '01234567')], [
      fiche({ id: 'cible', codeAgent: '0123456', numeroAgent: '' }),
    ])

    expect(lignes[0].statut).toBe(STATUTS.INTROUVABLE)
    expect(lignes[0].detail).toMatch(/0123456/)
    expect(lignes[0].detail).toMatch(/TEXTE/)
    expect(ecritures).toEqual([])
  })

  it('[TC-250-27] signale un code répété dans le fichier et n’écrit ni l’un ni l’autre', () => {
    const { lignes, bilan, ecritures } = planifierImport(
      [ligne('0123456', '01234567', 2), ligne('0123456', '07654321', 3)],
      [vide],
    )

    expect(lignes.map((l) => l.statut)).toEqual([STATUTS.CODE_REPETE, STATUTS.CODE_REPETE])
    expect(bilan.detailIgnores.codeRepete).toBe(2)
    expect(ecritures).toEqual([])
  })

  /** Même numéro des deux côtés : c'est toujours un fichier mal fabriqué. */
  it('[TC-250-28] un code répété reste signalé même avec le même numéro', () => {
    const { lignes } = planifierImport(
      [ligne('0123456', '01234567', 2), ligne('0123456', '01234567', 3)],
      [vide],
    )
    expect(lignes.every((l) => l.statut === STATUTS.CODE_REPETE)).toBe(true)
  })

  it('[TC-250-29] signale un code porté par plusieurs fiches', () => {
    const { lignes, bilan, ecritures } = planifierImport([ligne('0123456', '01234567')], [
      fiche({ id: 'a', codeAgent: '0123456', numeroAgent: '' }),
      fiche({ id: 'b', codeAgent: '0123456', numeroAgent: '', nom: 'ZIDA', prenom: 'ALI' }),
    ])

    expect(lignes[0].statut).toBe(STATUTS.PLUSIEURS_CLIENTS)
    expect(lignes[0].detail).toMatch(/a, b/)
    expect(bilan.detailIgnores.plusieursClients).toBe(1)
    expect(ecritures).toEqual([])
  })

  it('[TC-250-30] ignore une ligne au code vide', () => {
    const { lignes } = planifierImport([ligne('', '01234567')], [vide])
    expect(lignes[0].statut).toBe(STATUTS.NUMERO_IGNORE)
    expect(lignes[0].detail).toMatch(/code agent vide/)
  })

  /**
   * ⚠ LES QUATRE SEAUX COUVRENT 100 % DES LIGNES. Un bilan dont les parts ne
   *   font pas le tout laisse croire qu'on a tout vu alors qu'une catégorie a été
   *   oubliée en silence.
   */
  it('[TC-250-31] le bilan couvre toutes les lignes, sans trou ni double compte', () => {
    const { bilan } = planifierImport([
      ligne('0123456', '01234567', 2),
      ligne('0000001', '01234567', 3),
      ligne('0000002', '09999999', 4),
      ligne('7777777', '01234567', 5),
      ligne('0000003', 'XX', 6),
    ], [
      fiche({ id: 'a', codeAgent: '0123456', numeroAgent: '' }),
      fiche({ id: 'b', codeAgent: '0000001', numeroAgent: '01234567' }),
      fiche({ id: 'c', codeAgent: '0000002', numeroAgent: '01111111' }),
      fiche({ id: 'd', codeAgent: '0000003', numeroAgent: '' }),
    ])

    expect(bilan.total).toBe(5)
    expect(bilan.misAJour + bilan.inchanges + bilan.conflits + bilan.ignores).toBe(5)
    expect(bilan).toMatchObject({ misAJour: 1, inchanges: 1, conflits: 1, ignores: 2 })
  })
})

describe('TC-250 — ce qui est réellement écrit', () => {
  /**
   * ⚠ LE PIÈGE N° 2, CELUI QUI NE SE VOIT PAS.
   *
   *   `champsAgent` décide qu'une fiche est « rangée » par la PRÉSENCE des clés.
   *   Une fiche héritée n'en a aucune : son code vient de `orange`. Écrire
   *   `numeroAgent` tout seul ferait apparaître une clé, l'application cesserait
   *   de lire `orange`, et LE CODE AGENT DISPARAÎTRAIT DE L'ÉCRAN. Sur 15 000
   *   fiches, un import censé ajouter une information en aurait effacé une autre.
   */
  it('[TC-250-32] écrit le code en même temps que le numéro sur une fiche héritée', () => {
    const { ecritures } = planifierImport([ligne('7654321', '01234567')], [
      fiche({ id: 'heritee', orange: '7654321' }),
    ])

    expect(ecritures).toHaveLength(1)
    expect(ecritures[0].maj).toEqual({ codeAgent: '7654321', numeroAgent: '01234567' })
  })

  /** La preuve par l'écran : après la mise à jour, le code se lit toujours. */
  it('[TC-250-33] le code agent reste lisible après la mise à jour', () => {
    const heritee = fiche({ id: 'heritee', orange: '7654321' })
    const { ecritures } = planifierImport([ligne('7654321', '01234567')], [heritee])

    const apres = { ...heritee, ...ecritures[0].maj }
    expect(champsAgent(apres)).toEqual({ codeAgent: '7654321', numeroAgent: '01234567' })
  })

  /** La contre-épreuve : écrire le seul numéro effacerait le code de l'écran. */
  it('[TC-250-34] écrire le numéro SEUL aurait fait disparaître le code', () => {
    const heritee = fiche({ id: 'heritee', orange: '7654321' })
    const naif = { ...heritee, numeroAgent: '01234567' }

    expect(champsAgent(naif).codeAgent).toBe('')
  })

  it('[TC-250-35] ne touche ni le numéro personnel ni l’ancien `orange`', () => {
    const { ecritures } = planifierImport([ligne('7654321', '01234567')], [
      fiche({ id: 'heritee', orange: '7654321', numeroPersonnel: '70112233' }),
    ])

    expect(Object.keys(ecritures[0].maj).sort()).toEqual(['codeAgent', 'numeroAgent'])
  })

  /**
   * ⚠ L'ÉTAT D'AVANT NOTE LA PRÉSENCE DES CLÉS, pas seulement leur valeur.
   *   Annuler en remettant `codeAgent: ''` au lieu de SUPPRIMER la clé laisserait
   *   la fiche en mode « rangée puis vidée exprès » : son `orange` ne serait plus
   *   lu. L'annulation aurait causé le dégât qu'elle venait réparer.
   */
  it('[TC-250-36] retient si les clés existaient, pour une annulation fidèle', () => {
    const [heritee] = ecrituresDe(planifierImport([ligne('7654321', '01234567')], [
      fiche({ id: 'h', orange: '7654321' }),
    ]).lignes)
    expect(heritee.avant).toEqual({
      codeAgentPresent: false, numeroAgentPresent: false, codeAgent: null, numeroAgent: null,
    })

    const [rangee] = ecrituresDe(planifierImport([ligne('0123456', '01234567')], [
      fiche({ id: 'r', codeAgent: '0123456', numeroAgent: '' }),
    ]).lignes)
    expect(rangee.avant).toEqual({
      codeAgentPresent: true, numeroAgentPresent: true, codeAgent: '0123456', numeroAgent: '',
    })
  })

  it('[TC-250-37] porte la boutique de la fiche, pour le journal d’audit', () => {
    const { ecritures } = planifierImport([ligne('0123456', '01234567')], [
      fiche({ id: 'cible', codeAgent: '0123456', numeroAgent: '', registeredStoreId: 'store-Z' }),
    ])
    expect(ecritures[0].storeId).toBe('store-Z')
  })
})

/**
 * ⚠ L'IDEMPOTENCE EST UNE EXIGENCE, PAS UNE CONSÉQUENCE HEUREUSE. « Un second
 *   import du même fichier ne doit provoquer aucun changement supplémentaire. »
 *   On le vérifie en appliquant le plan, puis en replanifiant sur le résultat.
 */
describe('TC-250 — un second import ne change plus rien', () => {
  const appliquer = (fiches, ecritures) => {
    const parId = new Map(ecritures.map((e) => [e.id, e.maj]))
    return fiches.map((f) => (parId.has(f.id) ? { ...f, ...parId.get(f.id) } : f))
  }

  it('[TC-250-38] le second passage ne rend que des « inchangées »', () => {
    const lignesFichier = [
      ligne('0123456', '01234567', 2),
      ligne('7654321', '1234567', 3),
    ]
    const base = [
      fiche({ id: 'a', codeAgent: '0123456', numeroAgent: '' }),
      fiche({ id: 'b', orange: '7654321' }),
    ]

    const premier = planifierImport(lignesFichier, base)
    expect(premier.bilan).toMatchObject({ misAJour: 2, inchanges: 0, conflits: 0, ignores: 0 })

    const second = planifierImport(lignesFichier, appliquer(base, premier.ecritures))
    expect(second.bilan).toMatchObject({ misAJour: 0, inchanges: 2, conflits: 0, ignores: 0 })
    expect(second.ecritures).toEqual([])
  })

  /** Et un troisième passage ne doit pas inventer de conflit. */
  it('[TC-250-39] un troisième passage reste identique au second', () => {
    const lignesFichier = [ligne('7654321', '1234567')]
    const base = [fiche({ id: 'b', orange: '7654321' })]

    const un = planifierImport(lignesFichier, base)
    const apresUn = appliquer(base, un.ecritures)
    const deux = planifierImport(lignesFichier, apresUn)
    const trois = planifierImport(lignesFichier, appliquer(apresUn, deux.ecritures))

    expect(trois.bilan).toEqual(deux.bilan)
    expect(trois.bilan.conflits).toBe(0)
  })
})

describe('TC-250 — lire le fichier sans perdre un zéro', () => {
  it('[TC-250-40] détecte le point-virgule des exports de ce dépôt', () => {
    expect(detecterSeparateur('Code agent;Numéro agent')).toBe(';')
    expect(detecterSeparateur('Code agent,Numéro agent')).toBe(',')
    expect(detecterSeparateur('Code agent\tNuméro agent')).toBe('\t')
  })

  /** Une virgule DANS un nom ne doit pas faire élire la virgule. */
  it('[TC-250-41] ne se laisse pas tromper par une virgule entre guillemets', () => {
    expect(detecterSeparateur('Code agent;"OUEDRAOGO, SALIF";Numéro agent')).toBe(';')
  })

  /**
   * ⚠ C'EST LA RAISON D'ÊTRE DE CET ANALYSEUR. `xlsx` lit un CSV en
   *   INTERPRÉTANT : « 0123456 » y devient le nombre 123456. Le CSV, lui,
   *   contient bien le zéro.
   */
  it('[TC-250-42] garde les zéros initiaux du CSV', () => {
    const { lignes } = analyserCsv('Code agent;Numéro agent\r\n0123456;01234567\r\n')
    expect(lignes[0]).toEqual({ 'Code agent': '0123456', 'Numéro agent': '01234567' })
  })

  it('[TC-250-43] avale le BOM d’Excel', () => {
    const { entetes } = analyserCsv('﻿Code agent;Numéro agent\r\n0123456;01234567')
    expect(entetes).toEqual(['Code agent', 'Numéro agent'])
  })

  it('[TC-250-44] gère les guillemets, le séparateur dedans et le doublement', () => {
    const { lignes } = analyserCsv('a;b\r\n"x;y";"il a dit ""oui"""')
    expect(lignes[0]).toEqual({ a: 'x;y', b: 'il a dit "oui"' })
  })

  it('[TC-250-45] gère un saut de ligne dans une cellule entre guillemets', () => {
    const { lignes } = analyserCsv('a;b\n"deux\nlignes";2')
    expect(lignes).toHaveLength(1)
    expect(lignes[0].a).toBe('deux\nlignes')
  })

  /** Les tableurs laissent des rangées vides en fin de fichier. */
  it('[TC-250-46] ignore les rangées entièrement vides', () => {
    const { lignes } = analyserCsv('Code agent;Numéro agent\n0123456;01234567\n\n;\n')
    expect(lignes).toHaveLength(1)
  })

  it('[TC-250-47] rend vide un fichier vide', () => {
    expect(analyserCsv('')).toEqual({ entetes: [], lignes: [], numeriques: [] })
    expect(analyserCsv('   \n  ')).toEqual({ entetes: [], lignes: [], numeriques: [] })
  })

  /** Une ligne plus courte que l'en-tête ne doit pas rendre `undefined`. */
  it('[TC-250-48] remplit les colonnes manquantes par du vide', () => {
    const { lignes } = analyserCsv('a;b;c\n1;2')
    expect(lignes[0]).toEqual({ a: '1', b: '2', c: '' })
  })

  it('[TC-250-49] la dernière ligne sans saut de ligne final est lue', () => {
    const { lignes } = analyserCsv('Code agent;Numéro agent\n0123456;01234567')
    expect(lignes).toHaveLength(1)
  })
})

describe('TC-250 — les cas vides', () => {
  it('[TC-250-50] un fichier sans ligne ne planifie rien', () => {
    expect(planifierImport([], [fiche()])).toMatchObject({
      lignes: [], ecritures: [], bilan: { total: 0, misAJour: 0 },
    })
  })

  it('[TC-250-51] une base vide rend tout introuvable', () => {
    const { lignes, bilan } = planifierImport([ligne('0123456', '01234567')], [])
    expect(lignes[0].statut).toBe(STATUTS.INTROUVABLE)
    expect(bilan.ignores).toBe(1)
  })

  it('[TC-250-52] compterBilan sur rien rend des zéros cohérents', () => {
    const bilan = compterBilan([])
    expect(bilan.total).toBe(0)
    expect(bilan.misAJour + bilan.inchanges + bilan.conflits + bilan.ignores).toBe(0)
  })
})

/**
 * TC-250 — EXCEL, ET LE ZÉRO QU'IL MANGE.
 *
 * C'est le format de travail de la boutique, donc ce n'est pas un cas secondaire.
 * Une cellule Excel porte trois informations, et il faut les trois :
 *
 *   t  le type      — « s » texte, « n » nombre
 *   v  la valeur    — ce qu'Excel a stocké
 *   w  l'affichage  — la valeur passée par le format de la cellule
 *
 * Se fier à `w` casse les formats scientifique et milliers ; se fier à `v` jette
 * le zéro qu'un format « 0000000 » avait conservé.
 */
describe('TC-250 — ce qu’une cellule Excel garde vraiment', () => {
  /** Le cas qui sauve le zéro sans rien deviner : le format le porte. */
  it('[TC-250-53] récupère le zéro d’un format « 0000000 »', () => {
    expect(valeurCellule({ t: 'n', v: 123456, w: '0123456', z: '0000000' }))
      .toEqual({ texte: '0123456', numerique: true })
  })

  /** Format Général : le zéro est perdu dans le fichier, mais on le SAIT. */
  it('[TC-250-54] marque la case comme numérique quand le zéro est perdu', () => {
    expect(valeurCellule({ t: 'n', v: 123456, w: '123456', z: 'General' }))
      .toEqual({ texte: '123456', numerique: true })
  })

  /**
   * ⚠ `w` EST UN PIÈGE SUR CES DEUX FORMATS. « 1,234,567 » casserait la
   *   correspondance exacte du code, et « 1.23E+05 » ne ressemble à rien.
   */
  it('[TC-250-55] écarte un `w` à séparateur de milliers ou scientifique', () => {
    expect(valeurCellule({ t: 'n', v: 1234567, w: '1,234,567' }).texte).toBe('1234567')
    expect(valeurCellule({ t: 'n', v: 123456, w: '1.23E+05' }).texte).toBe('123456')
  })

  /** Une case texte est rendue telle quelle, et jamais marquée numérique. */
  it('[TC-250-56] rend une case texte intacte', () => {
    expect(valeurCellule({ t: 's', v: '0123456', w: '0123456' }))
      .toEqual({ texte: '0123456', numerique: false })
  })

  /**
   * ⚠ UNE DATE N'EST PAS UN CODE. Excel transforme volontiers une saisie en date ;
   *   la rendre telle quelle la fait échouer au contrôle numérique et SIGNALER,
   *   au lieu d'être réinterprétée en silence.
   */
  it('[TC-250-57] ne rattrape jamais une cellule date', () => {
    const cellule = valeurCellule({ t: 'd', v: new Date('2026-01-23'), w: '23/01/2026' })
    expect(cellule.numerique).toBe(false)
    expect(normaliserNumeroAgent(cellule.texte, cellule.numerique).refus).toBe('date')
  })

  it('[TC-250-58] une case absente est vide, et non « undefined »', () => {
    expect(valeurCellule(undefined)).toEqual({ texte: '', numerique: false })
    expect(valeurCellule(null)).toEqual({ texte: '', numerique: false })
  })
})

describe('TC-250 — restituer le zéro depuis la base, jamais le deviner', () => {
  const index = (codes) => indexerParCodeAgent(
    codes.map((c, i) => fiche({ id: `f${i}`, codeAgent: c, numeroAgent: '' })),
  )

  it('[TC-250-59] les longueurs de code viennent de la base, pas d’une hypothèse', () => {
    expect(longueursDeCode(index(['0123456', '12', '0012345678']))).toEqual([2, 7, 10])
  })

  /** Le code exact gagne toujours : aucun remplissage ne s'applique. */
  it('[TC-250-60] une correspondance exacte n’est jamais complétée', () => {
    expect(resoudreCode('123456', index(['123456', '0123456'])))
      .toEqual({ code: '123456', zerosRestitues: 0 })
  })

  /** Une seule variante en base : ce n'est plus une devinette, c'est une lecture. */
  it('[TC-250-61] restitue le zéro quand la variante est UNIQUE', () => {
    expect(resoudreCode('123456', index(['0123456'])))
      .toEqual({ code: '0123456', zerosRestitues: 1 })
  })

  it('[TC-250-62] restitue plusieurs zéros si la base l’exige', () => {
    expect(resoudreCode('123', index(['0000123'])))
      .toEqual({ code: '0000123', zerosRestitues: 4 })
  })

  /**
   * ⚠ LA LIMITE DE L'HONNÊTETÉ. Si « 0123456 » ET « 00123456 » existent, choisir
   *   serait tirer au sort sur la fiche d'un commerce. On s'arrête et on nomme
   *   les deux.
   */
  it('[TC-250-63] refuse de choisir entre deux variantes', () => {
    const r = resoudreCode('123456', index(['0123456', '00123456']))
    expect(r.ambigu).toEqual(['0123456', '00123456'])
    expect(r.code).toBeUndefined()
  })

  it('[TC-250-64] rend introuvable quand aucune variante n’existe', () => {
    expect(resoudreCode('999999', index(['0123456']))).toEqual({ introuvable: true })
  })
})

describe('TC-250 — l’import d’un fichier Excel abîmé', () => {
  const numerique = (code, numero, n = 2) => ({
    ligne: n, code, numero, codeNumerique: true, numeroNumerique: true,
  })

  /** Le cas réel : la colonne était en Général, les zéros ont sauté. */
  it('[TC-250-65] complète la bonne fiche après restitution du zéro', () => {
    const { lignes, ecritures, bilan } = planifierImport([numerique('123456', '1234567')], [
      fiche({ id: 'cible', codeAgent: '0123456', numeroAgent: '' }),
    ])

    expect(lignes[0].statut).toBe(STATUTS.A_COMPLETER)
    expect(lignes[0].codeUtilise).toBe('0123456')
    expect(lignes[0].detail).toMatch(/restitué/)
    expect(ecritures[0].id).toBe('cible')
    expect(bilan.zerosRestitues).toEqual({ codes: 1, numeros: 1 })
  })

  /**
   * ⚠ LE CODE ÉCRIT VIENT DE LA FICHE, JAMAIS DU FICHIER. Recopier le code du
   *   fichier ferait entrer dans la fiche la version tronquée par le tableur.
   */
  it('[TC-250-66] écrit le code de la BASE, pas celui du fichier', () => {
    const { ecritures } = planifierImport([numerique('123456', '1234567')], [
      fiche({ id: 'cible', codeAgent: '0123456', numeroAgent: '' }),
    ])
    expect(ecritures[0].maj.codeAgent).toBe('0123456')
  })

  /** Un numéro de six chiffres dans une case NOMBRE se complète jusqu'à huit. */
  it('[TC-250-67] complète un numéro numérique jusqu’à huit chiffres', () => {
    expect(normaliserNumeroAgent('234567', true)).toEqual({ numero: '00234567', zerosRestitues: 2 })
    expect(normaliserNumeroAgent('7', true)).toEqual({ numero: '00000007', zerosRestitues: 7 })
  })

  /** Mais une case TEXTE de six chiffres reste refusée : c'est une saisie. */
  it('[TC-250-68] ne complète pas un numéro de six chiffres écrit en TEXTE', () => {
    const refus = normaliserNumeroAgent('234567', false)
    expect(refus.refus).toBe('longueur')
    expect(refus.detail).toMatch(/texte/)
  })

  /** Au-delà de huit chiffres, rien ne justifie un numéro agent. */
  it('[TC-250-69] refuse plus de huit chiffres, même en case NOMBRE', () => {
    expect(normaliserNumeroAgent('123456789', true).refus).toBe('longueur')
  })

  it('[TC-250-70] signale l’ambiguïté sans rien écrire', () => {
    const { lignes, ecritures, bilan } = planifierImport([numerique('123456', '01234567')], [
      fiche({ id: 'a', codeAgent: '0123456', numeroAgent: '' }),
      fiche({ id: 'b', codeAgent: '00123456', numeroAgent: '' }),
    ])

    expect(lignes[0].statut).toBe(STATUTS.ZERO_AMBIGU)
    expect(lignes[0].detail).toMatch(/0123456, 00123456/)
    expect(ecritures).toEqual([])
    expect(bilan.detailIgnores.zeroAmbigu).toBe(1)
  })

  /**
   * ⚠ LE DOUBLON QUE LA RESTITUTION POURRAIT CRÉER. Deux lignes « 123456 » et
   *   « 0123456 » désignent LA MÊME fiche dès que le zéro est restitué. Les
   *   compter sur le code brut laisserait passer deux écritures sur une seule
   *   fiche, dont la seconde écraserait la première.
   */
  it('[TC-250-71] voit la répétition créée par la restitution', () => {
    const { lignes, ecritures } = planifierImport([
      { ligne: 2, code: '123456', numero: '01234567', codeNumerique: true },
      { ligne: 3, code: '0123456', numero: '07654321', codeNumerique: false },
    ], [fiche({ id: 'cible', codeAgent: '0123456', numeroAgent: '' })])

    expect(lignes.map((l) => l.statut)).toEqual([STATUTS.CODE_REPETE, STATUTS.CODE_REPETE])
    expect(ecritures).toEqual([])
  })

  /** L'idempotence doit tenir aussi quand un zéro a été restitué. */
  it('[TC-250-72] un second import du fichier abîmé ne change plus rien', () => {
    const lignesFichier = [numerique('123456', '1234567')]
    const base = [fiche({ id: 'cible', codeAgent: '0123456', numeroAgent: '' })]

    const un = planifierImport(lignesFichier, base)
    const apres = base.map((f) => ({ ...f, ...un.ecritures[0].maj }))
    const deux = planifierImport(lignesFichier, apres)

    expect(deux.bilan).toMatchObject({ misAJour: 0, inchanges: 1, conflits: 0, ignores: 0 })
    expect(deux.ecritures).toEqual([])
  })
})
