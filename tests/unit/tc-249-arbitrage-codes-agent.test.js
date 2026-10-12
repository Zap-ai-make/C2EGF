import { describe, it, expect } from 'vitest'
import {
  instantDe,
  periodeDe,
  seChevauchent,
  situerGrappe,
  arbitrerGrappes,
  distanceEdition,
  ecartDeNoms,
  ecartMinimal,
  telephonePartage,
  SITUATIONS,
} from '../../scripts/lib/arbitrageCodesAgent.mjs'

/**
 * TC-249 — Un code agent, plusieurs noms : lire le temps.
 *
 * POURQUOI CE MODULE NE DÉCIDE RIEN
 * ─────────────────────────────────
 * Quand deux fiches aux noms sans rapport partagent un identifiant agent, deux
 * histoires opposées sont possibles : un code mal saisi (à corriger) ou un
 * commerce qui a changé de main (à laisser). Les noms ne les séparent pas, et
 * c'est pour ça que ces 171 grappes ont été écartées des trois lots de fusion.
 *
 * CE QUE LE TEMPS APPORTE
 * ───────────────────────
 * Un changement de main produit deux périodes qui SE SUIVENT. Un code mal saisi
 * produit deux périodes qui SE CHEVAUCHENT — deux noms opérant le même jour sous
 * le même identifiant, ce qu'un seul commerce ne fait pas. Ces tests fixent cette
 * lecture, et surtout les cas où elle doit refuser de conclure.
 */
describe('TC-249 — l’instant d’une opération', () => {
  it('[TC-249-01] lit un Timestamp Firestore', () => {
    expect(instantDe({ createdAt: { toMillis: () => 1_700_000_000_000 } })).toBe(1_700_000_000_000)
  })

  it('[TC-249-02] lit aussi une Date, un nombre et une chaîne ISO', () => {
    expect(instantDe({ createdAt: new Date('2026-03-01T10:00:00Z') })).toBe(Date.parse('2026-03-01T10:00:00Z'))
    expect(instantDe({ createdAt: 1_700_000_000_000 })).toBe(1_700_000_000_000)
    expect(instantDe({ createdAt: '2026-03-01T10:00:00Z' })).toBe(Date.parse('2026-03-01T10:00:00Z'))
  })

  it('[TC-249-03] lit la forme { seconds } d’un Timestamp sérialisé', () => {
    expect(instantDe({ createdAt: { seconds: 1_700_000_000 } })).toBe(1_700_000_000_000)
  })

  /**
   * ⚠ PAS DE DATE N'EST PAS LE 1ᵉʳ JANVIER 1970.
   *   Traiter un champ manquant comme l'instant zéro placerait la fiche très
   *   loin dans le passé, donc hors de toute période — et inventerait une
   *   succession là où il n'y a qu'une donnée absente.
   */
  it('[TC-249-04] rend null quand il n’y a pas de date lisible', () => {
    expect(instantDe({})).toBeNull()
    expect(instantDe({ createdAt: null })).toBeNull()
    expect(instantDe({ createdAt: 'pas une date' })).toBeNull()
    expect(instantDe({ createdAt: new Date('invalide') })).toBeNull()
  })

  it('[TC-249-05] va chercher la date sous `donnees`, comme le script la lit', () => {
    expect(instantDe({ donnees: { createdAt: 1_700_000_000_000 } })).toBe(1_700_000_000_000)
  })
})

describe('TC-249 — la période d’activité d’une fiche', () => {
  const jour = (n) => Date.parse(`2026-03-${String(n).padStart(2, '0')}T10:00:00Z`)

  it('[TC-249-06] encadre les opérations par leur première et dernière date', () => {
    const operations = new Map([['a', [
      { createdAt: jour(5) }, { createdAt: jour(1) }, { createdAt: jour(3) },
    ]]])

    expect(periodeDe('a', operations)).toEqual({
      nombre: 3, debut: jour(1), fin: jour(5), datees: 3,
    })
  })

  it('[TC-249-07] rend null pour une fiche qui n’a jamais servi', () => {
    expect(periodeDe('inconnue', new Map())).toBeNull()
  })

  /** Des opérations sans date ne fabriquent pas de période — on le dit. */
  it('[TC-249-08] compte les opérations non datées sans inventer de période', () => {
    const operations = new Map([['a', [{ createdAt: null }, { createdAt: undefined }]]])

    expect(periodeDe('a', operations)).toEqual({
      nombre: 2, debut: null, fin: null, datees: 0,
    })
  })
})

describe('TC-249 — le chevauchement', () => {
  const p = (debut, fin) => ({ nombre: 1, debut, fin, datees: 1 })

  it('[TC-249-09] voit deux périodes qui se recouvrent', () => {
    expect(seChevauchent(p(10, 20), p(15, 25))).toBe(true)
    expect(seChevauchent(p(15, 25), p(10, 20))).toBe(true)
  })

  it('[TC-249-10] voit un jour unique tombant dans une période', () => {
    expect(seChevauchent(p(10, 20), p(15, 15))).toBe(true)
  })

  it('[TC-249-11] ne voit rien entre deux périodes disjointes', () => {
    expect(seChevauchent(p(10, 20), p(21, 30))).toBe(false)
  })

  it('[TC-249-12] compte le contact exact comme un chevauchement', () => {
    expect(seChevauchent(p(10, 20), p(20, 30))).toBe(true)
  })

  /** Sans date, aucun chevauchement ne peut être affirmé. */
  it('[TC-249-13] refuse de conclure sur une période non datée', () => {
    expect(seChevauchent(p(10, 20), { nombre: 1, debut: null, fin: null, datees: 0 })).toBe(false)
    expect(seChevauchent(null, p(10, 20))).toBe(false)
  })
})

describe('TC-249 — situer une grappe', () => {
  const jour = (n) => Date.parse(`2026-03-${String(n).padStart(2, '0')}T10:00:00Z`)
  const grappe = (membres) => ({ cle: 'agent:code:1234567', membres })

  it('[TC-249-14] reconnaît une grappe dont aucune fiche n’a servi', () => {
    const situee = situerGrappe(
      grappe([
        { id: 'a', nom: 'SAWADOGO', prenom: 'HAMIDOU' },
        { id: 'b', nom: 'BELEM', prenom: 'WENDKUNI' },
      ]),
      new Map(),
    )

    expect(situee.situation).toBe(SITUATIONS.MUETTE.cle)
    expect(situee.actives).toBe(0)
  })

  it('[TC-249-15] reconnaît qu’une seule fiche porte des opérations', () => {
    const situee = situerGrappe(
      grappe([
        { id: 'a', nom: 'SAWADOGO', prenom: 'HAMIDOU' },
        { id: 'b', nom: 'BELEM', prenom: 'WENDKUNI' },
      ]),
      new Map([['b', [{ createdAt: jour(3) }]]]),
    )

    expect(situee.situation).toBe(SITUATIONS.UNE_SEULE_ACTIVE.cle)
    // La plus active en tête : la boutique lit le haut de la liste d'abord.
    expect(situee.fiches[0].id).toBe('b')
  })

  /**
   * ⚠ LE CAS QUI DÉSIGNE UNE FAUTE DE SAISIE.
   *   Deux noms qui opèrent le même mois sous un même identifiant agent : un
   *   commerce unique ne fait pas ça. L'une des deux fiches porte un code qui
   *   n'est pas le sien — à corriger, et sûrement pas à fusionner.
   */
  it('[TC-249-16] reconnaît deux noms actifs en même temps', () => {
    const situee = situerGrappe(
      grappe([
        { id: 'a', nom: 'SAWADOGO', prenom: 'HAMIDOU' },
        { id: 'b', nom: 'BELEM', prenom: 'WENDKUNI' },
      ]),
      new Map([
        ['a', [{ createdAt: jour(1) }, { createdAt: jour(20) }]],
        ['b', [{ createdAt: jour(10) }]],
      ]),
    )

    expect(situee.situation).toBe(SITUATIONS.CHEVAUCHEMENT.cle)
  })

  /**
   * ⚠ LE CAS QU'IL NE FAUT SURTOUT PAS FUSIONNER.
   *   Les opérations de la première fiche s'arrêtent avant que celles de la
   *   seconde ne commencent : le commerce a changé de main. Les deux fiches
   *   sont légitimes, et chaque opération appartient bien à son titulaire.
   */
  it('[TC-249-17] reconnaît une succession dans le temps', () => {
    const situee = situerGrappe(
      grappe([
        { id: 'ancien', nom: 'SAWADOGO', prenom: 'HAMIDOU' },
        { id: 'nouveau', nom: 'BELEM', prenom: 'WENDKUNI' },
      ]),
      new Map([
        ['ancien', [{ createdAt: jour(1) }, { createdAt: jour(5) }]],
        ['nouveau', [{ createdAt: jour(20) }, { createdAt: jour(25) }]],
      ]),
    )

    expect(situee.situation).toBe(SITUATIONS.SUCCESSION.cle)
  })

  /**
   * Un seul recouvrement suffit à écarter l'hypothèse du changement de main :
   * trois fiches dont deux se chevauchent ne sont pas une succession.
   */
  it('[TC-249-18] un seul recouvrement écarte la succession', () => {
    const situee = situerGrappe(
      grappe([
        { id: 'a', nom: 'A', prenom: 'A' },
        { id: 'b', nom: 'B', prenom: 'B' },
        { id: 'c', nom: 'C', prenom: 'C' },
      ]),
      new Map([
        ['a', [{ createdAt: jour(1) }]],
        ['b', [{ createdAt: jour(10) }]],
        ['c', [{ createdAt: jour(10) }]],
      ]),
    )

    expect(situee.situation).toBe(SITUATIONS.CHEVAUCHEMENT.cle)
  })

  /**
   * ⚠ « NE SE CHEVAUCHENT PAS » N'EST PAS « SE SUIVENT ».
   *   `seChevauchent` rend false dès qu'une période manque de dates. Sans
   *   catégorie propre, ces grappes tomberaient en « succession » et le rapport
   *   annoncerait un changement de main déduit de dates absentes — une histoire
   *   fausse, sur laquelle la boutique déciderait.
   */
  it('[TC-249-22] ne conclut pas à une succession quand les dates manquent', () => {
    const situee = situerGrappe(
      grappe([
        { id: 'a', nom: 'NACOULMA', prenom: 'PAUL' },
        { id: 'b', nom: 'KABORE', prenom: 'SALIF' },
      ]),
      new Map([
        ['a', [{ createdAt: null }]],
        ['b', [{ createdAt: null }]],
      ]),
    )

    expect(situee.situation).toBe(SITUATIONS.DATES_MANQUANTES.cle)
    expect(situee.actives).toBe(2)
  })

  /** Une seule date manquante sur deux suffit : on ne peut plus comparer. */
  it('[TC-249-23] refuse de conclure dès qu’une seule période n’est pas datée', () => {
    const situee = situerGrappe(
      grappe([
        { id: 'a', nom: 'A', prenom: 'A' },
        { id: 'b', nom: 'B', prenom: 'B' },
      ]),
      new Map([
        ['a', [{ createdAt: jour(1) }]],
        ['b', [{ createdAt: null }]],
      ]),
    )

    expect(situee.situation).toBe(SITUATIONS.DATES_MANQUANTES.cle)
  })

  /** Le chevauchement, lui, reste affirmable : il se constate sur ce qui EST daté. */
  it('[TC-249-24] conclut au chevauchement même si une troisième fiche n’est pas datée', () => {
    const situee = situerGrappe(
      grappe([
        { id: 'a', nom: 'A', prenom: 'A' },
        { id: 'b', nom: 'B', prenom: 'B' },
        { id: 'c', nom: 'C', prenom: 'C' },
      ]),
      new Map([
        ['a', [{ createdAt: jour(1) }, { createdAt: jour(20) }]],
        ['b', [{ createdAt: jour(10) }]],
        ['c', [{ createdAt: null }]],
      ]),
    )

    expect(situee.situation).toBe(SITUATIONS.CHEVAUCHEMENT.cle)
  })

  it('[TC-249-19] rend le téléphone et le libellé, pour juger sur pièces', () => {
    const situee = situerGrappe(
      grappe([{ id: 'a', nom: 'SAWADOGO', prenom: 'HAMIDOU', numeroPersonnel: '70112233' }]),
      new Map(),
    )

    expect(situee.fiches[0]).toMatchObject({
      id: 'a', libelle: 'SAWADOGO HAMIDOU', telephone: '70112233', nom: 'sawadogo hamidou',
    })
  })
})

/**
 * TC-249 — L'ÉCART ORTHOGRAPHIQUE, mesuré sur les paires réelles.
 *
 * ⚠ CE QUE LE PREMIER PASSAGE AVAIT MANQUÉ. Il cherchait des MOTS communs, et
 *   concluait « noms sans rapport » sur « KOANDA HAMADO » face à « KAONDA
 *   AMADO » : deux lettres transposées et un H envolé. Mesuré en production,
 *   AUCUNE des 175 grappes n'était un changement de main — toutes étaient des
 *   saisies du même nom, ou de vrais noms distincts. Les séparer demande une
 *   distance d'édition, pas une comparaison de mots.
 */
describe('TC-249 — l’écart entre deux orthographes', () => {
  it('[TC-249-25] compte les lettres à changer', () => {
    expect(distanceEdition('koanda', 'koanda')).toBe(0)
    expect(distanceEdition('koanda', 'kaonda')).toBe(2)
    expect(distanceEdition('lamin', 'lamine')).toBe(1)
    expect(distanceEdition('', 'abc')).toBe(3)
    expect(distanceEdition('abc', '')).toBe(3)
  })

  /**
   * Les paires lues dans le rapport de production. Le seuil de 30 % les sépare
   * des vrais homonymes, et ces tests le vérifient sur les deux côtés.
   */
  it('[TC-249-26] rapproche les paires que la boutique a réellement saisies', () => {
    const proche = (a, b) => ecartDeNoms(
      { nom: a.split(' ')[0], prenom: a.split(' ').slice(1).join(' ') },
      { nom: b.split(' ')[0], prenom: b.split(' ').slice(1).join(' ') },
    )

    expect(proche('KOANDA HAMADO', 'KAONDA AMADO')).toBeLessThan(0.3)
    expect(proche('KOANDA LAMIN', 'KAONDA LAMINE')).toBeLessThan(0.3)
    expect(proche('NIAMPA HAMIDOU', 'YAMPA AMIDOU')).toBeLessThan(0.3)
    expect(proche('BAGAGNAN ALIMATA', 'BAGGNAN ALIMA')).toBeLessThan(0.3)
  })

  it('[TC-249-27] laisse loin les noms réellement différents', () => {
    const ecart = (a, b) => ecartDeNoms(
      { nom: a.split(' ')[0], prenom: a.split(' ').slice(1).join(' ') },
      { nom: b.split(' ')[0], prenom: b.split(' ').slice(1).join(' ') },
    )

    expect(ecart('SAWADOGO HAMIDOU', 'BELEM WENDKUNI')).toBeGreaterThan(0.3)
    expect(ecart('KABORE ALI', 'YARGA DIMACHI DAVI')).toBeGreaterThan(0.3)
    expect(ecart('NAGRAOGO YOUSSIF', 'SANFO SIDIKI')).toBeGreaterThan(0.3)
    expect(ecart('MME SAWADOGO', 'BANQUE RETRAIT DEPOT')).toBeGreaterThan(0.3)
  })

  /** La casse et les accents ne créent aucun écart : `nomComplet` les plie. */
  it('[TC-249-28] ignore la casse et les accents', () => {
    expect(ecartDeNoms(
      { nom: 'OUÉDRAOGO', prenom: 'Aïssata' },
      { nom: 'ouedraogo', prenom: 'AISSATA' },
    )).toBe(0)
  })

  /**
   * ⚠ L'ÉCART D'UNE GRAPPE EST LE PLUS FAIBLE DE SES PAIRES. Il suffit que deux
   *   fiches se ressemblent pour que la grappe mérite un regard : la moyenne
   *   diluerait une paire évidente parmi cinq fiches, et le maximum ne dirait
   *   que l'intruse la plus lointaine.
   */
  it('[TC-249-29] retient la paire la plus ressemblante d’une grappe', () => {
    const membres = [
      { nom: 'KOANDA', prenom: 'HAMADO' },
      { nom: 'ZOUANGA', prenom: 'OUMAROU' },
      { nom: 'KAONDA', prenom: 'AMADO' },
    ]

    expect(ecartMinimal(membres)).toBeLessThan(0.3)
  })

  it('[TC-249-30] rend 1 pour une fiche seule — rien à comparer', () => {
    expect(ecartMinimal([{ nom: 'KONE', prenom: 'ALI' }])).toBe(1)
    expect(ecartMinimal([])).toBe(1)
  })
})

/**
 * TC-249 — LE TÉLÉPHONE PARTAGÉ, ET CE QU'IL NE PROUVE PAS.
 *
 * ⚠ J'AI D'ABORD CRU QUE C'ÉTAIT UNE PREUVE D'IDENTITÉ. La production l'a
 *   réfuté : sur six grappes partageant un téléphone sous un même identifiant
 *   agent, trois portaient des noms sans aucun rapport — « ZIDA KASSOUM » et
 *   « KINDA ADJARA », « BADO BRIGITTE » et « AGENCE ORODARA ». Un numéro commun,
 *   c'est un couple, des associés, une agence et sa gérante. Fusionner sur ce
 *   seul critère aurait confondu deux personnes réelles.
 *
 *   Le signal reste utile CROISÉ avec l'écart orthographique. Seul, il décrit.
 */
describe('TC-249 — le téléphone partagé dans une grappe', () => {
  /**
   * Le contre-exemple qui a invalidé l'hypothèse. Il est ici pour qu'aucune
   * version ultérieure ne retombe dans l'idée que ce signal suffit.
   */
  it('[TC-249-39] un téléphone commun ne rapproche pas deux noms étrangers', () => {
    const situee = situerGrappe({
      cle: 'agent:code:5558862',
      membres: [
        { id: 'a', nom: 'ZIDA', prenom: 'KASSOUM', numeroPersonnel: '55588623' },
        { id: 'b', nom: 'KINDA', prenom: 'ADJARA', numeroPersonnel: '55588623' },
      ],
    }, new Map())

    expect(situee.telephonePartage).toBe('55588623')
    // Et pourtant les noms n'ont rien de commun : le téléphone ne décide pas.
    expect(situee.ecart).toBeGreaterThan(0.3)
  })

  it('[TC-249-32] rend le numéro que deux fiches ont en commun', () => {
    expect(telephonePartage([
      { id: 'a', nom: 'KAPIEKO', prenom: 'T ALASSANE', numeroPersonnel: '76550645' },
      { id: 'b', nom: 'KAPIOKO', prenom: 'ALLASSANE', numeroPersonnel: '76550645' },
    ])).toBe('76550645')
  })

  it('[TC-249-33] le voit à travers un champ à plusieurs numéros', () => {
    expect(telephonePartage([
      { id: 'a', nom: 'A', prenom: 'A', numeroPersonnel: '06629924/55772628' },
      { id: 'b', nom: 'B', prenom: 'B', numeroPersonnel: '55772628' },
    ])).toBe('55772628')
  })

  it('[TC-249-34] rend null quand les téléphones diffèrent ou manquent', () => {
    expect(telephonePartage([
      { id: 'a', nom: 'A', prenom: 'A', numeroPersonnel: '76550645' },
      { id: 'b', nom: 'B', prenom: 'B', numeroPersonnel: '70112233' },
    ])).toBeNull()
    expect(telephonePartage([
      { id: 'a', nom: 'A', prenom: 'A' },
      { id: 'b', nom: 'B', prenom: 'B' },
    ])).toBeNull()
  })

  /**
   * ⚠ UNE FICHE NE SE PROUVE RIEN À ELLE-MÊME. Un champ portant deux fois le
   *   même numéro (« 76550645/76550645 ») ne dit rien sur une autre fiche ; le
   *   compter comme partagé fabriquerait un doublon certain à partir d'une
   *   saisie maladroite.
   */
  it('[TC-249-35] ne compare pas une fiche avec elle-même', () => {
    expect(telephonePartage([
      { id: 'a', nom: 'A', prenom: 'A', numeroPersonnel: '76550645/76550645' },
    ])).toBeNull()
  })

  /**
   * ⚠ POURQUOI DES DOUBLONS REVIENNENT APRÈS CHAQUE NETTOYAGE.
   *   `_refuserDoublonAgent` cherche un identifiant déjà pris, mais filtre sur
   *   `registeredStoreId` : il ne regarde que la boutique courante. Le même
   *   agent enregistré au siège puis dans une agence passe sans rien
   *   déclencher. Ce drapeau mesure si le trou est réel.
   */
  it('[TC-249-37] signale une grappe étendue sur plusieurs boutiques', () => {
    const situee = situerGrappe({
      cle: 'agent:code:1234567',
      membres: [
        { id: 'a', nom: 'KONE', prenom: 'ALI', registeredStoreName: 'C2EGF SIEGE' },
        { id: 'b', nom: 'KONE', prenom: 'ALY', registeredStoreName: 'C2EGF KAMBOINSSIN' },
      ],
    }, new Map())

    expect(situee.interBoutiques).toBe(true)
    expect(situee.boutiques.sort()).toEqual(['C2EGF KAMBOINSSIN', 'C2EGF SIEGE'])
  })

  it('[TC-249-38] ne signale rien quand tout est dans la même boutique', () => {
    const situee = situerGrappe({
      cle: 'agent:code:1234567',
      membres: [
        { id: 'a', nom: 'KONE', prenom: 'ALI', registeredStoreName: 'C2EGF SIEGE' },
        { id: 'b', nom: 'KONE', prenom: 'ALY', registeredStoreName: 'C2EGF SIEGE' },
      ],
    }, new Map())

    expect(situee.interBoutiques).toBe(false)
    expect(situee.boutiques).toEqual(['C2EGF SIEGE'])
  })

  it('[TC-249-36] expose le téléphone partagé sur la grappe située', () => {
    const situee = situerGrappe({
      cle: 'agent:code:4684468',
      membres: [
        { id: 'a', nom: 'KAPIEKO', prenom: 'T ALASSANE', numeroPersonnel: '76550645' },
        { id: 'b', nom: 'KAPIOKO', prenom: 'ALLASSANE', numeroPersonnel: '76550645' },
      ],
    }, new Map())

    expect(situee.telephonePartage).toBe('76550645')
    expect(situee.ecart).toBeLessThan(0.3)
  })
})

describe('TC-249 — l’ensemble des grappes', () => {
  const jour = (n) => Date.parse(`2026-03-${String(n).padStart(2, '0')}T10:00:00Z`)

  it('[TC-249-20] groupe les grappes par situation', () => {
    const grappes = [
      { cle: 'g1', membres: [{ id: 'a', nom: 'A', prenom: 'A' }, { id: 'b', nom: 'B', prenom: 'B' }] },
      { cle: 'g2', membres: [{ id: 'c', nom: 'C', prenom: 'C' }, { id: 'd', nom: 'D', prenom: 'D' }] },
      { cle: 'g3', membres: [{ id: 'e', nom: 'E', prenom: 'E' }, { id: 'f', nom: 'F', prenom: 'F' }] },
    ]
    const operations = new Map([
      ['c', [{ createdAt: jour(1) }]],
      ['e', [{ createdAt: jour(1) }]],
      ['f', [{ createdAt: jour(20) }]],
    ])

    const { parSituation, total, fichesConcernees } = arbitrerGrappes(grappes, operations)

    expect(total).toBe(3)
    expect(fichesConcernees).toBe(6)
    expect(parSituation.get('muette').map((s) => s.cle)).toEqual(['g1'])
    expect(parSituation.get('une-seule-active').map((s) => s.cle)).toEqual(['g2'])
    expect(parSituation.get('succession').map((s) => s.cle)).toEqual(['g3'])
    expect(parSituation.get('chevauchement')).toEqual([])
  })

  /**
   * ⚠ L'ORDRE EST L'ESSENTIEL DU SERVICE RENDU. 175 grappes à relire une par
   *   une, c'est un après-midi ; les mêmes rangées de la plus ressemblante à la
   *   plus douteuse, ce sont les évidences réglées en dix minutes.
   */
  it('[TC-249-31] range chaque situation de la plus ressemblante à la plus douteuse', () => {
    const grappes = [
      {
        cle: 'lointaine',
        membres: [{ id: 'a', nom: 'SAWADOGO', prenom: 'HAMIDOU' }, { id: 'b', nom: 'BELEM', prenom: 'WENDKUNI' }],
      },
      {
        cle: 'proche',
        membres: [{ id: 'c', nom: 'KOANDA', prenom: 'HAMADO' }, { id: 'd', nom: 'KAONDA', prenom: 'AMADO' }],
      },
    ]

    const { parSituation } = arbitrerGrappes(grappes, new Map())

    expect(parSituation.get('muette').map((s) => s.cle)).toEqual(['proche', 'lointaine'])
    expect(parSituation.get('muette')[0].ecart).toBeLessThan(0.3)
  })

  it('[TC-249-21] ne situe rien sur une liste vide', () => {
    const { total, fichesConcernees, parSituation } = arbitrerGrappes([], new Map())

    expect(total).toBe(0)
    expect(fichesConcernees).toBe(0)
    // Les quatre situations existent quand même : un rapport qui n'affiche que
    // les catégories non vides laisse croire que les autres n'ont pas été vues.
    expect([...parSituation.keys()].sort()).toEqual([
      'chevauchement', 'dates-manquantes', 'muette', 'succession', 'une-seule-active',
    ])
  })
})
