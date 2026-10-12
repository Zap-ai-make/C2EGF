/**
 * arbitrageCodesAgent.mjs — un code agent, plusieurs noms : que s'est-il passé ?
 *
 * PUR : aucune I/O, aucun Firebase.
 *
 * LE PROBLÈME QUE CE MODULE NE RÉSOUT PAS
 * ───────────────────────────────────────
 * Quand « SAWADOGO HAMIDOU » et « BELEM WENDKUNI » partagent un identifiant
 * agent, deux histoires sont possibles et elles appellent des gestes opposés :
 *
 *   · le code a été MAL SAISI sur l'une des fiches → il faut la corriger ;
 *   · le commerce a CHANGÉ DE MAIN → les deux fiches sont légitimes, elles se
 *     succèdent, et les fusionner attribuerait à l'un les opérations de l'autre.
 *
 * Aucune comparaison de noms ne les sépare. C'est pourquoi ces grappes ont été
 * écartées des trois lots de fusion, et elles le restent : ce module NE FUSIONNE
 * RIEN et ne désigne aucune perdante.
 *
 * CE QU'IL APPORTE : LE TEMPS
 * ───────────────────────────
 * ⚠ LA DATE DES OPÉRATIONS TRANCHE CE QUE LES NOMS NE TRANCHENT PAS.
 *   Un commerce qui change de main produit deux périodes d'activité QUI SE
 *   SUIVENT : les opérations du premier titulaire s'arrêtent, celles du second
 *   commencent. Un code mal saisi produit deux périodes QUI SE CHEVAUCHENT —
 *   deux noms opérant le même jour sous le même identifiant, ce qu'un seul
 *   commerce ne fait pas.
 *
 *   La décision reste celle de la boutique. Mais elle cesse d'être aveugle.
 */

import { nomComplet, numerosDe } from './doublonsClients.mjs'

/**
 * Deux fiches d'une même grappe partagent-elles un TÉLÉPHONE ?
 *
 * ⚠ CE N'EST PAS UNE PREUVE D'IDENTITÉ, et l'avoir cru était une erreur.
 *   J'ai d'abord écrit ici qu'un identifiant agent ET un téléphone en commun
 *   excluaient l'homonymie. La production l'a réfuté sur-le-champ : des six
 *   grappes concernées, trois portent des noms sans aucun rapport —
 *   « ZIDA KASSOUM » et « KINDA ADJARA », « BADO BRIGITTE » et « AGENCE
 *   ORODARA ». Un téléphone partagé, c'est un couple, des associés, une agence
 *   et sa gérante. Fusionner sur ce seul critère aurait confondu deux personnes
 *   réelles.
 *
 *   Ce que le signal vaut : CROISÉ avec un écart orthographique faible, il
 *   renforce la lecture — « KAPIEKO T ALASSANE » et « KAPIOKO ALLASSANE » sur
 *   le même 76550645 ne laissent guère de doute. Seul, il ne décide de rien.
 *
 *   Rend le numéro en cause, ou `null`. Les numéros d'un même membre ne se
 *   comparent pas entre eux : une fiche portant deux fois le même numéro ne
 *   prouve rien sur personne.
 */
export function telephonePartage(membres = []) {
  const vus = new Map()

  for (const membre of membres) {
    for (const numero of new Set(numerosDe(membre?.numeroPersonnel))) {
      const proprietaire = vus.get(numero)
      if (proprietaire !== undefined && proprietaire !== membre.id) return numero
      vus.set(numero, membre.id)
    }
  }

  return null
}

/**
 * La distance d'édition entre deux textes : combien de lettres il faut ajouter,
 * retirer ou remplacer pour passer de l'un à l'autre.
 *
 * ⚠ C'EST CE QUI MANQUAIT POUR LIRE CES GRAPPES. Le premier passage cherchait
 *   des MOTS communs, et concluait « noms sans rapport » sur « KOANDA HAMADO »
 *   face à « KAONDA AMADO » — deux lettres transposées et un H envolé. En
 *   production, 175 grappes sur 175 étaient dans ce cas ou pire : aucune n'était
 *   un changement de main, toutes étaient des saisies du même nom.
 */
export function distanceEdition(a = '', b = '') {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let precedente = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i += 1) {
    const courante = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = precedente[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      courante[j] = Math.min(substitution, precedente[j] + 1, courante[j - 1] + 1)
    }
    precedente = courante
  }

  return precedente[b.length]
}

/**
 * L'écart relatif entre deux noms : de 0 (identiques) à 1 (rien en commun).
 *
 * Rapporter la distance à la longueur du plus long évite qu'une lettre de
 * différence pèse autant sur « ALI » que sur « OUEDRAOGO SOULEYMANE ».
 */
export function ecartDeNoms(a, b) {
  const x = nomComplet(a)
  const y = nomComplet(b)
  const longueur = Math.max(x.length, y.length)
  return longueur === 0 ? 0 : distanceEdition(x, y) / longueur
}

/**
 * L'écart le plus FAIBLE entre deux fiches de la grappe.
 *
 * C'est le bon résumé : il suffit que deux fiches se ressemblent pour que la
 * grappe mérite un regard. Prendre la moyenne diluerait une paire évidente dans
 * une grappe de cinq, et prendre le maximum ne dirait que l'intruse la plus
 * lointaine.
 */
export function ecartMinimal(membres = []) {
  let minimum = 1
  for (let i = 0; i < membres.length; i += 1) {
    for (let j = i + 1; j < membres.length; j += 1) {
      minimum = Math.min(minimum, ecartDeNoms(membres[i], membres[j]))
    }
  }
  return membres.length < 2 ? 1 : minimum
}

/**
 * L'instant d'une opération, en millisecondes.
 *
 * Accepte ce que Firestore rend (`Timestamp`), ce qu'un test écrit (`Date`,
 * nombre, chaîne ISO), et rend `null` sur tout le reste — une opération sans
 * date lisible ne doit pas être comptée comme datée du 1ᵉʳ janvier 1970, ce qui
 * inventerait une succession là où il n'y a qu'un champ manquant.
 */
export function instantDe(operation) {
  const brut = operation?.createdAt ?? operation?.donnees?.createdAt

  if (brut && typeof brut.toMillis === 'function') return brut.toMillis()
  if (brut instanceof Date) return Number.isNaN(brut.getTime()) ? null : brut.getTime()
  if (typeof brut === 'number' && Number.isFinite(brut)) return brut
  if (typeof brut === 'string') {
    const ms = Date.parse(brut)
    return Number.isNaN(ms) ? null : ms
  }
  if (brut && typeof brut.seconds === 'number') return brut.seconds * 1000

  return null
}

/**
 * La période d'activité d'une fiche : combien d'opérations, de quand à quand.
 *
 * `null` si la fiche n'en porte aucune — et c'est une information en soi : une
 * fiche muette n'a jamais servi sous ce code.
 */
export function periodeDe(ficheId, operationsParClient) {
  const operations = operationsParClient.get(ficheId) ?? []
  if (operations.length === 0) return null

  const instants = operations.map(instantDe).filter((ms) => ms !== null)
  if (instants.length === 0) {
    // Des opérations existent mais aucune n'est datée : on le dit au lieu de
    // fabriquer une période, sinon l'arbitrage reposerait sur une invention.
    return { nombre: operations.length, debut: null, fin: null, datees: 0 }
  }

  return {
    nombre: operations.length,
    debut: Math.min(...instants),
    fin: Math.max(...instants),
    datees: instants.length,
  }
}

/** Deux périodes se chevauchent-elles ? Une période non datée ne tranche rien. */
export const seChevauchent = (a, b) => {
  if (!a || !b || a.debut === null || b.debut === null) return false
  return a.debut <= b.fin && b.debut <= a.fin
}

/**
 * Les quatre situations qu'un code agent à plusieurs noms peut recouvrir.
 *
 * ⚠ AUCUNE N'AUTORISE UNE FUSION AUTOMATIQUE. Elles disent par quoi commencer
 *   et ce qu'il faut regarder — la correction se fait dans l'application, fiche
 *   par fiche, par quelqu'un qui connaît ces commerces.
 */
export const SITUATIONS = Object.freeze({
  MUETTE: {
    cle: 'muette',
    titre: 'Aucune fiche n\'a jamais servi',
    lecture: 'Rien ne permet de dire laquelle porte le bon code, et rien ne presse : aucune opération n\'en dépend.',
  },
  UNE_SEULE_ACTIVE: {
    cle: 'une-seule-active',
    titre: 'Une seule fiche porte des opérations',
    lecture: 'Les autres n\'ont jamais servi sous ce code. C\'est le cas le plus simple : vérifier leur code agent et le corriger.',
  },
  CHEVAUCHEMENT: {
    cle: 'chevauchement',
    titre: 'Deux noms opèrent EN MÊME TEMPS sous le même code',
    lecture: 'Un seul commerce ne fait pas ça. Une des fiches porte un code qui n\'est pas le sien — à corriger, pas à fusionner.',
  },
  SUCCESSION: {
    cle: 'succession',
    titre: 'Les périodes d\'activité SE SUIVENT',
    lecture: 'Le commerce a probablement changé de main. Les deux fiches sont légitimes : NE PAS fusionner, les opérations de chacune lui appartiennent.',
  },
  // ⚠ LA SITUATION QU'IL FAUT NOMMER AU LIEU DE LA DEVINER.
  //   `seChevauchent` rend `false` quand une période n'est pas datée. Sans cette
  //   catégorie, deux fiches actives dont les opérations manquent de `createdAt`
  //   tomberaient donc en « succession » — et le rapport annoncerait un
  //   changement de main déduit de dates absentes. L'erreur serait du bon côté
  //   (succession dit « ne pas fusionner »), mais elle raconterait une histoire
  //   fausse, et c'est sur ces histoires que la boutique va décider.
  DATES_MANQUANTES: {
    cle: 'dates-manquantes',
    titre: 'Plusieurs fiches actives, mais sans dates lisibles',
    lecture: 'Leurs opérations n\'ont pas de date exploitable : impossible de dire si elles se suivent ou se chevauchent. Il faut ouvrir les fiches.',
  },
})

/**
 * Situer une grappe, et rendre de quoi la juger.
 *
 * L'ordre des tests n'est pas indifférent : le chevauchement est examiné AVANT
 * la succession, parce qu'il suffit d'un seul recouvrement entre deux fiches
 * pour écarter l'hypothèse du changement de main.
 */
export function situerGrappe(grappe, operationsParClient = new Map()) {
  const fiches = grappe.membres.map((membre) => ({
    id: membre.id,
    nom: nomComplet(membre),
    libelle: `${membre.nom ?? ''} ${membre.prenom ?? ''}`.trim(),
    telephone: String(membre.numeroPersonnel ?? '').trim(),
    boutique: String(membre.registeredStoreName ?? membre.registeredStoreId ?? '').trim(),
    periode: periodeDe(membre.id, operationsParClient),
  }))

  // ⚠ POURQUOI DES DOUBLONS CONTINUENT D'APPARAÎTRE.
  //   Le garde-fou de la saisie (`_refuserDoublonAgent`) cherche un identifiant
  //   déjà pris, mais il filtre sur `registeredStoreId` : il ne regarde QUE la
  //   boutique courante. Le même agent enregistré au siège puis dans une agence
  //   passe donc sans rien déclencher. Compter les grappes dont les fiches sont
  //   réparties sur plusieurs boutiques dit si ce trou est théorique ou réel.
  const boutiques = new Set(fiches.map((f) => f.boutique).filter(Boolean))

  const actives = fiches.filter((f) => f.periode !== null)

  let situation
  if (actives.length === 0) situation = SITUATIONS.MUETTE
  else if (actives.length === 1) situation = SITUATIONS.UNE_SEULE_ACTIVE
  else {
    const chevauche = actives.some((a, i) => actives.slice(i + 1).some((b) => seChevauchent(a.periode, b.periode)))
    if (chevauche) situation = SITUATIONS.CHEVAUCHEMENT
    // Sans dates, « ne se chevauchent pas » ne veut pas dire « se suivent ».
    else if (actives.some((f) => f.periode.debut === null)) situation = SITUATIONS.DATES_MANQUANTES
    else situation = SITUATIONS.SUCCESSION
  }

  return {
    cle: grappe.cle,
    situation: situation.cle,
    // Du plus utilisé au moins utilisé : la fiche à corriger est presque
    // toujours en bas de cette liste, et la boutique lit le haut en premier.
    fiches: [...fiches].sort((a, b) => (b.periode?.nombre ?? 0) - (a.periode?.nombre ?? 0)),
    actives: actives.length,
    // L'écart orthographique le plus faible de la grappe : près de 0, c'est le
    // même nom saisi deux fois ; près de 1, ce sont deux noms.
    ecart: ecartMinimal(grappe.membres),
    // Le téléphone partagé, s'il y en a un : la preuve qui se passe de seuil.
    telephonePartage: telephonePartage(grappe.membres),
    boutiques: [...boutiques],
    interBoutiques: boutiques.size > 1,
  }
}

/**
 * Toutes les grappes situées, groupées par situation et TRIÉES PAR ÉCART.
 *
 * ⚠ L'ORDRE EST L'ESSENTIEL DU SERVICE RENDU. 175 grappes à relire une par une,
 *   c'est un après-midi perdu ; les mêmes rangées de la plus ressemblante à la
 *   plus douteuse, ce sont les évidences réglées en dix minutes. Aucune n'est
 *   fusionnée pour autant — l'écart aide à lire, il ne décide pas.
 */
export function arbitrerGrappes(grappes = [], operationsParClient = new Map()) {
  const situees = grappes.map((grappe) => situerGrappe(grappe, operationsParClient))
  const parSituation = new Map(Object.values(SITUATIONS).map((s) => [s.cle, []]))
  for (const situee of situees) parSituation.get(situee.situation).push(situee)
  for (const liste of parSituation.values()) liste.sort((a, b) => a.ecart - b.ecart)

  return {
    situees,
    parSituation,
    total: situees.length,
    fichesConcernees: situees.reduce((n, s) => n + s.fiches.length, 0),
  }
}
