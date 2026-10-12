/**
 * doublonsClients.mjs — reconnaître deux fiches qui désignent la même personne.
 *
 * PUR : aucune I/O, aucun Firebase. Le script `scripts/auditClients.mjs` apporte
 * les données, ce module ne fait que les ranger. C'est la même séparation que
 * pour `assertResetProject` — une règle qui décide du sort de milliers de fiches
 * doit pouvoir être éprouvée sans base.
 *
 * POURQUOI QUATRE RÈGLES, ET NON UNE
 * ──────────────────────────────────
 * « Doublon » n'a pas de définition unique ici, et en choisir une à l'aveugle
 * reviendrait à décider du nombre de suppressions avant de l'avoir mesuré. Les
 * quatre règles sont donc évaluées EN PARALLÈLE sur le même jeu, chacune rendant
 * son compte. C'est l'écart entre ces comptes — rapproché des ~3 000 fiches en
 * trop — qui dira ce qui s'est réellement passé.
 *
 * AUCUNE RÈGLE N'EST APPLIQUÉE ICI. Ce module décrit ; il ne supprime pas, ne
 * fusionne pas, ne classe pas une fiche comme perdante. La décision vient après
 * le rapport, et elle appartient à la boutique.
 *
 * ⚠ LA SEULE DÉPENDANCE EST VOULUE. `champsAgent` vient de l'application, et
 *   c'est délibéré : c'est la fonction qui décide, à l'écran, ce qui est un code
 *   agent et ce qui est un numéro. L'audit doit lire les fiches exactement comme
 *   le logiciel les montre, sinon son rapport porte sur une autre base que celle
 *   que la boutique a sous les yeux. Elle ne fait aucune I/O : ce module reste
 *   éprouvable sans Firebase.
 */
import { champsAgent } from '../../src/utils/agentFields.js'

/**
 * Le pli d'un texte : sans accents, sans casse, espaces réduits.
 *
 * « OUÉDRAOGO  Aïssata » et « ouedraogo aissata » sont la même personne saisie
 * deux fois. Comparer les chaînes brutes ne l'aurait jamais vu.
 */
export const plier = (valeur) => String(valeur ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()

/** Les chiffres seuls : « +226 70 11 22 33 » et « 70112233 » sont un même numéro. */
export const chiffres = (valeur) => String(valeur ?? '').replace(/\D/g, '')

/**
 * LES NUMÉROS d'un champ, au pluriel — un champ peut en contenir plusieurs.
 *
 * ⚠ VU EN PRODUCTION : « 06629924/55772628 », « 07796503/66553459/75928339 ».
 *   La boutique note les deux ou trois lignes d'un commerce dans la même case,
 *   séparées par une barre. Passer ça à `chiffres()` donne « 0662992455772628 »,
 *   un nombre à seize chiffres traité comme UN numéro — si bien qu'une fiche
 *   portant « 06629924 » seul et une autre portant « 06629924/55772628 » ne se
 *   rencontrent jamais, alors que c'est le même téléphone.
 *
 *   On scinde donc sur tout ce qui sépare visiblement deux numéros (barre,
 *   virgule, point-virgule, « et », saut de ligne) avant de nettoyer chacun.
 */
export const numerosDe = (valeur) => String(valeur ?? '')
  .split(/[/,;\n|]+|\bet\b|\bou\b/i)
  .map(chiffres)
  .filter((n) => n.length >= 8)

/**
 * Les valeurs d'agent BRUTES d'une fiche, les trois champs confondus.
 *
 * ⚠ À NE PAS CONFONDRE AVEC `identiteAgent`, juste en dessous. Celle-ci ramasse
 *   tout ce qui traîne dans les trois champs ; celle-là donne l'identité UNIQUE
 *   d'une fiche selon la règle de la boutique. L'écart entre les deux est une
 *   mesure utile — il dit si une valeur reste coincée dans `orange` alors que
 *   l'application, elle, ne la lit plus (voir `champsAgent`, qui teste la
 *   PRÉSENCE des clés et non leur valeur).
 */
export const valeursAgent = (fiche) => [fiche?.codeAgent, fiche?.numeroAgent, fiche?.orange]
  .map(chiffres)
  .filter((v) => v.length > 0)

/**
 * L'IDENTITÉ AGENT D'UNE FICHE : LE CODE D'ABORD, LE NUMÉRO À DÉFAUT.
 *
 * C'est la règle que la boutique a donnée : « on compare d'abord les codes,
 * ensuite le numéro si pas de code ». Une fiche a donc UNE identité, pas une
 * liste — et c'est tout l'intérêt.
 *
 * ⚠ UNE SEULE CLÉ PAR FICHE CORRIGE AUSSI UN DÉFAUT DE COMPTAGE. La version
 *   précédente rendait une clé par valeur trouvée. Une fiche migrée qui garde
 *   `codeAgent` ET `orange` à la même valeur produisait donc deux fois la même
 *   clé, s'ajoutait deux fois à sa propre grappe, et apparaissait comme un
 *   doublon d'elle-même — gonflant le « en trop » sans qu'aucune fiche réelle
 *   soit en double.
 *
 * ⚠ LE TRI VIENT DE L'APPLICATION, PAS D'UNE COPIE. `champsAgent` est la
 *   fonction que l'écran utilise pour décider ce qui est un code et ce qui est
 *   un numéro. L'audit l'importe telle quelle : réécrire ici la règle des huit
 *   chiffres ferait deux vérités, et le jour où la boutique corrige la longueur,
 *   le rapport rangerait les fiches autrement que le logiciel les affiche.
 *
 * Le TYPE fait partie de la clé : on compare un code à un code, un numéro à un
 * numéro. Deux fiches portant la même suite de chiffres, l'une comme code et
 * l'autre comme numéro, ne sont donc PAS réunies ici — `collisionsCodeNumero`
 * les compte à part, pour que ce choix reste un choix et non un angle mort.
 */
export function identiteAgent(fiche) {
  const { codeAgent, numeroAgent } = champsAgent(fiche)

  const code = chiffres(codeAgent)
  if (code) return { type: 'code', valeur: code }

  const numero = chiffres(numeroAgent)
  if (numero) return { type: 'numero', valeur: numero }

  return null
}

/** La clé de comparaison d'une fiche, ou `null` si elle n'a aucune identité agent. */
export const cleAgent = (fiche) => {
  const identite = identiteAgent(fiche)
  return identite ? `agent:${identite.type}:${identite.valeur}` : null
}

/**
 * Les suites de chiffres qui existent à la fois comme CODE et comme NUMÉRO.
 *
 * Comparer un code à un code est le bon choix par défaut, mais il a un coût : si
 * la boutique a saisi le même identifiant une fois dans la bonne case et une
 * fois dans l'autre, les deux fiches ne se rencontrent jamais. Ce décompte dit
 * si ce cas existe vraiment, et combien de fiches il concerne.
 */
export function collisionsCodeNumero(fiches = []) {
  const codes = new Map()
  const numeros = new Map()

  for (const fiche of fiches) {
    const identite = identiteAgent(fiche)
    if (!identite) continue
    const carte = identite.type === 'code' ? codes : numeros
    carte.set(identite.valeur, (carte.get(identite.valeur) || 0) + 1)
  }

  const valeurs = [...codes.keys()].filter((v) => numeros.has(v)).sort()
  return {
    valeurs,
    fichesConcernees: valeurs.reduce((n, v) => n + codes.get(v) + numeros.get(v), 0),
  }
}

/**
 * Les quatre lectures de l'identité, de la plus stricte à la plus large.
 *
 * `cles` rend une LISTE : une fiche peut porter un code agent ET un numéro
 * agent, et se heurter à deux fiches différentes. Rendre une clé unique
 * masquerait l'une des deux collisions.
 */
export const REGLES = Object.freeze([
  {
    cle: 'agent',
    titre: 'Même code agent — à défaut, même numéro agent',
    pourquoi: 'L\'identité la plus forte : deux fiches qui partagent un identifiant agent désignent le même commerce. Le code d\'abord, le numéro seulement si la fiche n\'a pas de code.',
    cles: (fiche) => {
      const cle = cleAgent(fiche)
      return cle ? [cle] : []
    },
  },
  {
    cle: 'telephone',
    titre: 'Même numéro personnel',
    pourquoi: 'Un téléphone appartient à une personne. Deux fiches qui le partagent sont presque toujours la même.',
    cles: (fiche, contexte) => {
      // UNE CLÉ PAR NUMÉRO : un champ peut en contenir plusieurs (voir
      // `numerosDe`). `numerosDe` écarte déjà les fragments de moins de huit
      // chiffres, qui agglomèreraient des inconnus autour d'une saisie
      // incomplète.
      //
      // ⚠ Un numéro porté par vingt commerces aux noms sans rapport n'identifie
      //   personne : c'est une valeur de remplissage. Le garder ferait fusionner
      //   des commerces distincts — le défaut exact qu'une grappe de 66 fiches
      //   aux noms tous différents a révélé en production.
      const exclus = contexte?.numerosExclus
      return numerosDe(fiche?.numeroPersonnel)
        .filter((tel) => !exclus?.has(tel))
        .map((tel) => `tel:${tel}`)
    },
  },
  {
    cle: 'nom',
    titre: 'Mêmes nom et prénom',
    pourquoi: 'La règle la plus large. Elle attrape les vrais doublons ET les homonymes — à ne jamais appliquer seule.',
    cles: (fiche) => {
      const nom = plier(fiche?.nom)
      const prenom = plier(fiche?.prenom)
      return nom && prenom ? [`nom:${nom}|${prenom}`] : []
    },
  },
  {
    cle: 'nom-telephone',
    titre: 'Mêmes nom, prénom ET numéro personnel',
    pourquoi: 'Le croisement des deux précédentes : quasi aucun homonyme ne survit, c\'est la règle la plus sûre à appliquer.',
    cles: (fiche, contexte) => {
      const nom = plier(fiche?.nom)
      const prenom = plier(fiche?.prenom)
      if (!nom || !prenom) return []
      const exclus = contexte?.numerosExclus
      return numerosDe(fiche?.numeroPersonnel)
        .filter((tel) => !exclus?.has(tel))
        .map((tel) => `nomtel:${nom}|${prenom}|${tel}`)
    },
  },
])

/**
 * Les grappes d'une règle : les groupes d'au moins DEUX fiches partageant une clé.
 *
 * `enTrop` est le chiffre qui se compare à l'écart constaté (16 000 − 13 000) :
 * c'est le nombre de fiches qui disparaîtraient si chaque grappe se réduisait à
 * une seule — et non le nombre de grappes, qui compte les personnes.
 */
export function grapperPar(regle, fiches = [], contexte = {}) {
  const parCle = new Map()

  for (const fiche of fiches) {
    for (const cle of regle.cles(fiche, contexte)) {
      if (!parCle.has(cle)) parCle.set(cle, [])
      parCle.get(cle).push(fiche)
    }
  }

  const grappes = [...parCle.entries()]
    .filter(([, membres]) => membres.length >= 2)
    .map(([cle, membres]) => ({ cle, membres }))
    .sort((a, b) => b.membres.length - a.membres.length)

  return {
    regle: regle.cle,
    titre: regle.titre,
    pourquoi: regle.pourquoi,
    grappes,
    nombreGrappes: grappes.length,
    fichesConcernees: grappes.reduce((n, g) => n + g.membres.length, 0),
    enTrop: grappes.reduce((n, g) => n + g.membres.length - 1, 0),
  }
}

/** Les quatre règles passées sur le même jeu. */
export function analyserDoublons(fiches = [], contexte = {}) {
  return REGLES.map((regle) => grapperPar(regle, fiches, contexte))
}

/**
 * Le remplissage des champs, et la LONGUEUR des valeurs d'agent héritées.
 *
 * ⚠ LA DISTRIBUTION DES LONGUEURS RÉPOND À « POURQUOI PAS DE NUMÉRO AGENT ».
 *   La séparation code/numéro se fait à la lecture, par la longueur : huit
 *   chiffres vont au numéro, TOUT LE RESTE au code. Si l'ancien champ `orange`
 *   ne contient que des valeurs de sept chiffres, alors la colonne « numéro
 *   agent » est vide par construction, et aucune donnée n'a été perdue — il n'y
 *   a simplement jamais eu de numéro. Si au contraire les huit chiffres y sont
 *   nombreux, c'est la règle de tri qu'il faut revoir. Les deux diagnostics
 *   appellent des réponses opposées ; ce comptage les sépare.
 */
export function profilerChamps(fiches = []) {
  const champs = ['nom', 'prenom', 'numeroPersonnel', 'codeAgent', 'numeroAgent', 'orange']
  const remplissage = Object.fromEntries(champs.map((c) => [c, 0]))
  const longueursOrange = new Map()
  const longueursCode = new Map()
  let sansAucunAgent = 0
  // ⚠ LA FICHE DONT L'APPLICATION NE VOIT PAS L'IDENTIFIANT.
  //   `champsAgent` décide par la PRÉSENCE des clés : une fiche portant
  //   `codeAgent: ''` et `numeroAgent: ''` est considérée comme « déjà rangée,
  //   et vidée exprès » — son `orange` n'est plus lu, délibérément. Une valeur
  //   peut donc rester en base sans que personne ne la voie à l'écran. Compter
  //   le remplissage de `orange` ne le dirait jamais ; comparer les deux, si.
  let sansIdentite = 0
  let orangeIgnore = 0
  const parType = { code: 0, numero: 0 }

  const compter = (carte, n) => carte.set(n, (carte.get(n) || 0) + 1)

  for (const fiche of fiches) {
    for (const champ of champs) {
      if (String(fiche?.[champ] ?? '').trim() !== '') remplissage[champ] += 1
    }
    const orange = chiffres(fiche?.orange)
    if (orange) compter(longueursOrange, orange.length)
    const code = chiffres(fiche?.codeAgent)
    if (code) compter(longueursCode, code.length)
    if (valeursAgent(fiche).length === 0) sansAucunAgent += 1

    const identite = identiteAgent(fiche)
    if (identite) parType[identite.type] += 1
    else {
      sansIdentite += 1
      if (orange) orangeIgnore += 1
    }
  }

  const trier = (carte) => [...carte.entries()].sort((a, b) => a[0] - b[0])

  return {
    total: fiches.length,
    remplissage,
    sansAucunAgent,
    sansIdentite,
    orangeIgnore,
    identifieesParCode: parType.code,
    identifieesParNumero: parType.numero,
    longueursOrange: trier(longueursOrange),
    longueursCode: trier(longueursCode),
  }
}

/**
 * ⚠ LES « NUMÉROS AGENT » SONT-ILS VRAIMENT DES NUMÉROS ?
 *
 *   La règle de tri dit : huit chiffres = un numéro de téléphone agent. Mais
 *   huit chiffres peuvent aussi être un CODE agent qui se trouve faire huit
 *   chiffres — et alors la règle le range dans la mauvaise colonne, et l'écran
 *   affiche « N° » sur ce qui est un code.
 *
 *   La base sait répondre toute seule, sans rien supposer sur les plages de
 *   numérotation du pays : elle contient des MILLIERS de vrais téléphones, dans
 *   `numeroPersonnel`. Si les valeurs à huit chiffres de `orange` sont des
 *   téléphones, elles commencent comme eux. Si leurs têtes n'existent jamais
 *   chez les vrais téléphones, ce ne sont pas des téléphones.
 */
export function comparerAuxTelephones(fiches = []) {
  const tete = (valeur) => valeur.slice(0, 2)
  const tetesTelephone = new Set()
  const candidates = []

  for (const fiche of fiches) {
    // Tous les numéros du champ, pas seulement le premier : les têtes connues
    // doivent couvrir l'ensemble des vrais téléphones de la base.
    for (const tel of numerosDe(fiche?.numeroPersonnel)) {
      if (tel.length === 8) tetesTelephone.add(tete(tel))
    }

    const identite = identiteAgent(fiche)
    if (identite?.type === 'numero' && identite.valeur.length === 8) candidates.push(identite.valeur)
  }

  const inconnues = new Map()
  for (const valeur of candidates) {
    const t = tete(valeur)
    if (!tetesTelephone.has(t)) inconnues.set(t, (inconnues.get(t) || 0) + 1)
  }

  const surTeteInconnue = [...inconnues.values()].reduce((a, b) => a + b, 0)
  return {
    total: candidates.length,
    tetesDeTelephone: tetesTelephone.size,
    surTeteInconnue,
    tetesInconnues: [...inconnues.entries()].sort((a, b) => b[1] - a[1]),
  }
}

/**
 * Combien d'opérations chaque fiche porte — ce qui désignera plus tard la
 * survivante d'une fusion.
 *
 * Une fiche sans aucune opération ne coûte rien à faire disparaître ; une fiche
 * qui en porte quatre cents est celle que la boutique utilise vraiment. Ce
 * comptage ne décide rien ici : il arme la décision.
 */
export function compterOperations(transactions = []) {
  const parClient = new Map()
  for (const transaction of transactions) {
    const id = String(transaction?.clientId ?? '').trim()
    if (!id) continue
    parClient.set(id, (parClient.get(id) || 0) + 1)
  }
  return parClient
}

/**
 * ⚠ LA GRAPPE QUI NE SE TRANCHE PAS TOUTE SEULE : plusieurs de ses fiches
 *   portent des opérations. Fusionner y suppose de REPOINTER des transactions,
 *   pas seulement d'effacer des fiches — et c'est exactement le cas qu'un script
 *   de purge naïf casserait en silence. On les compte à part pour savoir
 *   combien de travail reste à faire à la main, ou à faire faire proprement.
 */
export function classerGrappes(grappes, operationsParClient) {
  let sansOperation = 0
  let uneSeulePortante = 0
  let plusieursPortantes = 0

  for (const grappe of grappes) {
    const portantes = grappe.membres.filter((m) => (operationsParClient.get(m.id) || 0) > 0).length
    if (portantes === 0) sansOperation += 1
    else if (portantes === 1) uneSeulePortante += 1
    else plusieursPortantes += 1
  }

  return { sansOperation, uneSeulePortante, plusieursPortantes }
}

/** Le nom entier d'une fiche, plié — l'unité à laquelle on compare deux fiches. */
export const nomComplet = (fiche) => plier(`${fiche?.nom ?? ''} ${fiche?.prenom ?? ''}`)

/** Les mots d'un nom, en jeu, ponctuation ôtée : « POUYT (INTERDIT) » → {pouyt, interdit}. */
export const motsDe = (fiche) => new Set(
  nomComplet(fiche).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean),
)

/**
 * ⚠ LE NUMÉRO QUI N'IDENTIFIE PERSONNE.
 *
 *   Un `numeroPersonnel` partagé par soixante-six fiches aux noms sans aucun
 *   rapport n'est pas le téléphone de soixante-six homonymes : c'est une valeur
 *   de remplissage — le numéro de la boutique, un 70000000, une saisie par
 *   défaut. Vu en production : « SHOP FADA · ISSOUFOU / NIGER · RELAI ALBERT ·
 *   COMPAORE P VINCENT » sous une même clé.
 *
 *   Deux conditions, et les deux comptent. Beaucoup de fiches NE SUFFIT PAS :
 *   une famille partage un téléphone, et trois fiches « CISSE ADAMA » sur un
 *   même numéro sont bel et bien un doublon. C'est la DIVERGENCE DES NOMS qui
 *   tranche. Et des noms différents ne suffisent pas non plus : deux noms sur un
 *   numéro, c'est un couple ou une faute de frappe, pas une poubelle.
 */
export function numerosSurRepresentes(fiches = [], { seuilFiches = 5, seuilNoms = 3 } = {}) {
  const parNumero = new Map()

  for (const fiche of fiches) {
    // Chaque numéro du champ compte séparément : un numéro de remplissage noté
    // à côté d'un vrai (« 70000000/76112233 ») doit être repéré quand même.
    for (const tel of numerosDe(fiche?.numeroPersonnel)) {
      if (!parNumero.has(tel)) parNumero.set(tel, { fiches: 0, noms: new Set() })
      const entree = parNumero.get(tel)
      entree.fiches += 1
      entree.noms.add(nomComplet(fiche))
    }
  }

  const suspects = [...parNumero.entries()]
    .filter(([, e]) => e.fiches >= seuilFiches && e.noms.size >= seuilNoms)
    .map(([numero, e]) => ({ numero, fiches: e.fiches, nomsDistincts: e.noms.size }))
    .sort((a, b) => b.fiches - a.fiches)

  return {
    suspects,
    exclus: new Set(suspects.map((s) => s.numero)),
    fichesConcernees: suspects.reduce((n, s) => n + s.fiches, 0),
  }
}

/**
 * Une grappe est HOMOGÈNE quand toutes ses fiches portent exactement les mêmes
 * mots de nom. Sinon, les mots en trop sont rendus.
 *
 * ⚠ C'EST AINSI QU'ON DÉCOUVRE LES ANNOTATIONS SANS LES DEVINER. La boutique
 *   écrit des statuts dans le nom — « SOUBEIGA INOUSSA INTERDIT » à côté de
 *   « SOUBEIGA INOUSSA ». Supprimer la fiche marquée et garder la propre
 *   RÉAUTORISE un client banni, en silence. Aucune liste de mots interdits
 *   codée à l'avance n'aurait trouvé ceux de cette base ; l'écart entre les
 *   noms d'une même grappe, si.
 */
export function surplusDeNoms(grappe) {
  const jeux = grappe.membres.map(motsDe)
  if (jeux.length === 0) return { homogene: true, surplus: [], commun: [] }

  const commun = [...jeux[0]].filter((mot) => jeux.every((jeu) => jeu.has(mot))).sort()
  const tous = new Set(jeux.flatMap((jeu) => [...jeu]))
  const surplus = [...tous].filter((mot) => !commun.includes(mot)).sort()

  return { homogene: surplus.length === 0, surplus, commun }
}

/**
 * Les mots en surplus les plus fréquents — les annotations candidates.
 *
 * ⚠ SEULES LES GRAPPES AU NOYAU COMMUN COMPTENT ICI, et sans ce filtre la
 *   section ne sert à rien. Quand deux fiches ne partagent AUCUN mot de nom
 *   (« SAWADOGO HAMIDOU » face à « BELEM WENDKUNI », réunies par un code agent),
 *   la totalité de leurs mots est « en surplus » — et sur les 480 grappes de la
 *   base réelle, ce décompte remonterait les patronymes les plus courants du
 *   Burkina. Le mot cherché, « INTERDIT », serait enterré sous OUEDRAOGO et
 *   SAWADOGO. Une annotation se reconnaît à ce qu'elle s'AJOUTE à un nom qui,
 *   lui, est le même de part et d'autre.
 */
export function annotationsObservees(grappes = [], { maximum = 15 } = {}) {
  const compte = new Map()
  for (const grappe of grappes) {
    const { surplus, commun } = surplusDeNoms(grappe)
    if (commun.length === 0) continue
    for (const mot of surplus) compte.set(mot, (compte.get(mot) || 0) + 1)
  }
  return [...compte.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maximum)
    .map(([mot, n]) => ({ mot, grappes: n }))
}

/**
 * ⚠ LES MOTS D'ANNOTATION RELEVÉS DANS CETTE BASE — observés, pas devinés.
 *
 *   La boutique écrit des consignes de gestion dans le champ du nom. Ces racines
 *   viennent de ce que `annotationsObservees` a effectivement remonté sur la
 *   base réelle et de la relecture des 179 noms abandonnés du 2026-10-12 :
 *   « ZERBO YACOUBA PLUS DE DEPOT A CREDIT », « ILBOUDO ZACHARIA INTERDI DG »,
 *   « SAWADOGO SAIDOU ( INTERDIT ) ROUGE », « ROUMBA ARSENE PAS D DEPOT ».
 *
 *   Ce sont des RACINES, et volontairement : la base contient « INTERDIT »,
 *   « INTERDI » et « INTERDIT) ». Chercher le mot entier en manquerait deux sur
 *   trois — et c'est exactement le genre de filtre qui rend un rapport
 *   rassurant au lieu de le rendre juste.
 */
export const RACINES_ANNOTATION = Object.freeze([
  'interdi', 'bloqu', 'depot', 'credit', 'ferme', 'rouge', 'suspend',
])

/**
 * Le nom porte-t-il une consigne de gestion ? Rend les racines reconnues.
 *
 * ⚠ CE DÉTECTEUR DOIT PRÉFÉRER LE FAUX POSITIF. Son seul rôle est de dire
 *   « regarde celui-là » ; une ligne de trop coûte une seconde de lecture, une
 *   ligne manquée réautorise un client banni sans que rien ne le signale. C'est
 *   pour ça qu'il cherche des sous-chaînes et non des mots entiers : un nom de
 *   famille contenant « depot » n'existe pas, un « PAS D DEPOT » collé si.
 */
export function annotationsDansLeNom(nom) {
  const plie = plier(nom)
  return RACINES_ANNOTATION.filter((racine) => plie.includes(racine))
}

/**
 * CE QUI SE SUPPRIME SANS DISCUSSION — et rien d'autre.
 *
 * Trois conditions, toutes nécessaires :
 *   1. noms strictement homogènes → aucune annotation à perdre ;
 *   2. au plus UNE fiche référencée  → aucune transaction à repointer ;
 *   3. la survivante est désignée    → la référencée, ou à défaut la plus
 *      complète, et le rapport dit laquelle.
 *
 * `references` compte TOUTES les attaches d'une fiche, pas seulement ses
 * opérations : une demande au dealer référence un client sans écrire dans
 * `history`. Une fiche « sans opération » peut donc n'être pas libre.
 */
export function fusionsFranches(grappes = [], references = new Map()) {
  const franches = []
  const aRegarder = []

  for (const grappe of grappes) {
    const { homogene, surplus, commun } = surplusDeNoms(grappe)
    const referencees = grappe.membres.filter((m) => (references.get(m.id) || 0) > 0)
    const identites = new Set(grappe.membres.map(cleAgent).filter(Boolean))

    // ⚠ LA CONDITION QUI MANQUAIT, ET SANS LAQUELLE CETTE FONCTION DÉTRUIT DES
    //   COMMERCES. Deux fiches de même nom et même téléphone sont presque
    //   toujours la même personne — mais pas forcément le même COMMERCE. Un
    //   propriétaire qui tient douze points de vente les a saisis douze fois
    //   sous son nom et son téléphone personnel, avec douze codes agent
    //   différents. Les réduire à une fiche effacerait onze commerces.
    //
    //   Mesuré sur la base réelle : la règle nom+téléphone donnait 922 fiches
    //   « sans risque », alors que la règle agent — celle de la boutique — n'en
    //   comptait que 473 en trop sur TOUTE la base. L'écart, c'était ça.
    //
    //   L'identité agent primant sur tout le reste, elle est testée en premier.
    if (identites.size > 1) {
      aRegarder.push({ grappe, raison: `${identites.size} identifiants agent différents` })
      continue
    }
    // ⚠ DEUX DÉSACCORDS DE NOM QUI N'APPELLENT PAS LA MÊME DÉCISION.
    //
    //   « ILBOUDO T.ALAYE » / « ILBOUDO TONGONOMA ALAYE » / « ILBOUDO T ALAYE »
    //   partagent un noyau : c'est un nom écrit trois fois, et sous un même code
    //   agent c'est le même commerce. La fusion est légitime — à condition de
    //   REPORTER le nom le plus complet sur la survivante, ce qui préserve du
    //   même coup les annotations (« SOUBEIGA INOUSSA INTERDIT » est plus
    //   complet que « SOUBEIGA INOUSSA », donc c'est lui qui survit).
    //
    //   « SAWADOGO HAMIDOU » / « BELEM WENDKUNI » ne partagent RIEN. Sous un
    //   même code agent, c'est soit une erreur de saisie du code, soit un
    //   commerce qui a changé de main. Fusionner changerait le titulaire
    //   d'opérations réelles. Ces grappes-là ne se tranchent pas sans la
    //   boutique.
    if (!homogene) {
      aRegarder.push({
        grappe,
        raison: commun.length === 0 ? 'noms sans rapport' : 'variante du même nom',
        surplus,
      })
      continue
    }
    if (referencees.length > 1) {
      aRegarder.push({ grappe, raison: `${referencees.length} fiches portent des opérations` })
      continue
    }

    const survivante = referencees[0] ?? [...grappe.membres]
      .sort((a, b) => remplissage(b) - remplissage(a))[0]
    franches.push({
      grappe,
      survivante,
      perdantes: grappe.membres.filter((m) => m.id !== survivante.id),
    })
  }

  return {
    franches,
    aRegarder,
    fichesSupprimables: franches.reduce((n, f) => n + f.perdantes.length, 0),
  }
}

/**
 * ⚠ LA QUESTION QUI DÉCIDE S'IL Y A VRAIMENT 3 000 DOUBLONS.
 *
 *   Sur la base réelle, `orange` est rempli à 100 % et la règle « agent » ne
 *   réunit que 980 fiches : plus de quinze mille fiches portent donc un
 *   identifiant agent QUI N'APPARTIENT QU'À ELLES. Or un identifiant agent
 *   désigne un commerce.
 *
 *   Alors deux fiches « OUEDRAOGO SOULEYMANE » aux codes agent DIFFÉRENTS ne
 *   sont pas un doublon : ce sont deux commerces, tenus par deux homonymes. La
 *   règle « nom » en comptait 4 424 en trop ; cette fonction dit combien d'entre
 *   elles sont réfutées par les codes agent — et donc si l'écart constaté entre
 *   le compte de la boutique et celui du logiciel s'explique par des doublons,
 *   ou par tout autre chose.
 */
export function croiserAvecAgent(grappes = []) {
  let unSeulAgent = 0
  let agentsTousDistincts = 0
  let melange = 0
  let fichesSiUnSeulAgent = 0

  for (const grappe of grappes) {
    // ⚠ LA MÊME NOTION D'IDENTITÉ QUE LA RÈGLE « AGENT ». Ramasser ici toutes
    //   les valeurs brutes des trois champs ferait conclure « identifiants
    //   différents » pour deux fiches que la règle agent, elle, réunit — et la
    //   section qui tranche entre doublon et homonyme contredirait celle qui
    //   compte les doublons.
    const valeurs = new Set(grappe.membres.map(cleAgent).filter(Boolean))

    if (valeurs.size <= 1) {
      unSeulAgent += 1
      fichesSiUnSeulAgent += grappe.membres.length - 1
    } else if (valeurs.size >= grappe.membres.length) {
      agentsTousDistincts += 1
    } else {
      melange += 1
    }
  }

  return { unSeulAgent, agentsTousDistincts, melange, fichesSiUnSeulAgent }
}

/** Combien de champs utiles une fiche porte — pour départager deux fiches libres. */
export const remplissage = (fiche) => ['nom', 'prenom', 'numeroPersonnel', 'codeAgent', 'numeroAgent', 'orange']
  .filter((champ) => String(fiche?.[champ] ?? '').trim() !== '').length
