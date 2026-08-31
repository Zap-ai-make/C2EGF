/**
 * TC-203 — Le rapprochement de la position dealer (spec S4)
 *
 * L'identité que cet écran affiche :
 *
 *     stock + liquidité + dehors boutiques + en attente
 *         = fonds d'ouverture + envoyé − revenu
 *
 * Elle a quatre termes et non deux, et chacun des deux termes réconciliateurs a
 * sa découverte :
 *
 *   • « en attente » (S2) — la boutique est débitée à la CRÉATION d'un retour,
 *     le compteur du dealer n'avance qu'à sa CONFIRMATION ;
 *   • « dehors boutiques » (31/08/2026) — une transaction client non terminée
 *     n'a fait passer qu'une de ses deux jambes.
 *
 * Ces tests tiennent les deux, et surtout les QUATRE cas où l'écran doit
 * REFUSER de se prononcer — un total faux qui s'annonce juste est pire que pas
 * de total.
 */

import { describe, it, expect } from 'vitest'
import { rapprocherPosition, ETATS, RAISONS } from '../../src/utils/positionDealer'

const flux = (envoyeCumul, revenuCumul) => ({
  envoyeCumul,
  revenuCumul,
  dehors: envoyeCumul - revenuCumul,
  amorce: envoyeCumul > 0 || revenuCumul > 0,
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TC-203-A — « mon argent dehors »', () => {
// ═══════════════════════════════════════════════════════════════════════════

  it('[PO-01] vaut envoyé moins revenu, et n’est jamais découpé par ressource', () => {
    const p = rapprocherPosition({ flux: flux(341200000, 142800000) })

    expect(p.envoye).toBe(341200000)
    expect(p.revenu).toBe(142800000)
    expect(p.dehors).toBe(198400000)
    // Un seul chiffre : au comptoir, le stock envoyé DEVIENT de la liquidité.
    expect(p).not.toHaveProperty('dehorsStock')
  })

  it('[PO-02] les deux termes affichés font EXACTEMENT le montant affiché', () => {
    const p = rapprocherPosition({ flux: flux(500000000, 100000000) })
    expect(p.envoye - p.revenu).toBe(p.dehors)
  })

  it('[PO-03] laisse « dehors » négatif au lieu de le masquer', () => {
    // Compteurs mis en service alors que des retours étaient en cours : le
    // revenu peut dépasser l'envoyé. Forcer à 0 fabriquerait une donnée fausse.
    expect(rapprocherPosition({ flux: flux(1000, 5000) }).dehors).toBe(-4000)
  })

  it('[PO-04] traite NaN et les valeurs absentes comme zéro, jamais comme NaN', () => {
    const p = rapprocherPosition({ flux: { envoyeCumul: 'x', revenuCumul: undefined } })
    expect(p.envoye).toBe(0)
    expect(p.revenu).toBe(0)
    expect(p.dehors).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TC-203-B — le rapprochement, quand il se prononce', () => {
// ═══════════════════════════════════════════════════════════════════════════

  it('[RA-01] concorde quand caisses + transit égalent l’argent dehors', () => {
    const p = rapprocherPosition({
      flux: flux(10000000, 2000000),
      sommeStock: 5000000,
      sommeLiquidite: 2500000,
      enTransit: 500000,
    })

    expect(p.sommeCaisses).toBe(7500000)
    expect(p.ecart).toBe(0)
    expect(p.etat).toBe(ETATS.CONCORDANT)
  })

  it('[RA-02] RÈGLE — le transit est le terme qui ferme l’identité', () => {
    // Le même jeu SANS le transit ne concorde plus. C'est la preuve que la
    // ligne « en transit » n'est pas décorative : la retirer casse l'égalité
    // à chaque retour créé et pas encore confirmé.
    const sansTransit = rapprocherPosition({
      flux: flux(10000000, 2000000),
      sommeStock: 5000000,
      sommeLiquidite: 2500000,
      enTransit: 0,
    })

    expect(sansTransit.ecart).toBe(-500000)
    expect(sansTransit.etat).toBe(ETATS.ANOMALIE)
  })

  it('[RA-03] nomme un écart POSITIF : les caisses tiennent plus que les compteurs', () => {
    const p = rapprocherPosition({
      flux: flux(198400000, 0),
      sommeStock: 128242009,
      sommeLiquidite: 128863283,
      enTransit: 2150000,
    })

    expect(p.etat).toBe(ETATS.ANTERIEUR)
    expect(p.ecart).toBe(128242009 + 128863283 + 2150000 - 198400000)
    expect(p.ecart).toBeGreaterThan(0)
  })

  it('[RA-04] distingue l’écart NÉGATIF, qu’aucun fonds d’ouverture n’explique', () => {
    const p = rapprocherPosition({
      flux: flux(300000000, 0),
      sommeStock: 100000000,
      sommeLiquidite: 50000000,
      enTransit: 0,
    })

    expect(p.etat).toBe(ETATS.ANOMALIE)
    expect(p.ecart).toBe(-150000000)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TC-203-C — les trois refus de se prononcer', () => {
// ═══════════════════════════════════════════════════════════════════════════

  it('[RA-05] refuse tant que les compteurs n’ont rien enregistré', () => {
    const p = rapprocherPosition({
      flux: flux(0, 0),
      sommeStock: 128000000,
      sommeLiquidite: 128000000,
    })

    expect(p.etat).toBe(ETATS.INDISPONIBLE)
    expect(p.raison).toBe(RAISONS.COMPTEURS_NEUFS)
    expect(p.ecart).toBeNull()
  })

  it('[RA-06] refuse tant qu’une caisse est illisible', () => {
    const p = rapprocherPosition({
      flux: flux(10000000, 2000000),
      sommeStock: 5000000,
      sommeLiquidite: 2500000,
      enTransit: 500000,
      illisibles: 1,
    })

    // Le jeu concorderait à l'euro près (cf. RA-01) : c'est précisément le cas
    // dangereux, celui où un total incomplet s'annoncerait juste.
    expect(p.etat).toBe(ETATS.INDISPONIBLE)
    expect(p.raison).toBe(RAISONS.CAISSES_INCOMPLETES)
    expect(p.ecart).toBeNull()
  })

  it('[RA-07] refuse quand la lecture du réseau a échoué, et rend « null » — pas 0', () => {
    const p = rapprocherPosition({ flux: flux(198400000, 0), caissesLues: false })

    expect(p.etat).toBe(ETATS.INDISPONIBLE)
    expect(p.raison).toBe(RAISONS.CAISSES_INDISPONIBLES)
    // Zéro se lirait « les caisses sont vides » : c'est un montant, et il est
    // faux. `null` s'affiche « — » et ne se confond avec rien.
    expect(p.sommeCaisses).toBeNull()
    expect(p.sommeStock).toBeNull()
    expect(p.sommeLiquidite).toBeNull()
    // L'argent dehors, lui, reste juste : il ne vient pas du réseau.
    expect(p.dehors).toBe(198400000)
  })

  it('[RA-08] la lecture échouée l’emporte sur toutes les autres raisons', () => {
    const p = rapprocherPosition({ flux: flux(0, 0), illisibles: 3, caissesLues: false })
    expect(p.raison).toBe(RAISONS.CAISSES_INDISPONIBLES)
  })

  it('[RA-09] « compteurs neufs » passe avant « caisses incomplètes »', () => {
    // Les deux sont vrais le jour de la mise en service. C'est le premier qui
    // explique l'écran ; l'autre serait un détail technique là où l'utilisateur
    // attend « ça vient de démarrer ».
    const p = rapprocherPosition({ flux: flux(0, 0), illisibles: 2 })
    expect(p.raison).toBe(RAISONS.COMPTEURS_NEUFS)
  })

  it('[RA-10] ne casse pas sans argument du tout', () => {
    const p = rapprocherPosition()
    expect(p.etat).toBe(ETATS.INDISPONIBLE)
    expect(p.raison).toBe(RAISONS.COMPTEURS_NEUFS)
    expect(p.dehors).toBe(0)
  })
})

// ===========================================================================
// TC-203-D — « dehors boutiques », le quatrième terme de l'identité
//
// Ajouté le 31/08/2026. Les quatorze tests ci-dessus n'ont PAS bougé : le
// nouveau terme vaut 0 par défaut, donc tout ce qui était vrai le reste. Ce
// bloc tient ce qu'il apporte.
//
// ⚠ Deux choses s'appellent « dehors » ici, et c'est le piège du fichier :
//   `dehors` est l'argent DU DEALER (envoyé − revenu), `sommeDehors` celui DES
//   BOUTIQUES (ce que leurs clients leur doivent, moins ce qu'elles leur
//   doivent). Ils sont dans les deux membres OPPOSÉS de l'égalité. Les
//   confondre inverserait le signe de l'écart — d'où [DH-02].
// ===========================================================================

describe('TC-203-D — le dehors des boutiques', () => {
  const flux = { envoyeCumul: 10_000_000, revenuCumul: 0, amorce: true }

  it('[DH-01] le total des caisses NE CONTIENT PAS le dehors, et c’est le sujet', () => {
    // Changé le 01/09/2026 sur une remarque du dealer qui est simplement juste :
    // cet argent est chez les clients, il n'est dans aucune caisse. Le total ne
    // prétend plus le contenir — il vaut ses deux lignes, exactement.
    const p = rapprocherPosition({
      flux, sommeStock: 3_000_000, sommeLiquidite: 2_000_000, sommeDehors: 500_000,
    })
    expect(p.sommeStock + p.sommeLiquidite).toBe(p.sommeCaisses)
    expect(p.sommeCaisses).toBe(5_000_000)
    // Il reste lu, affiché sous le filet, et il reste dans le CALCUL de l'écart.
    expect(p.sommeDehors).toBe(500_000)
  })

  it('[DH-02] il s’AJOUTE aux caisses, il ne se retranche pas', () => {
    // Le signe est tout : ces transactions ont retiré du stock sans ajouter de
    // liquidité. La somme des caisses est donc trop BASSE, et le terme la
    // relève. L'inverser doublerait l'écart au lieu de l'annuler.
    const sans = rapprocherPosition({ flux, sommeStock: 9_000_000, sommeLiquidite: 0 })
    const avec = rapprocherPosition({
      flux, sommeStock: 9_000_000, sommeLiquidite: 0, sommeDehors: 1_000_000,
    })
    expect(sans.ecart).toBe(-1_000_000)
    expect(avec.ecart).toBe(0)
    expect(avec.etat).toBe(ETATS.CONCORDANT)
  })

  it('[DH-03] RÈGLE — c’est bien lui qui referme l’identité', () => {
    // Le pendant de [RA-02] pour le second terme réconciliateur : le même jeu
    // de chiffres, une fois avec, une fois sans, et l'écart passe de zéro à
    // une anomalie. Preuve qu'il n'est pas décoratif.
    const jeu = {
      flux: { envoyeCumul: 8_000_000, revenuCumul: 500_000, amorce: true },
      sommeStock: 5_000_000, sommeLiquidite: 2_000_000, enTransit: 100_000,
    }
    expect(rapprocherPosition({ ...jeu, sommeDehors: 400_000 }).ecart).toBe(0)
    const sans = rapprocherPosition(jeu)
    expect(sans.ecart).toBe(-400_000)
    expect(sans.etat).toBe(ETATS.ANOMALIE)
  })

  it('[DH-04] un dehors NÉGATIF abaisse l’ÉCART, et c’est correct', () => {
    // Plus de retraits en attente que de dépôts : les boutiques ont encaissé du
    // stock sans encore payer. Depuis le 01/09/2026 il n'abaisse plus le TOTAL
    // affiché — il n'y est plus — mais il abaisse toujours l'écart, qui est ce
    // qu'il corrige réellement. Le terme a changé de place, pas d'effet.
    const p = rapprocherPosition({
      flux, sommeStock: 11_000_000, sommeLiquidite: 0, sommeDehors: -1_000_000,
    })
    expect(p.sommeCaisses).toBe(11_000_000)
    expect(p.ecart).toBe(0)
  })

  it('[DH-05] absent, il vaut zéro et rien ne change', () => {
    const p = rapprocherPosition({ flux, sommeStock: 10_000_000, sommeLiquidite: 0 })
    expect(p.sommeDehors).toBe(0)
    expect(p.ecart).toBe(0)
  })

  it('[DH-06] une valeur illisible vaut zéro, jamais NaN', () => {
    for (const v of ['x', undefined, NaN, Infinity, null]) {
      const p = rapprocherPosition({ flux, sommeStock: 10_000_000, sommeDehors: v })
      expect(p.sommeDehors).toBe(0)
      expect(Number.isNaN(p.ecart)).toBe(false)
    }
  })
})

describe('TC-203-E — le quatrième refus', () => {
  const flux = { envoyeCumul: 10_000_000, revenuCumul: 0, amorce: true }

  it('[RA-11] lecture des non terminées échouée → on refuse de rapprocher', () => {
    // Compter 0 reviendrait à affirmer qu'aucune boutique du réseau n'a
    // d'opération en cours — l'affirmation la moins probable des deux — et
    // l'écart afficherait alors exactement le trou qu'on vient d'ouvrir.
    const p = rapprocherPosition({
      flux, sommeStock: 3_000_000, sommeLiquidite: 2_000_000, dehorsLu: false,
    })
    expect(p.etat).toBe(ETATS.INDISPONIBLE)
    expect(p.raison).toBe(RAISONS.DEHORS_INDISPONIBLE)
    expect(p.ecart).toBeNull()
  })

  it('[RA-12] seul le dehors devient inconnu : les caisses restent justes', () => {
    const p = rapprocherPosition({
      flux, sommeStock: 3_000_000, sommeLiquidite: 2_000_000, dehorsLu: false,
    })
    expect(p.sommeStock).toBe(3_000_000)
    expect(p.sommeLiquidite).toBe(2_000_000)
    expect(p.sommeDehors).toBeNull()
    // ⚠ CHANGÉ le 01/09/2026, et c'est un gain net. Tant que ce total valait
    //   stock + liquidité + dehors, un « dehors » illisible le rendait
    //   incalculable et l'écran affichait « — » sur un chiffre qu'il
    //   connaissait. Il ne vaut plus que ses deux lignes : il reste juste.
    expect(p.sommeCaisses).toBe(5_000_000)
    // La colonne de gauche vient des compteurs, pas du réseau : elle ne bouge pas.
    expect(p.dehors).toBe(10_000_000)
  })

  it('[RA-13] le réseau illisible l’emporte sur les non terminées manquantes', () => {
    const p = rapprocherPosition({ flux, caissesLues: false, dehorsLu: false })
    expect(p.raison).toBe(RAISONS.CAISSES_INDISPONIBLES)
  })

  it('[RA-14] « compteurs neufs » l’emporte sur les non terminées manquantes', () => {
    // Sur une mise en service les deux sont vrais, et c'est « ça vient de
    // démarrer » qui explique l'écran.
    const p = rapprocherPosition({
      flux: { envoyeCumul: 0, revenuCumul: 0, amorce: false }, dehorsLu: false,
    })
    expect(p.raison).toBe(RAISONS.COMPTEURS_NEUFS)
  })

  it('[RA-15] les non terminées manquantes l’emportent sur une caisse illisible', () => {
    // Le plus gros trou d'abord : un terme entier du total contre un montant.
    const p = rapprocherPosition({ flux, dehorsLu: false, illisibles: 3 })
    expect(p.raison).toBe(RAISONS.DEHORS_INDISPONIBLE)
  })
})

// ===========================================================================
// TC-203-F — « en route », le terme qui est dans LES DEUX membres
//
// Ajoute le 01/09/2026. Les tests ci-dessus n'ont pas bouge : le nouveau terme
// vaut 0 par defaut, donc tout ce qui etait vrai le reste ([ER-05] le tient).
//
// LE FAIT VERIFIE DANS LE CODE : `confirmDealerRequest.js` debite la cuve du
// dealer ET credite la boutique dans un seul `runTransaction`, a la
// confirmation. Avant elle, le CRM ne bouge rien. Mais le transfert, lui, a ete
// fait au guichet : l'argent a quitte le dealer sans etre arrive chez la
// boutique. Il est dehors, et il est du au reseau — d'ou sa presence des deux
// cotes de l'egalite.
//
// ⚠ C'EST [ER-02] QUI PORTE TOUT CE BLOC. Un terme present dans les deux
//   membres doit s'annuler dans l'ecart. S'il ne s'annulait pas, on aurait
//   fabrique une anomalie de sa valeur exacte sur un argent qui n'a pas bouge —
//   c'est-a-dire envoye le dealer chercher tous les matins un trou qui n'existe
//   pas. C'est la promesse faite au client avant d'ecrire ce terme.
// ===========================================================================

describe('TC-203-F — les ravitaillements envoyes, pas encore confirmes', () => {
  const flux = { envoyeCumul: 10_000_000, revenuCumul: 2_000_000, amorce: true }
  const jeu = { flux, sommeStock: 5_000_000, sommeLiquidite: 2_000_000, sommeDehors: 500_000 }

  it('[ER-01] il ne monte AUCUN des deux totaux : il vit sous le filet', () => {
    // Il les a montes pendant une demi-journee, le 01/09/2026, avant que le
    // dealer ne corrige la lecture : cet argent n'est ni dans une caisse, ni
    // revenu dans ses mains. Aucun des deux grands nombres ne le contient.
    const sans = rapprocherPosition(jeu)
    const avec = rapprocherPosition({ ...jeu, enRoute: 300_000 })

    expect(avec.dehors).toBe(sans.dehors)
    expect(avec.sommeCaisses).toBe(sans.sommeCaisses)
    // Mais il est LU et rendu : l'ecran doit pouvoir l'annoncer sous le filet.
    expect(avec.enRoute).toBe(300_000)
  })

  it('[ER-02] REGLE — l’ecart ne bouge pas d’un franc, quelle que soit sa valeur', () => {
    // La promesse. Un terme des deux membres s'annule ; s'il ne s'annulait pas,
    // ajouter cette ligne aurait fabrique une anomalie sur un argent immobile.
    const reference = rapprocherPosition(jeu).ecart
    for (const montant of [0, 1, 300_000, 87_250_787, Number.MAX_SAFE_INTEGER - 1e9]) {
      const p = rapprocherPosition({ ...jeu, enRoute: montant })
      expect(p.ecart).toBe(reference)
      expect(p.etat).toBe(rapprocherPosition(jeu).etat)
    }
  })

  it('[ER-03] les deux lignes de gauche font EXACTEMENT le total de gauche', () => {
    const p = rapprocherPosition({ ...jeu, enRoute: 300_000 })
    expect(p.envoye - p.revenu).toBe(p.dehors)
  })

  it('[ER-04] les deux lignes de droite font EXACTEMENT le total de droite', () => {
    const p = rapprocherPosition({ ...jeu, enRoute: 300_000 })
    expect(p.sommeStock + p.sommeLiquidite).toBe(p.sommeCaisses)
  })

  it('[ER-11] REGLE — l’ecart n’est PAS la difference des deux totaux affiches', () => {
    // Le prix assume de l'arbitrage du 01/09/2026, ecrit ici pour que personne
    // ne le « corrige » par erreur. Trois termes reconciliateurs vivent hors
    // des totaux : qui recalculerait `sommeCaisses - dehors` obtiendrait un
    // nombre faux, et le croirait juste parce qu'il additionne ce qu'il voit.
    const p = rapprocherPosition({ ...jeu, enRoute: 300_000, enTransit: 100_000 })
    expect(p.sommeCaisses - p.dehors).not.toBe(p.ecart)
    expect(p.ecart).toBe(p.sommeCaisses + p.sommeDehors + p.enTransit - p.dehors)
  })

  it('[ER-05] absent, il vaut zero et rien de ce qui precede ne change', () => {
    const p = rapprocherPosition(jeu)
    expect(p.enRoute).toBe(0)
    expect(p.dehors).toBe(8_000_000)
    expect(p.sommeCaisses).toBe(7_000_000)
  })

  it('[ER-06] une valeur illisible vaut zero, jamais NaN', () => {
    for (const v of ['x', undefined, NaN, Infinity, null, {}]) {
      const p = rapprocherPosition({ ...jeu, enRoute: v })
      expect(p.enRoute).toBe(0)
      expect(Number.isNaN(p.ecart)).toBe(false)
    }
  })

  it('[ER-07] il n’ouvre AUCUN cinquieme refus', () => {
    // Le corollaire de [ER-02], et la raison assumee de ne pas ajouter de
    // refus : un « en route » manquant coute deux totaux sous-estimes, pas un
    // ecart faux. `sommeDehors`, qui n'entre que d'un cote, fait refuser — pas
    // celui-ci. Se taire ici serait payer un ecran muet pour rien.
    const p = rapprocherPosition({ ...jeu, enRoute: 0 })
    expect(p.etat).not.toBe(ETATS.INDISPONIBLE)
    expect(p.raison).toBeNull()
  })

  it('[ER-08] il ne retourne jamais un concordant en anomalie', () => {
    // Le jeu ci-dessous concorde exactement. Aucun montant en route ne doit
    // pouvoir le faire basculer : c'est [ER-02] vu du cote de l'utilisateur.
    const concordant = {
      flux: { envoyeCumul: 8_000_000, revenuCumul: 500_000, amorce: true },
      sommeStock: 5_000_000, sommeLiquidite: 2_000_000, sommeDehors: 400_000, enTransit: 100_000,
    }
    expect(rapprocherPosition(concordant).etat).toBe(ETATS.CONCORDANT)
    for (const montant of [1, 300_000, 50_000_000]) {
      expect(rapprocherPosition({ ...concordant, enRoute: montant }).etat).toBe(ETATS.CONCORDANT)
    }
  })

  it('[ER-09] reseau illisible : il reste un nombre, seul le total passe a null', () => {
    // Il ne vient pas de la lecture du reseau mais des demandes du dealer, qui
    // a reussi. Le passer a `null` pour faire une colonne homogene effacerait un
    // montant qu'on connait.
    const p = rapprocherPosition({ ...jeu, enRoute: 300_000, caissesLues: false })
    expect(p.enRoute).toBe(300_000)
    expect(p.sommeCaisses).toBeNull()
    // Et la colonne de gauche, elle, reste entierement juste.
    expect(p.dehors).toBe(8_000_000)
  })

  it('[ER-10] non terminees manquantes : les deux totaux restent justes', () => {
    const p = rapprocherPosition({ ...jeu, enRoute: 300_000, dehorsLu: false })
    expect(p.raison).toBe(RAISONS.DEHORS_INDISPONIBLE)
    expect(p.enRoute).toBe(300_000)
    expect(p.dehors).toBe(8_000_000)
    expect(p.sommeCaisses).toBe(7_000_000)
    expect(p.sommeDehors).toBeNull()
  })
})
