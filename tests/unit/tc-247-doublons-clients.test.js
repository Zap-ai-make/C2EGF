import { describe, it, expect } from 'vitest'
import {
  plier,
  chiffres,
  numerosDe,
  valeursAgent,
  identiteAgent,
  collisionsCodeNumero,
  REGLES,
  grapperPar,
  analyserDoublons,
  profilerChamps,
  compterOperations,
  classerGrappes,
  nomComplet,
  motsDe,
  numerosSurRepresentes,
  surplusDeNoms,
  annotationsObservees,
  annotationsDansLeNom,
  fusionsFranches,
  croiserAvecAgent,
  comparerAuxTelephones,
} from '../../scripts/lib/doublonsClients.mjs'

/**
 * TC-247 — Reconnaître deux fiches qui désignent la même personne.
 *
 * POURQUOI CES RÈGLES SONT TESTÉES ALORS QU'ELLES NE SUPPRIMENT RIEN
 * ─────────────────────────────────────────────────────────────────
 * Elles ne suppriment rien, mais elles DÉSIGNENT ce qui sera supprimé. Une
 * règle trop large confondrait deux homonymes — deux vraies personnes fondues
 * en une, avec les opérations de l'une attribuées à l'autre. Une règle trop
 * étroite laisserait la liste sale et ferait conclure à tort que le problème
 * est ailleurs. Les deux erreurs se prennent en silence, et aucune n'est
 * rattrapable une fois la fusion lancée.
 *
 * CE QUE CHAQUE RÈGLE DOIT ATTRAPER, ET CE QU'ELLE NE DOIT PAS
 * ───────────────────────────────────────────────────────────
 * C'est tout l'objet de ce fichier : les cas limites qui séparent un doublon
 * d'un homonyme, et les saisies partielles qui ne doivent agglomérer personne.
 */

const fiche = (over = {}) => ({
  id: 'c-1',
  nom: 'Ouedraogo',
  prenom: 'Aïssata',
  numeroPersonnel: '70112233',
  ...over,
})

const regle = (cle) => REGLES.find((r) => r.cle === cle)
const analyse = (cle, fiches) => grapperPar(regle(cle), fiches)

// ─────────────────────────────────────────────────────────────────────────────

describe('TC-247 — plier un texte avant de le comparer', () => {
  it('[TC-247-1] les accents et la casse ne font pas deux personnes', () => {
    expect(plier('OUÉDRAOGO')).toBe(plier('ouedraogo'))
    expect(plier('Aïssata')).toBe('aissata')
  })

  it('[TC-247-2] ni les espaces en trop', () => {
    expect(plier('  Ouedraogo   Aissata ')).toBe('ouedraogo aissata')
  })

  it('[TC-247-3] un numéro se compare par ses chiffres seuls', () => {
    expect(chiffres('+226 70 11 22 33')).toBe('22670112233')
    expect(chiffres('70-11-22-33')).toBe('70112233')
  })
})

/**
 * ⚠ UN CHAMP, PLUSIEURS NUMÉROS — trouvé dans la base réelle le 2026-10-12.
 *   La boutique note les deux ou trois lignes d'un commerce dans la même case :
 *   « 06629924/55772628 », « 07796503/66553459/75928339 ». Les passer à
 *   `chiffres()` donnait « 0662992455772628 », un nombre à seize chiffres traité
 *   comme UN numéro — si bien qu'une fiche portant « 06629924 » seul et une
 *   autre portant « 06629924/55772628 » ne se rencontraient jamais, alors que
 *   c'est le même téléphone.
 */
describe('TC-247 — un champ qui contient plusieurs numéros', () => {
  it('[TC-247-60] scinde sur la barre, comme la boutique les saisit', () => {
    expect(numerosDe('06629924/55772628')).toEqual(['06629924', '55772628'])
    expect(numerosDe('07796503/66553459/75928339')).toEqual(['07796503', '66553459', '75928339'])
  })

  it('[TC-247-61] accepte les autres séparateurs rencontrés', () => {
    expect(numerosDe('70112233, 76445566')).toEqual(['70112233', '76445566'])
    expect(numerosDe('70112233 ; 76445566')).toEqual(['70112233', '76445566'])
    expect(numerosDe('70112233 et 76445566')).toEqual(['70112233', '76445566'])
  })

  it('[TC-247-62] laisse un numéro seul intact, mise en forme comprise', () => {
    expect(numerosDe('+226 70 11 22 33')).toEqual(['22670112233'])
    expect(numerosDe('70112233')).toEqual(['70112233'])
  })

  /** Un fragment n'est pas un numéro : il agglomérerait des inconnus. */
  it('[TC-247-63] écarte les morceaux de moins de huit chiffres', () => {
    expect(numerosDe('70')).toEqual([])
    expect(numerosDe('70112233/70')).toEqual(['70112233'])
    expect(numerosDe('')).toEqual([])
    expect(numerosDe(null)).toEqual([])
  })

  /** Le cœur du défaut : les deux fiches doivent désormais se rencontrer. */
  it('[TC-247-64] rapproche une fiche à un numéro et une fiche à deux', () => {
    const fiches = [
      fiche({ id: 'a', numeroPersonnel: '06629924' }),
      fiche({ id: 'b', numeroPersonnel: '06629924/55772628' }),
    ]

    const r = analyse('telephone', fiches)

    expect(r.nombreGrappes).toBe(1)
    expect(r.enTrop).toBe(1)
  })

  it('[TC-247-65] repère un numéro de remplissage noté à côté d’un vrai', () => {
    const fiches = [
      { id: '1', nom: 'Shop', prenom: 'Fada', numeroPersonnel: '70000000/76111111' },
      { id: '2', nom: 'Issoufou', prenom: 'Niger', numeroPersonnel: '70000000' },
      { id: '3', nom: 'Relai', prenom: 'Albert', numeroPersonnel: '70000000' },
      { id: '4', nom: 'Compaore', prenom: 'Vincent', numeroPersonnel: '70000000' },
      { id: '5', nom: 'Kone', prenom: 'Ali', numeroPersonnel: '70000000' },
    ]

    expect(numerosSurRepresentes(fiches).exclus.has('70000000')).toBe(true)
  })
})

describe('TC-247 — les valeurs d’agent, les trois champs confondus', () => {
  /**
   * ⚠ `orange` EST INCLUS, ET C'EST INDISPENSABLE.
   *   Une fiche d'avant la séparation porte sa valeur là. L'oublier ferait
   *   passer à côté du doublon le plus probable : la même personne saisie une
   *   fois avant la séparation et une fois après.
   */
  it('[TC-247-4] l’ancien champ `orange` compte comme les deux nouveaux', () => {
    expect(valeursAgent({ orange: '1234567' })).toEqual(['1234567'])
    expect(valeursAgent({ codeAgent: '1234567' })).toEqual(['1234567'])
  })

  it('[TC-247-5] une fiche peut en porter plusieurs', () => {
    expect(valeursAgent({ codeAgent: '1234567', numeroAgent: '70112233' }))
      .toEqual(['1234567', '70112233'])
  })

  it('[TC-247-6] les cases vides ne comptent pas', () => {
    expect(valeursAgent({ codeAgent: '', numeroAgent: '   ', orange: null })).toEqual([])
  })
})

/**
 * TC-247 — L'IDENTITÉ AGENT : LE CODE D'ABORD, LE NUMÉRO À DÉFAUT.
 *
 * La règle vient de la boutique : « on compare d'abord les codes, ensuite le
 * numéro si pas de code ». Elle a deux conséquences qu'il faut tenir :
 *   · une fiche a UNE identité, pas une liste de valeurs ;
 *   · c'est `champsAgent` — la fonction de l'écran — qui dit laquelle, pour que
 *     le rapport range les fiches comme le logiciel les montre.
 */
describe('TC-247 — l’identité agent, le code puis le numéro', () => {
  it('[TC-247-45] préfère le code au numéro quand les deux sont là', () => {
    expect(identiteAgent({ codeAgent: '1234567', numeroAgent: '70112233' }))
      .toEqual({ type: 'code', valeur: '1234567' })
  })

  it('[TC-247-46] retient le numéro quand il n’y a pas de code', () => {
    expect(identiteAgent({ codeAgent: '', numeroAgent: '70112233' }))
      .toEqual({ type: 'numero', valeur: '70112233' })
  })

  /**
   * La nature d'une valeur héritée vient de sa LONGUEUR, et c'est la règle de
   * l'application qui l'applique — pas une copie locale.
   */
  it('[TC-247-47] range une valeur héritée par sa longueur, comme l’écran', () => {
    expect(identiteAgent({ orange: '1234567' })).toEqual({ type: 'code', valeur: '1234567' })
    expect(identiteAgent({ orange: '70112233' })).toEqual({ type: 'numero', valeur: '70112233' })
  })

  /**
   * ⚠ LA FICHE DONT L'APPLICATION NE LIT PLUS LE `orange`.
   *   `champsAgent` tranche par la PRÉSENCE des clés : des champs présents mais
   *   vides disent « rangé puis vidé exprès », et la valeur héritée n'est plus
   *   lue. L'audit doit se comporter pareil, sinon il compte des identités que
   *   personne ne voit à l'écran.
   */
  it('[TC-247-48] ignore `orange` quand les champs existent mais sont vides', () => {
    expect(identiteAgent({ codeAgent: '', numeroAgent: '', orange: '1234567' })).toBeNull()
  })

  it('[TC-247-49] rend null quand la fiche ne porte rien', () => {
    expect(identiteAgent({})).toBeNull()
    expect(identiteAgent({ nom: 'Kabore', prenom: 'Hamado' })).toBeNull()
  })

  /**
   * ⚠ UNE SEULE CLÉ PAR FICHE — ET CE N'EST PAS QU'UNE SIMPLIFICATION.
   *   La version précédente rendait une clé par valeur trouvée. Une fiche migrée
   *   gardant `codeAgent` ET `orange` à la même valeur produisait deux fois la
   *   même clé, s'ajoutait donc deux fois à sa propre grappe, et ressortait
   *   comme un doublon d'elle-même. Le « en trop » était gonflé sans qu'aucune
   *   fiche réelle soit en double.
   */
  it('[TC-247-50] une fiche seule n’est jamais le doublon d’elle-même', () => {
    const r = analyse('agent', [fiche({ id: 'a', codeAgent: '1234567', orange: '1234567' })])

    expect(r.nombreGrappes).toBe(0)
    expect(r.enTrop).toBe(0)
  })

  /**
   * On compare un code à un code, un numéro à un numéro. Deux fiches portant la
   * même suite de chiffres dans des cases différentes ne se rencontrent donc
   * pas — un choix assumé, que `collisionsCodeNumero` rend visible au lieu de
   * le laisser passer pour un angle mort.
   */
  it('[TC-247-51] ne confond pas un code avec un numéro de même valeur', () => {
    const fiches = [
      fiche({ id: 'a', codeAgent: '70112233', numeroAgent: '' }),
      fiche({ id: 'b', codeAgent: '', numeroAgent: '70112233' }),
    ]

    expect(analyse('agent', fiches).nombreGrappes).toBe(0)
    expect(collisionsCodeNumero(fiches)).toEqual({
      valeurs: ['70112233'],
      fichesConcernees: 2,
    })
  })

  it('[TC-247-52] ne signale aucune collision quand il n’y en a pas', () => {
    const fiches = [
      fiche({ id: 'a', codeAgent: '1234567' }),
      fiche({ id: 'b', codeAgent: '', numeroAgent: '70112233' }),
    ]

    expect(collisionsCodeNumero(fiches)).toEqual({ valeurs: [], fichesConcernees: 0 })
  })

  it('[TC-247-53] compte séparément ce que l’écran lit et ce que la base contient', () => {
    const profil = profilerChamps([
      { nom: 'A', prenom: 'A', orange: '1234567' },                            // code hérité
      { nom: 'B', prenom: 'B', orange: '70112233' },                           // numéro hérité
      { nom: 'C', prenom: 'C', codeAgent: '7654321', numeroAgent: '' },        // code rangé
      { nom: 'D', prenom: 'D', codeAgent: '', numeroAgent: '', orange: '999' }, // vidé exprès
    ])

    expect(profil.identifieesParCode).toBe(2)
    expect(profil.identifieesParNumero).toBe(1)
    expect(profil.sansIdentite).toBe(1)
    // La valeur est bien EN BASE — `orange` est rempli — mais l'écran ne la lit
    // plus. Les deux compteurs doivent donc diverger, et c'est tout l'intérêt.
    expect(profil.remplissage.orange).toBe(3)
    expect(profil.orangeIgnore).toBe(1)
  })
})

describe('TC-247 — règle « même agent »', () => {
  it('[TC-247-7] rapproche une fiche ancienne et une fiche récente', () => {
    const r = analyse('agent', [
      fiche({ id: 'a', orange: '1234567' }),
      fiche({ id: 'b', codeAgent: '1234567' }),
    ])

    expect(r.nombreGrappes).toBe(1)
    expect(r.enTrop).toBe(1)
  })

  it('[TC-247-8] la mise en forme du numéro ne sépare pas', () => {
    const r = analyse('agent', [
      fiche({ id: 'a', numeroAgent: '70 11 22 33' }),
      fiche({ id: 'b', numeroAgent: '70112233' }),
    ])

    expect(r.nombreGrappes).toBe(1)
  })

  /** Sans valeur d'agent, cette règle ne dit rien — c'est le cas de la majorité. */
  it('[TC-247-9] deux fiches sans aucun agent ne sont pas rapprochées', () => {
    const r = analyse('agent', [fiche({ id: 'a' }), fiche({ id: 'b' })])

    expect(r.nombreGrappes).toBe(0)
  })
})

describe('TC-247 — règle « même téléphone »', () => {
  it('[TC-247-10] rapproche deux saisies du même numéro', () => {
    const r = analyse('telephone', [
      fiche({ id: 'a', numeroPersonnel: '+226 70 11 22 33' }),
      fiche({ id: 'b', numeroPersonnel: '22670112233' }),
    ])

    expect(r.nombreGrappes).toBe(1)
  })

  /**
   * ⚠ LE PIÈGE DE LA SAISIE PARTIELLE. Trois fiches portant « 70 » ne sont pas
   *   trois fois la même personne : c'est un champ à moitié rempli. Les
   *   agglomérer construirait une grappe d'inconnus, et la fusion les
   *   confondrait pour de bon.
   */
  it('[TC-247-11] un fragment de numéro n’agglomère personne', () => {
    const r = analyse('telephone', [
      fiche({ id: 'a', nom: 'Kabore', numeroPersonnel: '70' }),
      fiche({ id: 'b', nom: 'Sawadogo', numeroPersonnel: '70' }),
      fiche({ id: 'c', nom: 'Diallo', numeroPersonnel: '7011' }),
    ])

    expect(r.nombreGrappes).toBe(0)
  })
})

describe('TC-247 — règle « même nom », la plus large', () => {
  it('[TC-247-12] rapproche deux orthographes du même nom', () => {
    const r = analyse('nom', [
      fiche({ id: 'a', nom: 'OUÉDRAOGO', prenom: 'Aïssata' }),
      fiche({ id: 'b', nom: 'ouedraogo', prenom: 'aissata' }),
    ])

    expect(r.nombreGrappes).toBe(1)
  })

  /**
   * ⚠ ET ELLE ATTRAPE AUSSI LES HOMONYMES, délibérément. Deux Ouedraogo Aïssata
   *   avec des téléphones différents sont probablement deux personnes. Cette
   *   règle les montre ; c'est pourquoi elle ne doit jamais être appliquée
   *   seule, et pourquoi le rapport la présente à côté des trois autres.
   */
  it('[TC-247-13] y compris deux personnes différentes — c’est son défaut assumé', () => {
    const r = analyse('nom', [
      fiche({ id: 'a', numeroPersonnel: '70112233' }),
      fiche({ id: 'b', numeroPersonnel: '76998877' }),
    ])

    expect(r.nombreGrappes).toBe(1)
  })

  it('[TC-247-14] un nom sans prénom ne rapproche rien', () => {
    const r = analyse('nom', [
      fiche({ id: 'a', prenom: '' }),
      fiche({ id: 'b', prenom: '   ' }),
    ])

    expect(r.nombreGrappes).toBe(0)
  })
})

describe('TC-247 — règle « nom ET téléphone », la plus sûre', () => {
  it('[TC-247-15] sépare les homonymes que la règle du nom confondait', () => {
    const fiches = [
      fiche({ id: 'a', numeroPersonnel: '70112233' }),
      fiche({ id: 'b', numeroPersonnel: '76998877' }),
    ]

    expect(analyse('nom', fiches).nombreGrappes).toBe(1)
    expect(analyse('nom-telephone', fiches).nombreGrappes).toBe(0)
  })

  it('[TC-247-16] et garde les vrais doublons', () => {
    const r = analyse('nom-telephone', [
      fiche({ id: 'a', nom: 'OUÉDRAOGO', numeroPersonnel: '+226 70 11 22 33' }),
      fiche({ id: 'b', nom: 'ouedraogo', numeroPersonnel: '22670112233' }),
    ])

    expect(r.nombreGrappes).toBe(1)
  })
})

describe('TC-247 — le chiffre qui se compare à l’écart constaté', () => {
  /**
   * « En trop » compte les fiches qui DISPARAÎTRAIENT, pas les grappes. Une
   * grappe de trois ne retire que deux fiches. Confondre les deux ferait
   * conclure que la règle n'explique pas l'écart alors qu'elle l'explique.
   */
  it('[TC-247-17] une grappe de trois vaut DEUX fiches en trop', () => {
    const r = analyse('nom', [fiche({ id: 'a' }), fiche({ id: 'b' }), fiche({ id: 'c' })])

    expect(r.nombreGrappes).toBe(1)
    expect(r.fichesConcernees).toBe(3)
    expect(r.enTrop).toBe(2)
  })

  it('[TC-247-18] les grappes sont rendues de la plus grosse à la plus petite', () => {
    const r = analyse('nom', [
      fiche({ id: 'a', nom: 'Kabore' }), fiche({ id: 'b', nom: 'Kabore' }),
      fiche({ id: 'c' }), fiche({ id: 'd' }), fiche({ id: 'e' }),
    ])

    expect(r.grappes.map((g) => g.membres.length)).toEqual([3, 2])
  })

  it('[TC-247-19] les quatre règles sont rendues ensemble', () => {
    expect(analyserDoublons([fiche()]).map((a) => a.regle))
      .toEqual(['agent', 'telephone', 'nom', 'nom-telephone'])
  })

  it('[TC-247-20] une liste vide ne casse rien', () => {
    expect(analyserDoublons([]).every((a) => a.enTrop === 0)).toBe(true)
    expect(profilerChamps([]).total).toBe(0)
  })
})

describe('TC-247 — le profil des champs, et la question du numéro agent', () => {
  /**
   * ⚠ C'EST CE COMPTAGE QUI TRANCHE « POURQUOI PAS DE NUMÉRO AGENT ».
   *   La séparation range huit chiffres dans le numéro et TOUTE AUTRE longueur
   *   dans le code. Si l'ancien champ ne contient que du sept, la colonne est
   *   vide par construction et rien n'est perdu. S'il contient du huit, c'est
   *   la règle de tri qu'il faut revoir. Deux diagnostics opposés, un seul
   *   chiffre pour les séparer.
   */
  it('[TC-247-21] compte les longueurs de l’ancien champ `orange`', () => {
    const p = profilerChamps([
      fiche({ orange: '1234567' }),
      fiche({ orange: '7654321' }),
      fiche({ orange: '70112233' }),
    ])

    expect(p.longueursOrange).toEqual([[7, 2], [8, 1]])
  })

  it('[TC-247-22] et le remplissage de chaque champ', () => {
    const p = profilerChamps([
      fiche({ codeAgent: '1234567' }),
      fiche({ codeAgent: '' }),
    ])

    expect(p.remplissage.codeAgent).toBe(1)
    expect(p.remplissage.nom).toBe(2)
  })

  it('[TC-247-23] et les fiches qui n’ont aucune valeur d’agent', () => {
    const p = profilerChamps([fiche(), fiche({ codeAgent: '1234567' })])

    expect(p.sansAucunAgent).toBe(1)
  })
})

describe('TC-247 — quelle fiche porte les opérations', () => {
  it('[TC-247-24] compte les opérations par client', () => {
    const ops = compterOperations([
      { clientId: 'a' }, { clientId: 'a' }, { clientId: 'b' }, { clientId: '' }, {},
    ])

    expect(ops.get('a')).toBe(2)
    expect(ops.get('b')).toBe(1)
    expect(ops.size).toBe(2)
  })

  /**
   * ⚠ LE CLASSEMENT QUI DIT COMBIEN DE TRAVAIL RESTE.
   *   Une grappe dont une seule fiche sert se fusionne sans rien déplacer. Une
   *   grappe dont plusieurs servent exige de REPOINTER des transactions vers la
   *   survivante — c'est exactement ce qu'une purge naïve casserait en silence,
   *   en laissant des opérations rattachées à une fiche effacée.
   */
  it('[TC-247-25] sépare les grappes selon le travail qu’elles demandent', () => {
    const grappes = [
      { membres: [{ id: 'x1' }, { id: 'x2' }] },                 // aucune opération
      { membres: [{ id: 'y1' }, { id: 'y2' }] },                 // une seule sert
      { membres: [{ id: 'z1' }, { id: 'z2' }] },                 // les deux servent
    ]
    const ops = new Map([['y1', 5], ['z1', 3], ['z2', 7]])

    expect(classerGrappes(grappes, ops)).toEqual({
      sansOperation: 1,
      uneSeulePortante: 1,
      plusieursPortantes: 1,
    })
  })

  /**
   * LES TROIS DÉFAUTS TROUVÉS SUR LA BASE RÉELLE
   * ────────────────────────────────────────────
   * Les cas ci-dessous ne sont pas inventés : ils reproduisent les trois pièges
   * que le premier passage d'audit a affichés sur les 16 127 fiches de
   * production. Chacun aurait fait casser une fusion automatique, et aucun
   * n'était visible depuis les règles seules.
   */
  describe('les pièges de la base réelle', () => {
    /**
     * ⚠ LE NUMÉRO QUI N'IDENTIFIE PERSONNE.
     *   Vu en production : 66 fiches sur un même `numeroPersonnel`, nommées
     *   « SHOP FADA », « ISSOUFOU / NIGER », « RELAI ALBERT », « COMPAORE P
     *   VINCENT ». La règle téléphone les aurait fondues en un seul commerce.
     */
    it('[TC-247-26] écarte un numéro partagé par des noms sans rapport', () => {
      const fiches = [
        { id: '1', nom: 'Shop', prenom: 'Fada', numeroPersonnel: '70000000' },
        { id: '2', nom: 'Issoufou', prenom: 'Niger', numeroPersonnel: '70000000' },
        { id: '3', nom: 'Relai', prenom: 'Albert', numeroPersonnel: '70000000' },
        { id: '4', nom: 'Compaore', prenom: 'Vincent', numeroPersonnel: '70000000' },
        { id: '5', nom: 'Kone', prenom: 'Ali', numeroPersonnel: '70000000' },
      ]

      const { suspects, exclus, fichesConcernees } = numerosSurRepresentes(fiches)

      expect(suspects).toEqual([{ numero: '70000000', fiches: 5, nomsDistincts: 5 }])
      expect(exclus.has('70000000')).toBe(true)
      expect(fichesConcernees).toBe(5)
    })

    /**
     * ⚠ LA FAMILLE N'EST PAS UNE POUBELLE, et c'est la moitié qui compte.
     *   Cinq fiches « CISSE ADAMA » sur un même téléphone SONT un doublon. Si le
     *   seul critère était le nombre de fiches, cette règle détruirait
     *   précisément les doublons qu'on cherche.
     */
    it('[TC-247-27] ne touche pas un numéro partagé sous un même nom', () => {
      const fiches = Array.from({ length: 6 }, (_, i) => ({
        id: `c${i}`, nom: 'Cisse', prenom: 'Adama', numeroPersonnel: '78334455',
      }))

      expect(numerosSurRepresentes(fiches).suspects).toEqual([])
    })

    it('[TC-247-28] ne retient pas deux noms sur un numéro — un couple, pas une poubelle', () => {
      const fiches = [
        ...Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, nom: 'Kabore', prenom: 'Awa', numeroPersonnel: '76111111' })),
        { id: 'b', nom: 'Kabore', prenom: 'Issa', numeroPersonnel: '76111111' },
      ]

      expect(numerosSurRepresentes(fiches).suspects).toEqual([])
    })

    it('[TC-247-29] ignore les numéros trop courts, qui ne sont pas des numéros', () => {
      const fiches = Array.from({ length: 9 }, (_, i) => ({
        id: `x${i}`, nom: `Nom${i}`, prenom: `Prenom${i}`, numeroPersonnel: '70',
      }))

      expect(numerosSurRepresentes(fiches).suspects).toEqual([])
    })

    it('[TC-247-30] la règle téléphone saute les numéros écartés', () => {
      const regle = REGLES.find((r) => r.cle === 'telephone')
      const fiche = { nom: 'Shop', prenom: 'Fada', numeroPersonnel: '70000000' }

      expect(regle.cles(fiche, {})).toEqual(['tel:70000000'])
      expect(regle.cles(fiche, { numerosExclus: new Set(['70000000']) })).toEqual([])
    })

    it('[TC-247-31] la règle nom+téléphone saute aussi les numéros écartés', () => {
      const regle = REGLES.find((r) => r.cle === 'nom-telephone')
      const fiche = { nom: 'Shop', prenom: 'Fada', numeroPersonnel: '70000000' }

      expect(regle.cles(fiche, {})).toEqual(['nomtel:shop|fada|70000000'])
      expect(regle.cles(fiche, { numerosExclus: new Set(['70000000']) })).toEqual([])
    })

    /**
     * Sans contexte, le comportement d'avant. Les appels existants — et le
     * premier rapport, dont les chiffres sont déjà discutés — restent lisibles.
     */
    it('[TC-247-32] sans contexte, aucune exclusion : le comportement d’origine', () => {
      const fiches = [
        { id: '1', nom: 'A', prenom: 'A', numeroPersonnel: '70000000' },
        { id: '2', nom: 'B', prenom: 'B', numeroPersonnel: '70000000' },
      ]

      expect(grapperPar(REGLES.find((r) => r.cle === 'telephone'), fiches).enTrop).toBe(1)
    })

    /**
     * ⚠ LE STATUT MÉTIER ÉCRIT DANS LE NOM — le plus dangereux des trois.
     *   Vu en production : « SOUBEIGA INOUSSA INTERDIT » à côté de « SOUBEIGA
     *   INOUSSA ». Garder la fiche propre et supprimer la marquée RÉAUTORISE un
     *   client banni, sans trace. Aucune liste de mots codée d'avance n'aurait
     *   trouvé ceux de cette base : c'est l'écart entre les noms d'une grappe
     *   qui les révèle.
     */
    it('[TC-247-33] révèle le mot qu’une fiche porte en plus de ses sœurs', () => {
      const grappe = {
        membres: [
          { nom: 'SOUBEIGA', prenom: 'INOUSSA INTERDIT' },
          { nom: 'SOUBEIGA', prenom: 'INOUSSA' },
          { nom: 'SOUBEIGA', prenom: 'INOUSSA' },
        ],
      }

      expect(surplusDeNoms(grappe)).toEqual({
        homogene: false,
        surplus: ['interdit'],
        commun: ['inoussa', 'soubeiga'],
      })
    })

    it('[TC-247-34] déclare homogène une grappe dont les noms ne diffèrent que par la casse et les accents', () => {
      const grappe = {
        membres: [
          { nom: 'OUÉDRAOGO', prenom: 'Aïssata' },
          { nom: 'ouedraogo', prenom: 'AISSATA' },
        ],
      }

      expect(surplusDeNoms(grappe)).toEqual({
        homogene: true,
        surplus: [],
        commun: ['aissata', 'ouedraogo'],
      })
    })

    it('[TC-247-35] lit un marqueur même collé à la ponctuation', () => {
      expect([...motsDe({ nom: 'OUBIA', prenom: 'LAMINE (INTERDIT) ROUGE' })])
        .toEqual(['oubia', 'lamine', 'interdit', 'rouge'])
      expect(nomComplet({ nom: ' Kabore ', prenom: 'Hamado  ' })).toBe('kabore hamado')
    })

    it('[TC-247-36] classe les annotations par nombre de grappes touchées', () => {
      const grappes = [
        { membres: [{ nom: 'A', prenom: 'X INTERDIT' }, { nom: 'A', prenom: 'X' }] },
        { membres: [{ nom: 'B', prenom: 'Y INTERDIT' }, { nom: 'B', prenom: 'Y' }] },
        { membres: [{ nom: 'C', prenom: 'Z ROUGE' }, { nom: 'C', prenom: 'Z' }] },
      ]

      expect(annotationsObservees(grappes)).toEqual([
        { mot: 'interdit', grappes: 2 },
        { mot: 'rouge', grappes: 1 },
      ])
    })

    /**
     * ⚠ LE FILTRE SANS LEQUEL CETTE SECTION NE SERVIRAIT À RIEN.
     *   Deux fiches réunies par un code agent mais aux noms entièrement
     *   différents n'ont AUCUN mot commun : tous leurs mots sont donc « en
     *   surplus ». Sur les 480 grappes « agent » de la base réelle, les compter
     *   ferait remonter les patronymes les plus courants du pays — et le seul
     *   mot qu'on cherche, « INTERDIT », serait enterré sous OUEDRAOGO et
     *   SAWADOGO. Une annotation s'AJOUTE à un nom par ailleurs identique.
     */
    it('[TC-247-42] ne prend pas des patronymes pour des annotations', () => {
      const grappes = [
        // Noms sans rien en commun : du bruit, pas une annotation.
        { membres: [{ nom: 'SAWADOGO', prenom: 'HAMIDOU' }, { nom: 'BELEM', prenom: 'WENDKUNI' }] },
        { membres: [{ nom: 'OUEDRAOGO', prenom: 'ALI' }, { nom: 'KONE', prenom: 'MOUSSA' }] },
        // Un noyau commun, un mot ajouté : voilà une annotation.
        { membres: [{ nom: 'SOUBEIGA', prenom: 'INOUSSA INTERDIT' }, { nom: 'SOUBEIGA', prenom: 'INOUSSA' }] },
      ]

      expect(annotationsObservees(grappes)).toEqual([{ mot: 'interdit', grappes: 1 }])
    })

    /**
     * ⚠ LE CODE AGENT QUI DÉSIGNE DEUX NOMS.
     *   Vu en production : « SAWADOGO HAMIDOU ×3 » et « BELEM WENDKUNI (1 op.) »
     *   sous un même code agent. La seule fiche qui porte une opération ne porte
     *   pas le même nom — fusionner changerait le titulaire de l'opération.
     */
    it('[TC-247-37] refuse une grappe dont les noms divergent, même si une seule fiche sert', () => {
      const grappe = {
        cle: 'agent:1234567',
        membres: [
          { id: 's1', nom: 'SAWADOGO', prenom: 'HAMIDOU' },
          { id: 's2', nom: 'SAWADOGO', prenom: 'HAMIDOU' },
          { id: 'b1', nom: 'BELEM', prenom: 'WENDKUNI' },
        ],
      }

      const { franches, aRegarder, fichesSupprimables } = fusionsFranches([grappe], new Map([['b1', 1]]))

      expect(franches).toEqual([])
      expect(fichesSupprimables).toBe(0)
      // Aucun mot commun : ce n'est pas une orthographe différente du même nom,
      // c'est deux noms. Sous un même code agent, seule la boutique peut dire
      // si le code a été mal saisi ou si le commerce a changé de main.
      expect(aRegarder[0].raison).toBe('noms sans rapport')
    })

    /**
     * ⚠ LA VARIANTE D'ORTHOGRAPHE N'EST PAS UN CONFLIT DE NOMS.
     *   Vu en production : « ILBOUDO T.ALAYE », « ILBOUDO TONGONOMA ALAYE »,
     *   « ILBOUDO T ALAYE » sous un même code agent, portant 18 opérations à
     *   elles trois. C'est un nom écrit trois fois, pas trois commerces — et le
     *   ranger avec le cas SAWADOGO/BELEM ferait renoncer à un doublon certain.
     */
    it('[TC-247-58] distingue une variante d’orthographe de deux noms sans rapport', () => {
      const variante = {
        cle: 'agent:code:1234567',
        membres: [
          { id: 'v1', nom: 'ILBOUDO', prenom: 'T.ALAYE', orange: '1234567' },
          { id: 'v2', nom: 'ILBOUDO', prenom: 'TONGONOMA ALAYE', orange: '1234567' },
          { id: 'v3', nom: 'ILBOUDO', prenom: 'T ALAYE', orange: '1234567' },
        ],
      }

      const { aRegarder } = fusionsFranches([variante], new Map())

      expect(aRegarder[0].raison).toBe('variante du même nom')
      // Le surplus nomme ce qui diffère — de quoi reporter le nom le plus
      // complet sur la survivante au moment de la fusion.
      expect(aRegarder[0].surplus).toEqual(['t', 'tongonoma'])
    })

    /**
     * L'annotation reste du côté « variante » : « SOUBEIGA INOUSSA INTERDIT »
     * partage son noyau avec « SOUBEIGA INOUSSA ». C'est voulu — garder le nom
     * le plus complet préserve l'interdiction au lieu de l'effacer.
     */
    it('[TC-247-59] range l’annotation avec les variantes, pas avec les conflits', () => {
      const grappe = {
        cle: 'agent:code:7654321',
        membres: [
          { id: 's1', nom: 'SOUBEIGA', prenom: 'INOUSSA INTERDIT', orange: '7654321' },
          { id: 's2', nom: 'SOUBEIGA', prenom: 'INOUSSA', orange: '7654321' },
        ],
      }

      const { aRegarder } = fusionsFranches([grappe], new Map())

      expect(aRegarder[0].raison).toBe('variante du même nom')
      expect(aRegarder[0].surplus).toEqual(['interdit'])
    })

    /**
     * ⚠ LE DOUBLON QUI N'EN EST PAS : UN PROPRIÉTAIRE, PLUSIEURS COMMERCES.
     *   Douze fiches « CISSE ADAMA » sur un même téléphone ne sont pas douze
     *   saisies de la même boutique : c'est un propriétaire qui tient douze
     *   points de vente, chacun avec SON code agent. Les réduire à une fiche
     *   effacerait onze commerces.
     *
     *   Mesuré sur la base réelle : la règle nom+téléphone donnait 922 fiches
     *   « sans risque », quand la règle agent n'en comptait que 473 en trop sur
     *   toute la base. L'écart, c'était exactement ce cas.
     */
    it('[TC-247-54] refuse de fusionner des fiches aux identifiants agent différents', () => {
      const grappe = {
        cle: 'nomtel:cisse|adama|78334455',
        membres: [
          { id: 'c1', nom: 'CISSE', prenom: 'ADAMA', orange: '1111111' },
          { id: 'c2', nom: 'CISSE', prenom: 'ADAMA', orange: '2222222' },
          { id: 'c3', nom: 'CISSE', prenom: 'ADAMA', orange: '3333333' },
        ],
      }

      const { franches, aRegarder, fichesSupprimables } = fusionsFranches([grappe], new Map())

      expect(franches).toEqual([])
      expect(fichesSupprimables).toBe(0)
      expect(aRegarder[0].raison).toBe('3 identifiants agent différents')
    })

    it('[TC-247-55] accepte les mêmes fiches quand l’identifiant agent est partagé', () => {
      const grappe = {
        cle: 'nomtel:cisse|adama|78334455',
        membres: [
          { id: 'c1', nom: 'CISSE', prenom: 'ADAMA', orange: '1111111' },
          { id: 'c2', nom: 'CISSE', prenom: 'ADAMA', codeAgent: '1111111' },
        ],
      }

      expect(fusionsFranches([grappe], new Map()).fichesSupprimables).toBe(1)
    })

    /**
     * Une fiche sans identifiant ne réfute rien : elle ne dit pas « autre
     * commerce », elle ne dit rien du tout. La grappe reste fusionnable.
     */
    it('[TC-247-56] ne bloque pas sur une fiche dépourvue d’identifiant', () => {
      const grappe = {
        cle: 'nomtel:kone|ali|76112233',
        membres: [
          { id: 'k1', nom: 'KONE', prenom: 'ALI', orange: '1111111' },
          { id: 'k2', nom: 'KONE', prenom: 'ALI' },
        ],
      }

      expect(fusionsFranches([grappe], new Map()).fichesSupprimables).toBe(1)
    })

    /**
     * ⚠ LES « NUMÉROS AGENT » QUI N'EN SONT PAS.
     *   La base porte des milliers de vrais téléphones. Si une valeur classée
     *   « numéro agent » commence par une tête qu'aucun d'eux n'utilise, ce
     *   n'est pas un téléphone — c'est un code de huit chiffres que la règle de
     *   tri a rangé dans la mauvaise colonne.
     */
    it('[TC-247-57] repère les « numéros agent » qui ne ressemblent à aucun téléphone', () => {
      const fiches = [
        { numeroPersonnel: '70112233' },
        { numeroPersonnel: '76445566' },
        // Huit chiffres, mais une tête qu'aucun téléphone de la base n'utilise.
        { codeAgent: '', numeroAgent: '44778899' },
        { codeAgent: '', numeroAgent: '44001122' },
        // Huit chiffres sur une tête bien connue des téléphones : plausible.
        { codeAgent: '', numeroAgent: '70998877' },
      ]

      expect(comparerAuxTelephones(fiches)).toEqual({
        total: 3,
        tetesDeTelephone: 2,
        surTeteInconnue: 2,
        tetesInconnues: [['44', 2]],
      })
    })

    it('[TC-247-38] refuse une grappe où deux fiches portent des opérations', () => {
      const grappe = {
        cle: 'nomtel:cisse|adama|78334455',
        membres: [{ id: 'c1', nom: 'CISSE', prenom: 'ADAMA' }, { id: 'c2', nom: 'CISSE', prenom: 'ADAMA' }],
      }

      const { franches, aRegarder } = fusionsFranches([grappe], new Map([['c1', 3], ['c2', 7]]))

      expect(franches).toEqual([])
      expect(aRegarder[0].raison).toBe('2 fiches portent des opérations')
    })

    it('[TC-247-39] garde la fiche référencée, et supprime les autres', () => {
      const grappe = {
        cle: 'nomtel:sawadogo|more|78334455',
        membres: [
          { id: 'm1', nom: 'SAWADOGO', prenom: 'MORE' },
          { id: 'm2', nom: 'SAWADOGO', prenom: 'MORE', numeroPersonnel: '78334455', orange: '1234567' },
          { id: 'm3', nom: 'SAWADOGO', prenom: 'MORE' },
        ],
      }

      const { franches, fichesSupprimables } = fusionsFranches([grappe], new Map([['m1', 2]]))

      // m1 sert, m2 est plus complète : c'est m1 qui reste. Une fiche riche mais
      // orpheline se reconstruit ; une opération rattachée au vide, non.
      expect(franches[0].survivante.id).toBe('m1')
      expect(franches[0].perdantes.map((p) => p.id)).toEqual(['m2', 'm3'])
      expect(fichesSupprimables).toBe(2)
    })

    it('[TC-247-40] à défaut de référence, garde la fiche la plus complète', () => {
      const grappe = {
        cle: 'nomtel:sana|fatimata|75998877',
        membres: [
          { id: 'p1', nom: 'SANA', prenom: 'FATIMATA' },
          { id: 'p2', nom: 'SANA', prenom: 'FATIMATA', numeroPersonnel: '75998877', numeroAgent: '70445566' },
        ],
      }

      const { franches, fichesSupprimables } = fusionsFranches([grappe], new Map())

      expect(franches[0].survivante.id).toBe('p2')
      expect(fichesSupprimables).toBe(1)
    })

    /**
     * ⚠ UNE FICHE PEUT ÊTRE RÉFÉRENCÉE SANS PORTER D'OPÉRATION.
     *   `storeCollaborations` est une collection racine qui désigne un client
     *   sans rien écrire dans `history`. Le premier rapport ne la lisait pas, et
     *   appelait donc « sans opération » — donc supprimable — une fiche qu'une
     *   demande en cours référençait.
     */
    it('[TC-247-41] compte les collaborations comme des références', () => {
      const grappe = {
        cle: 'nomtel:diallo|moussa|70112233',
        membres: [{ id: 'd1', nom: 'DIALLO', prenom: 'MOUSSA' }, { id: 'd2', nom: 'DIALLO', prenom: 'MOUSSA' }],
      }
      const operations = compterOperations([])
      const references = compterOperations([{ clientId: 'd1' }, { clientId: 'd2' }])

      // Vue depuis history + drafts seuls, la grappe semblait libre des deux côtés.
      expect(fusionsFranches([grappe], operations).franches).toHaveLength(1)
      // Les collaborations en vue, elle demande un arbitrage humain.
      expect(fusionsFranches([grappe], references).aRegarder[0].raison)
        .toBe('2 fiches portent des opérations')
    })

    /**
     * ⚠ L'HOMONYME N'EST PAS UN DOUBLON, ET LE CODE AGENT LE PROUVE.
     *   Sur la base réelle, `orange` est rempli à 100 % et la règle agent ne
     *   réunit que 980 fiches : plus de quinze mille portent un identifiant qui
     *   n'appartient qu'à elles. Deux « OUEDRAOGO SOULEYMANE » aux codes
     *   différents sont donc deux commerces — et les 4 424 fiches « en trop » de
     *   la règle nom ne sont pas 4 424 doublons.
     */
    it('[TC-247-43] distingue le doublon de l’homonyme par le code agent', () => {
      const grappes = [
        // Un seul identifiant pour trois fiches : le même commerce, trois fois.
        {
          membres: [
            { id: 'a1', nom: 'CISSE', prenom: 'ADAMA', orange: '1111111' },
            { id: 'a2', nom: 'CISSE', prenom: 'ADAMA', codeAgent: '1111111' },
            { id: 'a3', nom: 'CISSE', prenom: 'ADAMA', orange: '1111111' },
          ],
        },
        // Trois identifiants pour trois fiches : trois commerces homonymes.
        {
          membres: [
            { id: 'b1', nom: 'OUEDRAOGO', prenom: 'SOULEYMANE', orange: '2222222' },
            { id: 'b2', nom: 'OUEDRAOGO', prenom: 'SOULEYMANE', orange: '3333333' },
            { id: 'b3', nom: 'OUEDRAOGO', prenom: 'SOULEYMANE', orange: '4444444' },
          ],
        },
        // Deux identifiants pour trois fiches : un doublon parmi des homonymes.
        {
          membres: [
            { id: 'c1', nom: 'KABORE', prenom: 'HAMADO', orange: '5555555' },
            { id: 'c2', nom: 'KABORE', prenom: 'HAMADO', orange: '5555555' },
            { id: 'c3', nom: 'KABORE', prenom: 'HAMADO', orange: '6666666' },
          ],
        },
      ]

      expect(croiserAvecAgent(grappes)).toEqual({
        unSeulAgent: 1,
        agentsTousDistincts: 1,
        melange: 1,
        // Seule la première grappe autorise à conclure : deux fiches en trop.
        fichesSiUnSeulAgent: 2,
      })
    })

    it('[TC-247-44] compte comme doublon une grappe dont aucune fiche n’a d’agent', () => {
      const grappes = [{ membres: [{ id: 'x' }, { id: 'y' }] }]

      expect(croiserAvecAgent(grappes)).toEqual({
        unSeulAgent: 1,
        agentsTousDistincts: 0,
        melange: 0,
        fichesSiUnSeulAgent: 1,
      })
    })
  })
})

/**
 * ⚠ LES CONSIGNES ÉCRITES DANS LE NOM.
 *
 *   C'est la seule information de toute la purge dont la perte se découvre au
 *   guichet et non dans un rapport : un « INTERDIT » disparu, c'est un client
 *   banni qui obtient du crédit. Les lots A, B et C la préservaient en reportant
 *   le nom le plus complet ; le lot D ne reporte rien par construction, donc la
 *   consigne doit être CHERCHÉE dans les noms abandonnés.
 */
describe('TC-247 — reconnaître une consigne de gestion dans un nom', () => {
  /**
   * Les quatre écritures relevées en production. « INTERDIT », « INTERDI » et
   * « ( INTERDIT ) » sont le même mot mal tapé trois fois : un détecteur de mots
   * entiers en manquerait deux sur trois.
   */
  it('[TC-247-66] reconnaît les écritures réellement rencontrées', () => {
    expect(annotationsDansLeNom('ILBOUDO ZACHARIA INTERDI DG')).toContain('interdi')
    expect(annotationsDansLeNom('SAWADOGO SAIDOU ( INTERDIT ) ROUGE')).toContain('interdi')
    expect(annotationsDansLeNom('ZERBO YACOUBA PLUS DE DEPOT A CREDIT')).toEqual(
      expect.arrayContaining(['depot', 'credit']),
    )
    expect(annotationsDansLeNom('ROUMBA ARSENE PAS D DEPOT')).toContain('depot')
  })

  /** Un nom ordinaire ne doit pas déclencher la relecture. */
  it('[TC-247-67] ne voit pas de consigne dans un nom ordinaire', () => {
    expect(annotationsDansLeNom('OUEDRAOGO SOULEYMANE')).toEqual([])
    expect(annotationsDansLeNom('BANQUE RETRAIT DEPOT')).toContain('depot')
  })

  /** Les accents et la casse ne doivent pas suffire à passer entre les mailles. */
  it('[TC-247-68] lit la consigne quelle que soit la casse ou l’accent', () => {
    expect(annotationsDansLeNom('zongo ali interdît')).toContain('interdi')
    expect(annotationsDansLeNom('ZONGO ALI Bloqué')).toContain('bloqu')
  })

  it('[TC-247-69] ne tombe pas sur une valeur absente', () => {
    expect(annotationsDansLeNom(null)).toEqual([])
    expect(annotationsDansLeNom(undefined)).toEqual([])
    expect(annotationsDansLeNom('')).toEqual([])
  })
})
