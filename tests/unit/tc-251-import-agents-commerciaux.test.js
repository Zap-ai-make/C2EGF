import { describe, it, expect } from 'vitest'
import {
  normaliserAgentCommercial,
  indexerCommerciaux,
  alignerSurLaBase,
  trouverColonnes,
  champsPresents,
  planifierImport,
  ecrituresDe,
  STATUTS,
  COLONNE_CODE,
  COLONNE_COMMERCIAL,
  CHAMP_COMMERCIAL,
  CHAMP_NUMERO,
} from '../../scripts/lib/importChampsAgent.mjs'
import { champsAgent } from '../../src/utils/agentFields.js'

/**
 * TC-251 — Compléter l'« Agent commercial » des fiches existantes par import.
 *
 * CE QUE CET IMPORT PEUT CASSER, ET QUI NE SE VERRAIT PAS
 * ──────────────────────────────────────────────────────
 *   1. COUPER UN COMMERCIAL EN DEUX. `calculerCommerciaux` groupe les agents par
 *      la CHAÎNE EXACTE de `agentCommercial`. Écrire « ouedraogo s. » à côté des
 *      fiches qui portent « OUEDRAOGO S. » crée un second commercial dans le
 *      tableau de bord, avec une part du portefeuille de l'autre. Aucune règle de
 *      forme ne s'en plaindrait : les deux chaînes sont des noms valides.
 *   2. FAIRE DISPARAÎTRE LE CODE AGENT DE L'ÉCRAN. Le piège de l'import de
 *      numéros : `champsAgent` tranche par la PRÉSENCE des clés
 *      `codeAgent`/`numeroAgent`. Si cet import-ci les écrivait « au passage »,
 *      une fiche héritée cesserait de lire `orange`.
 *   3. ÉCRIRE SUR LA MAUVAISE FICHE, par un zéro de tête perdu dans le code.
 *   4. ÉCRASER UN COMMERCIAL EXISTANT. Jamais : conflit, pas remplacement.
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

const ligne = (code, valeur, n = 2) => ({ ligne: n, code, valeur })

const planifier = (lignes, fiches) => planifierImport(lignes, fiches, CHAMP_COMMERCIAL)

// ─────────────────────────────────────────────────────────────────────────────

describe('TC-251 — le nom du commercial, normalisé', () => {
  it('[TC-251-01] garde un nom tel quel', () => {
    expect(normaliserAgentCommercial('OUEDRAOGO S.')).toMatchObject({ valeur: 'OUEDRAOGO S.' })
  })

  it('[TC-251-02] rogne les espaces autour et resserre ceux du milieu', () => {
    expect(normaliserAgentCommercial('  KABORE   J.  ')).toMatchObject({ valeur: 'KABORE J.' })
    expect(normaliserAgentCommercial('\tZONGO\nP.')).toMatchObject({ valeur: 'ZONGO P.' })
  })

  it('[TC-251-03] ignore une case vide', () => {
    expect(normaliserAgentCommercial('')).toMatchObject({ refus: 'vide' })
    expect(normaliserAgentCommercial('   ')).toMatchObject({ refus: 'vide' })
    expect(normaliserAgentCommercial(null)).toMatchObject({ refus: 'vide' })
    expect(normaliserAgentCommercial(undefined)).toMatchObject({ refus: 'vide' })
  })

  /**
   * ⚠ AUCUNE LONGUEUR NE VALIDE UN NOM. C'est la différence de fond avec le
   *   numéro agent, et elle doit rester visible : « KONE » est aussi juste que
   *   « OUEDRAOGO W. Jean-Baptiste ».
   */
  it('[TC-251-04] accepte aussi bien un nom court qu’un nom long', () => {
    expect(normaliserAgentCommercial('KONE')).toMatchObject({ valeur: 'KONE' })
    expect(normaliserAgentCommercial('OUEDRAOGO W. Jean-Baptiste'))
      .toMatchObject({ valeur: 'OUEDRAOGO W. Jean-Baptiste' })
  })

  it('[TC-251-05] accepte les accents, le tiret et l’apostrophe', () => {
    expect(normaliserAgentCommercial('SAWADOGO Aïssata')).toMatchObject({ valeur: 'SAWADOGO Aïssata' })
    expect(normaliserAgentCommercial('N’DIAYE Marie-Claire')).toMatchObject({ valeur: 'N’DIAYE Marie-Claire' })
  })

  /**
   * ⚠ LA VIRGULE N'EST PAS UN SÉPARATEUR ICI, contrairement au numéro agent :
   *   « OUEDRAOGO, Salif » est une seule personne écrite « Nom, Prénom ». La
   *   refuser rejetterait en masse des lignes parfaitement justes.
   */
  it('[TC-251-06] accepte la forme « Nom, Prénom »', () => {
    expect(normaliserAgentCommercial('OUEDRAOGO, Salif'))
      .toMatchObject({ valeur: 'OUEDRAOGO, Salif' })
  })

  it('[TC-251-07] refuse deux commerciaux dans la même case', () => {
    for (const deux of ['KONE / OUEDRAOGO', 'KONE;OUEDRAOGO', 'KONE|OUEDRAOGO',
      'KONE et OUEDRAOGO', 'KONE ou OUEDRAOGO']) {
      expect(normaliserAgentCommercial(deux)).toMatchObject({ refus: 'multiple' })
    }
  })

  /** Une case sans la moindre lettre n'est pas un nom : c'est autre chose. */
  it('[TC-251-08] refuse une case sans lettre', () => {
    expect(normaliserAgentCommercial('0')).toMatchObject({ refus: 'sans-lettre' })
    expect(normaliserAgentCommercial('-')).toMatchObject({ refus: 'sans-lettre' })
    expect(normaliserAgentCommercial('70112233')).toMatchObject({ refus: 'sans-lettre' })
  })

  it('[TC-251-09] dit quand la case sans lettre vient d’une cellule NOMBRE', () => {
    expect(normaliserAgentCommercial('70112233', true).detail).toMatch(/NOMBRE/)
  })

  /**
   * ⚠ RECONNUE AVANT « plusieurs commerciaux », sinon le refus parlerait d'une
   *   barre de séparation dans une case qui n'en a jamais eu.
   */
  it('[TC-251-10] refuse une date convertie par le tableur, et le dit', () => {
    const refus = normaliserAgentCommercial('23/01/2026')
    expect(refus.refus).toBe('date')
    expect(refus.detail).toMatch(/TEXTE/)
  })

  /**
   * ⚠ « NÉANT » ÉCRIT EN BASE DEVIENDRAIT UN COMMERCIAL À PART ENTIÈRE dans le
   *   tableau de bord, avec son portefeuille et son volume. Le champ vide est
   *   déjà rendu par « Non attribué » : il n'y a rien à écrire.
   */
  it('[TC-251-11] refuse les façons d’écrire « pas de commercial »', () => {
    for (const rien of ['NÉANT', 'néant', 'aucun', 'RAS', 'non attribué', 'ND', 'xxx', 'SANS']) {
      expect(normaliserAgentCommercial(rien)).toMatchObject({ refus: 'non-renseigne' })
    }
  })

  /**
   * ⚠ « N/A » PORTE UNE BARRE, donc le test « plusieurs commerciaux » le verrait
   *   comme deux noms — le bon refus pour la mauvaise raison, qui enverrait
   *   chercher un second commercial dans une case qui n'en nomme aucun.
   */
  it('[TC-251-11b] reconnaît « N/A » comme « pas de commercial », pas comme deux noms', () => {
    for (const rien of ['N/A', 'n/a', 'N.D.', 'N-A']) {
      expect(normaliserAgentCommercial(rien)).toMatchObject({ refus: 'non-renseigne' })
    }
  })

  it('[TC-251-12] refuse une phrase tombée dans la colonne', () => {
    const phrase = 'commercial parti en congé, voir avec le responsable de la boutique de Pouytenga'
    expect(normaliserAgentCommercial(phrase)).toMatchObject({ refus: 'longueur' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('TC-251 — l’orthographe que la base porte déjà', () => {
  const base = (...noms) => indexerCommerciaux(noms.map((n, i) => fiche({ id: `b${i}`, agentCommercial: n })))

  it('[TC-251-13] compte les orthographes par leur pli', () => {
    const index = indexerCommerciaux([
      fiche({ id: '1', agentCommercial: 'OUEDRAOGO S.' }),
      fiche({ id: '2', agentCommercial: 'OUEDRAOGO S.' }),
      fiche({ id: '3', agentCommercial: 'ouedraogo s.' }),
      fiche({ id: '4', agentCommercial: '' }),
      fiche({ id: '5' }),
    ])
    expect([...index.keys()]).toEqual(['ouedraogo s.'])
    expect(index.get('ouedraogo s.')).toEqual(new Map([['OUEDRAOGO S.', 2], ['ouedraogo s.', 1]]))
  })

  /**
   * ⚠ C'EST L'ANALOGUE DU ZÉRO RESTITUÉ DEPUIS LA BASE : la base est la
   *   référence, pas le fichier. Sans cet alignement, le tableau de bord
   *   afficherait deux commerciaux là où il y en a un.
   */
  it('[TC-251-14] aligne sur l’orthographe qui domine strictement', () => {
    const aligne = alignerSurLaBase('ouedraogo s.', base('OUEDRAOGO S.', 'OUEDRAOGO S.', 'OUEDRAOGO S.'))
    expect(aligne).toMatchObject({ valeur: 'OUEDRAOGO S.', aligne: true, remplace: 'ouedraogo s.' })
  })

  it('[TC-251-15] ne signale aucun alignement quand le fichier écrit déjà comme la base', () => {
    expect(alignerSurLaBase('OUEDRAOGO S.', base('OUEDRAOGO S.', 'OUEDRAOGO S.')))
      .toEqual({ valeur: 'OUEDRAOGO S.', aligne: false })
  })

  /**
   * ⚠ ON NE TRANCHE PAS UN PARTAGE. Choisir entre deux orthographes à égalité
   *   serait tirer au sort le nom affiché sur des centaines de fiches.
   */
  it('[TC-251-16] ne tranche pas quand deux orthographes sont à égalité', () => {
    const partage = alignerSurLaBase('Ouedraogo S.', base('OUEDRAOGO S.', 'ouedraogo s.'))
    expect(partage.aligne).toBe(false)
    expect(partage.valeur).toBe('Ouedraogo S.')
    expect([...partage.concurrentes].sort()).toEqual(['OUEDRAOGO S.', 'ouedraogo s.'])
  })

  it('[TC-251-17] signale un nom que la base ne porte sur aucune fiche', () => {
    expect(alignerSurLaBase('TRAORE B.', base('OUEDRAOGO S.')))
      .toEqual({ valeur: 'TRAORE B.', aligne: false, nouveau: true })
  })

  it('[TC-251-18] un index vide laisse tout nom intact et nouveau', () => {
    expect(alignerSurLaBase('KONE', indexerCommerciaux([]))).toMatchObject({ valeur: 'KONE', nouveau: true })
    expect(alignerSurLaBase('KONE', null)).toMatchObject({ valeur: 'KONE', nouveau: true })
  })

  it('[TC-251-19] l’alignement traverse accents et espaces multiples', () => {
    expect(alignerSurLaBase('sawadogo  aissata', base('SAWADOGO Aïssata', 'SAWADOGO Aïssata')))
      .toMatchObject({ valeur: 'SAWADOGO Aïssata', aligne: true })
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('TC-251 — les colonnes du fichier', () => {
  it('[TC-251-20] trouve les deux colonnes exactes', () => {
    expect(trouverColonnes([COLONNE_CODE, COLONNE_COMMERCIAL], CHAMP_COMMERCIAL))
      .toEqual({ code: COLONNE_CODE, valeur: COLONNE_COMMERCIAL })
  })

  it('[TC-251-21] accepte les styles d’écriture d’un en-tête', () => {
    for (const entete of ['agentCommercial', 'agent_commercial', 'AGENT COMMERCIAL',
      'Agent-Commercial', 'Agent commercial (nom)']) {
      expect(trouverColonnes([COLONNE_CODE, entete], CHAMP_COMMERCIAL).erreur).toBeUndefined()
    }
  })

  it('[TC-251-22] refuse un en-tête voisin qui n’est pas celui-là', () => {
    expect(trouverColonnes([COLONNE_CODE, 'Ancien agent commercial'], CHAMP_COMMERCIAL).erreur)
      .toMatch(/Agent commercial/)
    expect(trouverColonnes([COLONNE_CODE, 'Commercial'], CHAMP_COMMERCIAL).erreur)
      .toMatch(/Agent commercial/)
  })

  it('[TC-251-23] refuse la colonne en double', () => {
    expect(trouverColonnes([COLONNE_CODE, 'Agent commercial', 'agentCommercial'], CHAMP_COMMERCIAL).erreur)
      .toMatch(/2 fois|Ambigu/)
  })

  it('[TC-251-24] refuse un fichier sans la colonne de code', () => {
    expect(trouverColonnes([COLONNE_COMMERCIAL], CHAMP_COMMERCIAL).erreur).toMatch(/Code agent/)
  })

  /**
   * ⚠ UN FICHIER JUSTE DONNÉ AU MAUVAIS SCRIPT. Sans cette reconnaissance, le
   *   refus dit « colonne absente » et envoie chercher une faute d'orthographe
   *   dans un en-tête correct — exactement le « ça refuse » du 2026-10-12.
   */
  it('[TC-251-25] reconnaît qu’un fichier relève de l’autre import', () => {
    expect(champsPresents([COLONNE_CODE, 'Numéro agent'], [CHAMP_NUMERO, CHAMP_COMMERCIAL]))
      .toEqual([CHAMP_NUMERO])
    expect(champsPresents([COLONNE_CODE, 'agentCommercial'], [CHAMP_NUMERO, CHAMP_COMMERCIAL]))
      .toEqual([CHAMP_COMMERCIAL])
    expect(champsPresents([COLONNE_CODE, 'Localité'], [CHAMP_NUMERO, CHAMP_COMMERCIAL])).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('TC-251 — ce que chaque ligne devient', () => {
  const cible = (over = {}) => fiche({ id: 'cible', codeAgent: '0123456', numeroAgent: '', ...over })

  it('[TC-251-26] complète un agent commercial vide', () => {
    const { lignes, bilan, ecritures } = planifier(
      [ligne('0123456', 'KABORE J.')],
      [cible({ agentCommercial: '' })],
    )
    expect(lignes[0]).toMatchObject({
      statut: STATUTS.A_COMPLETER, nom: 'OUEDRAOGO SALIF', actuel: '', propose: 'KABORE J.',
    })
    expect(bilan.misAJour).toBe(1)
    expect(ecritures).toEqual([expect.objectContaining({ id: 'cible', maj: { agentCommercial: 'KABORE J.' } })])
  })

  it('[TC-251-27] complète aussi une fiche qui n’a jamais eu le champ', () => {
    const { lignes, ecritures } = planifier([ligne('0123456', 'KABORE J.')], [cible()])
    expect(lignes[0].statut).toBe(STATUTS.A_COMPLETER)
    expect(ecritures[0].maj).toEqual({ agentCommercial: 'KABORE J.' })
  })

  it('[TC-251-28] ne change rien si le même nom est déjà en place', () => {
    const { lignes, bilan, ecritures } = planifier(
      [ligne('0123456', 'KABORE J.')],
      [cible({ agentCommercial: 'KABORE J.' })],
    )
    expect(lignes[0].statut).toBe(STATUTS.INCHANGE)
    expect(bilan.inchanges).toBe(1)
    expect(ecritures).toEqual([])
  })

  /**
   * ⚠ UNE DIFFÉRENCE DE CASSE N'EST PAS UN CONFLIT. Les opposer ferait des
   *   centaines de faux problèmes à trancher à la main.
   */
  it('[TC-251-29] une autre écriture du même nom reste « inchangée »', () => {
    const { lignes, ecritures } = planifier(
      [ligne('0123456', 'kabore  j.')],
      [cible({ agentCommercial: 'KABORE J.' })],
    )
    expect(lignes[0].statut).toBe(STATUTS.INCHANGE)
    expect(ecritures).toEqual([])
  })

  it('[TC-251-30] signale un conflit et n’écrase pas', () => {
    const { lignes, bilan, ecritures } = planifier(
      [ligne('0123456', 'KABORE J.')],
      [cible({ agentCommercial: 'ZONGO P.' })],
    )
    expect(lignes[0].statut).toBe(STATUTS.CONFLIT)
    expect(lignes[0].detail).toMatch(/ZONGO P\./)
    expect(lignes[0].detail).toMatch(/KABORE J\./)
    expect(bilan.conflits).toBe(1)
    expect(ecritures).toEqual([])
  })

  it('[TC-251-31] ignore une valeur invalide sans jamais effacer', () => {
    const { lignes, ecritures } = planifier(
      [ligne('0123456', 'NÉANT')],
      [cible({ agentCommercial: 'ZONGO P.' })],
    )
    expect(lignes[0].statut).toBe(STATUTS.NUMERO_IGNORE)
    expect(ecritures).toEqual([])
  })

  it('[TC-251-32] signale un code introuvable sans rien créer', () => {
    const { lignes, bilan, ecritures } = planifier([ligne('9999999', 'KABORE J.')], [cible()])
    expect(lignes[0].statut).toBe(STATUTS.INTROUVABLE)
    expect(bilan.detailIgnores.introuvable).toBe(1)
    expect(ecritures).toEqual([])
  })

  /** Le code reste la seule clé : le nom du client ne rapproche jamais. */
  it('[TC-251-33] ne rapproche jamais par le nom du client', () => {
    const { lignes } = planifier([ligne('0000001', 'KABORE J.')], [
      cible({ nom: 'OUEDRAOGO', prenom: 'SALIF' }),
    ])
    expect(lignes[0].statut).toBe(STATUTS.INTROUVABLE)
  })

  it('[TC-251-34] signale un code répété dans le fichier et n’écrit ni l’un ni l’autre', () => {
    const { lignes, ecritures } = planifier(
      [ligne('0123456', 'KABORE J.', 2), ligne('0123456', 'ZONGO P.', 3)],
      [cible()],
    )
    expect(lignes.map((l) => l.statut)).toEqual([STATUTS.CODE_REPETE, STATUTS.CODE_REPETE])
    expect(ecritures).toEqual([])
  })

  it('[TC-251-35] signale un code porté par plusieurs fiches', () => {
    const { lignes, ecritures } = planifier([ligne('0123456', 'KABORE J.')], [
      fiche({ id: 'a', codeAgent: '0123456' }),
      fiche({ id: 'b', codeAgent: '0123456' }),
    ])
    expect(lignes[0].statut).toBe(STATUTS.PLUSIEURS_CLIENTS)
    expect(ecritures).toEqual([])
  })

  it('[TC-251-36] ignore une ligne au code vide', () => {
    const { lignes, ecritures } = planifier([ligne('', 'KABORE J.')], [cible()])
    expect(lignes[0].statut).toBe(STATUTS.NUMERO_IGNORE)
    expect(ecritures).toEqual([])
  })

  /** ⚠ Le zéro mangé par le tableur se rattrape ici comme pour les numéros. */
  it('[TC-251-37] retrouve la fiche malgré un zéro de tête mangé par Excel', () => {
    const { lignes, ecritures } = planifier(
      [{ ligne: 2, code: '123456', valeur: 'KABORE J.', codeNumerique: true }],
      [cible()],
    )
    expect(lignes[0].statut).toBe(STATUTS.A_COMPLETER)
    expect(lignes[0].codeUtilise).toBe('0123456')
    expect(lignes[0].detail).toMatch(/restitué/)
    expect(ecritures[0].id).toBe('cible')
  })

  it('[TC-251-38] le bilan couvre toutes les lignes, sans trou ni double compte', () => {
    const { bilan } = planifier([
      ligne('0123456', 'KABORE J.', 2),
      ligne('0000001', 'ZONGO P.', 3),
      ligne('0000002', '', 4),
      ligne('0000003', 'TAPSOBA M.', 5),
    ], [
      cible(),
      fiche({ id: 'b', codeAgent: '0000002' }),
      fiche({ id: 'c', codeAgent: '0000003', agentCommercial: 'SAWADOGO A.' }),
    ])
    expect(bilan.total).toBe(4)
    expect(bilan.misAJour + bilan.inchanges + bilan.conflits + bilan.ignores).toBe(bilan.total)
  })

  /** Les ajustements sont comptés : la boutique doit les avoir vus. */
  it('[TC-251-39] compte les orthographes alignées sur la base', () => {
    const { lignes, bilan } = planifier([ligne('0123456', 'kabore j.')], [
      cible(),
      fiche({ id: 'x', codeAgent: '0000009', agentCommercial: 'KABORE J.' }),
      fiche({ id: 'y', codeAgent: '0000010', agentCommercial: 'KABORE J.' }),
    ])
    expect(lignes[0].propose).toBe('KABORE J.')
    expect(lignes[0].ajuste).toBe(true)
    expect(lignes[0].detail).toMatch(/alignée/)
    expect(bilan.ajustements.valeurs).toBe(1)
  })

  it('[TC-251-40] marque les noms que la base ne porte sur aucune fiche', () => {
    const { lignes } = planifier([ligne('0123456', 'TRAORE B.')], [
      cible(),
      fiche({ id: 'x', codeAgent: '0000009', agentCommercial: 'KABORE J.' }),
    ])
    expect(lignes[0].nouveau).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('TC-251 — ce qui est réellement écrit', () => {
  const heritee = () => fiche({ id: 'h', orange: '7654321' })

  it('[TC-251-41] n’écrit QUE l’agent commercial', () => {
    const { ecritures } = planifier([ligne('7654321', 'KABORE J.')], [heritee()])
    expect(Object.keys(ecritures[0].maj)).toEqual(['agentCommercial'])
  })

  /**
   * ⚠ LE PIÈGE DE L'IMPORT DE NUMÉROS, VÉRIFIÉ ICI AUSSI. `champsAgent` tranche
   *   par la PRÉSENCE des clés `codeAgent`/`numeroAgent`. Si cet import les
   *   écrivait « pour ranger la fiche au passage », une fiche héritée cesserait
   *   de lire `orange` — et son code agent disparaîtrait de l'écran.
   */
  it('[TC-251-42] le code agent d’une fiche héritée reste lisible après la mise à jour', () => {
    const avant = heritee()
    expect(champsAgent(avant).codeAgent).toBe('7654321')

    const { ecritures } = planifier([ligne('7654321', 'KABORE J.')], [avant])
    const apres = { ...avant, ...ecritures[0].maj }

    expect(champsAgent(apres).codeAgent).toBe('7654321')
    expect(apres.orange).toBe('7654321')
    expect('codeAgent' in apres).toBe(false)
    expect('numeroAgent' in apres).toBe(false)
  })

  it('[TC-251-43] ne touche ni le numéro personnel, ni le numéro agent, ni `orange`', () => {
    const avant = fiche({ id: 'c', codeAgent: '0123456', numeroAgent: '01234567', orange: 'vieux', numeroPersonnel: '70112233' })
    const { ecritures } = planifier([ligne('0123456', 'KABORE J.')], [avant])
    const apres = { ...avant, ...ecritures[0].maj }

    expect(apres.numeroPersonnel).toBe('70112233')
    expect(apres.numeroAgent).toBe('01234567')
    expect(apres.codeAgent).toBe('0123456')
    expect(apres.orange).toBe('vieux')
    expect(apres.agentCommercial).toBe('KABORE J.')
  })

  /**
   * ⚠ L'ÉTAT D'AVANT NOTE LA PRÉSENCE DE LA CLÉ, pas seulement sa valeur :
   *   l'annulation doit pouvoir restituer l'ABSENCE du champ.
   */
  it('[TC-251-44] retient si la clé existait, pour une annulation fidèle', () => {
    const [sans] = ecrituresDe(planifier([ligne('7654321', 'KABORE J.')], [heritee()]).lignes, CHAMP_COMMERCIAL)
    expect(sans.avant).toEqual({ champs: { agentCommercial: { present: false, valeur: null } } })

    const [avec] = ecrituresDe(planifier([ligne('0123456', 'KABORE J.')], [
      fiche({ id: 'r', codeAgent: '0123456', agentCommercial: '' }),
    ]).lignes, CHAMP_COMMERCIAL)
    expect(avec.avant).toEqual({ champs: { agentCommercial: { present: true, valeur: '' } } })
  })

  it('[TC-251-45] porte la boutique de la fiche, pour le journal d’audit', () => {
    const { ecritures } = planifier([ligne('0123456', 'KABORE J.')], [
      fiche({ id: 'cible', codeAgent: '0123456', registeredStoreId: 'store-Z' }),
    ])
    expect(ecritures[0].storeId).toBe('store-Z')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('TC-251 — un second import ne change plus rien', () => {
  const appliquer = (fiches, ecritures) => {
    const parId = new Map(ecritures.map((e) => [e.id, e.maj]))
    return fiches.map((f) => (parId.has(f.id) ? { ...f, ...parId.get(f.id) } : f))
  }

  const lot = [ligne('0123456', 'KABORE J.', 2), ligne('0000002', 'ZONGO P.', 3)]
  const depart = () => [
    fiche({ id: 'a', codeAgent: '0123456' }),
    fiche({ id: 'b', codeAgent: '0000002', agentCommercial: '' }),
  ]

  it('[TC-251-46] le second passage ne rend que des « inchangées »', () => {
    const premier = planifier(lot, depart())
    expect(premier.bilan.misAJour).toBe(2)

    const apres = appliquer(depart(), premier.ecritures)
    const second = planifier(lot, apres)

    expect(second.bilan.misAJour).toBe(0)
    expect(second.bilan.inchanges).toBe(2)
    expect(second.bilan.conflits).toBe(0)
    expect(second.ecritures).toEqual([])
  })

  it('[TC-251-47] un troisième passage reste identique au second', () => {
    let fiches = depart()
    fiches = appliquer(fiches, planifier(lot, fiches).ecritures)
    fiches = appliquer(fiches, planifier(lot, fiches).ecritures)
    const troisieme = planifier(lot, fiches)

    expect(troisieme.ecritures).toEqual([])
    expect(troisieme.bilan.inchanges).toBe(2)
  })

  /**
   * ⚠ L'IMPORT DE NUMÉROS PASSÉ AVANT NE DOIT RIEN CHANGER ICI, et réciproquement :
   *   les deux remplissent des cases différentes de la même fiche.
   */
  it('[TC-251-48] s’applique à une fiche déjà complétée par l’import de numéros', () => {
    const deja = fiche({ id: 'a', codeAgent: '0123456', numeroAgent: '01234567' })
    const { lignes, ecritures } = planifier([ligne('0123456', 'KABORE J.')], [deja])

    expect(lignes[0].statut).toBe(STATUTS.A_COMPLETER)
    expect(ecritures[0].maj).toEqual({ agentCommercial: 'KABORE J.' })
    expect({ ...deja, ...ecritures[0].maj }.numeroAgent).toBe('01234567')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('TC-251 — plusieurs lots réunis', () => {
  it('[TC-251-49] voit un code répété d’un fichier à l’autre', () => {
    const { lignes, ecritures } = planifier([
      { fichier: 'lot1.xlsx', ligne: 2, code: '0123456', valeur: 'KABORE J.' },
      { fichier: 'lot2.xlsx', ligne: 2, code: '0123456', valeur: 'ZONGO P.' },
    ], [fiche({ id: 'cible', codeAgent: '0123456' })])

    expect(lignes.map((l) => l.statut)).toEqual([STATUTS.CODE_REPETE, STATUTS.CODE_REPETE])
    expect(ecritures).toEqual([])
  })

  it('[TC-251-50] nomme le fichier d’origine de chaque ligne', () => {
    const { lignes } = planifier([
      { fichier: 'lot1.xlsx', ligne: 2, code: '0000111', valeur: 'KABORE J.' },
      { fichier: 'lot2.xlsx', ligne: 7, code: '0000222', valeur: 'ZONGO P.' },
    ], [
      fiche({ id: 'a', codeAgent: '0000111' }),
      fiche({ id: 'b', codeAgent: '0000222' }),
    ])

    expect(lignes.map((l) => `${l.fichier}:${l.ligne}`)).toEqual(['lot1.xlsx:2', 'lot2.xlsx:7'])
  })
})
