/**
 * champsImportables.mjs — les deux colonnes qu'un import peut remplir.
 *
 * PUR : aucune I/O. Tout le reste de l'import (retrouver la fiche par son code,
 * détecter les répétitions, écrire par lots, annuler) est COMMUN aux deux et vit
 * dans `importChampsAgent.mjs`. Ce fichier ne porte que ce qui diffère.
 *
 * CE QUI DIFFÈRE, ET POURQUOI ÇA NE SE DEVINE PAS
 * ───────────────────────────────────────────────
 * Un « Numéro agent » est un NOMBRE à huit chiffres : sa longueur le valide, et
 * un zéro mangé par le tableur se restitue sans rien inventer. Un « Agent
 * commercial » est un NOM : aucune longueur ne le valide, aucun zéro ne s'y
 * perd — mais deux orthographes du même commercial le coupent en deux dans les
 * statistiques, ce qu'aucune règle de forme ne rattraperait.
 *
 * Les deux champs ont donc des règles opposées là où elles comptent, et c'est la
 * raison d'être de ce fichier : écrire ces règles une fois, côte à côte, plutôt
 * que de les laisser se mélanger dans un module générique.
 *
 * ⚠ CE QUE NI L'UN NI L'AUTRE NE FAIT : créer une fiche, rapprocher par le nom,
 *   écraser une valeur en place, effacer quoi que ce soit.
 */

import { champsAgent } from '../../src/utils/agentFields.js'
import { plier } from './doublonsClients.mjs'

/** La colonne qui RETROUVE la fiche. Commune aux deux imports. */
export const COLONNE_CODE = 'Code agent'

/** La longueur d'un numéro agent, reprise de l'application. */
export const LONGUEUR_NUMERO = 8

const texte = (valeur) => (valeur === null || valeur === undefined ? '' : String(valeur))

/** Les espaces multiples réduits à un seul, et rognés aux deux bouts. */
const resserrer = (valeur) => texte(valeur).replace(/\s+/g, ' ').trim()

/**
 * Une case que le tableur a convertie en date.
 *
 * ⚠ RECONNUE AVANT TOUT AUTRE REFUS, pour les deux champs. Sans ce cas,
 *   « 23/01/2026 » était refusé pour la bonne raison (on n'écrit rien) mais avec
 *   le mauvais motif — « plusieurs valeurs » —, envoyant la boutique chercher une
 *   barre de séparation dans une case qui n'en avait jamais eu. Un refus doit
 *   dire ce qui s'est réellement passé.
 */
const EST_UNE_DATE = /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/
const refusDate = (brut) => ({
  refus: 'date',
  detail: `« ${brut} » est une date : le tableur a converti la saisie.`
    + ' Reformater la colonne en TEXTE dans le classeur et réexporter.',
})

// ════════════════════════════════════════════════════════════════════════════
// NUMÉRO AGENT — huit chiffres
// ════════════════════════════════════════════════════════════════════════════

/** Ce qui sépare visiblement deux numéros dans une même case. */
const SEPARATEURS_NUMERO = /[/,;|]|\bet\b|\bou\b|\n/i

/**
 * Le numéro agent d'une ligne, ou le motif du refus.
 *
 * @param valeur           la case, telle que le tableur l'a rendue
 * @param celluleNumerique Excel a-t-il stocké cette case comme un NOMBRE ?
 * @returns {{numero: string, zerosRestitues: number}|{refus: string, detail: string}}
 *
 * ⚠ POURQUOI LES ESPACES INTÉRIEURS DISPARAISSENT AUSSI. La consigne dit « retire
 *   les espaces autour ». Mais « 01 23 45 67 » est UN numéro écrit avec des
 *   espaces, et le refuser rejetterait une saisie parfaitement lisible. Les
 *   enlever tous est sans risque parce que la LONGUEUR tranche ensuite : deux
 *   numéros collés par un espace (« 1234567 7654321 ») font 14 chiffres et sont
 *   refusés. L'espace ne peut donc pas servir à faire passer un multiple.
 *
 * ⚠ LE CAS MULTIPLE EST RÉEL. La base contient « 06629924/55772628 » et
 *   « 07796503/66553459/75928339 » dans des champs de numéro. Un tel contenu ne
 *   désigne pas un numéro agent : on l'ignore plutôt que d'en choisir un.
 *
 * ⚠ LA DISSYMÉTRIE TEXTE / NOMBRE EST VOULUE, et c'est elle qui rend Excel sûr.
 *   Une case TEXTE contient ce que la boutique a écrit : sept chiffres se
 *   complètent (la consigne le dit), six chiffres sont une erreur de saisie et
 *   sont REFUSÉS. Une case NOMBRE, elle, a traversé Excel : ses zéros de tête ont
 *   pu être mangés par le tableur, et comme la cible fait exactement huit
 *   chiffres, les restituer n'invente rien — « 234567 » dans une case nombre ne
 *   peut avoir été que « 00234567 ». Chaque restitution est comptée et affichée.
 */
export function normaliserNumeroAgent(valeur, celluleNumerique = false) {
  const brut = texte(valeur).trim()
  if (brut === '') return { refus: 'vide', detail: 'case vide' }

  if (EST_UNE_DATE.test(brut)) return refusDate(brut)

  if (SEPARATEURS_NUMERO.test(brut)) {
    return { refus: 'multiple', detail: `plusieurs numéros : « ${brut} »` }
  }

  const sansEspaces = brut.replace(/\s+/g, '')
  if (!/^\d+$/.test(sansEspaces)) {
    return { refus: 'non-numerique', detail: `caractères non numériques : « ${brut} »` }
  }

  if (sansEspaces.length > LONGUEUR_NUMERO) {
    return { refus: 'longueur', detail: `${sansEspaces.length} chiffres au lieu de ${LONGUEUR_NUMERO} : « ${brut} »` }
  }

  // Une case NOMBRE se complète jusqu'à huit ; une case TEXTE, seulement de sept.
  const complementAutorise = celluleNumerique || sansEspaces.length === LONGUEUR_NUMERO - 1
  if (sansEspaces.length < LONGUEUR_NUMERO && !complementAutorise) {
    return {
      refus: 'longueur',
      detail: `${sansEspaces.length} chiffres au lieu de ${LONGUEUR_NUMERO} : « ${brut} »`
        + ' (case texte : non complétée, car son contenu est celui qui a été saisi)',
    }
  }

  return {
    numero: sansEspaces.padStart(LONGUEUR_NUMERO, '0'),
    zerosRestitues: LONGUEUR_NUMERO - sansEspaces.length,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// AGENT COMMERCIAL — un nom
// ════════════════════════════════════════════════════════════════════════════

/**
 * Ce qui sépare visiblement deux commerciaux dans une même case.
 *
 * ⚠ LA VIRGULE N'EN FAIT PAS PARTIE, contrairement au numéro. « OUEDRAOGO,
 *   Salif » est une seule personne écrite « Nom, Prénom » — c'est même la forme
 *   la plus courante dans un fichier de gestion. La traiter comme un séparateur
 *   rejetterait en masse des lignes parfaitement justes. On accepte donc la
 *   virgule, en sachant que « KONE, OUEDRAOGO » (deux personnes) passera : c'est
 *   l'arbitrage, et il penche du côté qui ne perd pas de données justes.
 */
const SEPARATEURS_COMMERCIAL = /[/;|]|\bet\b|\bou\b|\n/i

/** Une lettre, quelque part. Un nom en contient ; « 0 », « - » et « 12/03 » non. */
const CONTIENT_UNE_LETTRE = /\p{L}/u

/**
 * Les cases qui disent « pas de commercial » au lieu d'en nommer un.
 *
 * Écrire « NÉANT » dans `agentCommercial` en ferait un commercial à part entière
 * dans le tableau de bord, avec son portefeuille et son volume. Le champ vide est
 * déjà rendu par « Non attribué » à l'écran : il n'y a rien à écrire.
 */
const NON_RENSEIGNE = new Set([
  'na', 'n a', 'nd', 'n d', 'ras', 'neant', 'rien', 'aucun', 'aucune', 'inconnu', 'inconnue',
  'non attribue', 'non attribuee', 'non renseigne', 'non renseignee', 'sans', 'x', 'xx', 'xxx',
])

/**
 * ⚠ « N/A » DOIT ÊTRE RECONNU AVANT LE TEST « PLUSIEURS COMMERCIAUX », sinon sa
 *   barre le fait refuser comme deux noms — le bon refus pour la mauvaise raison,
 *   qui envoie chercher un second commercial dans une case qui n'en nomme aucun.
 *   Même principe que la date : un refus doit dire ce qui s'est réellement passé.
 */
const ditPasDeCommercial = (brut) => NON_RENSEIGNE.has(plier(brut))
  || NON_RENSEIGNE.has(plier(brut.replace(/[/\\.-]+/g, ' ')))

/** Au-delà, ce n'est plus un nom mais une phrase tombée dans la colonne. */
const LONGUEUR_MAX_COMMERCIAL = 60

/**
 * Les orthographes d'agent commercial présentes en base, rangées par leur pli.
 *
 * @returns {Map<string, Map<string, number>>} pli → (orthographe → nombre de fiches)
 */
export function indexerCommerciaux(fiches = []) {
  const parPli = new Map()
  for (const fiche of fiches) {
    const nom = resserrer(fiche?.agentCommercial)
    if (!nom) continue
    const pli = plier(nom)
    if (!parPli.has(pli)) parPli.set(pli, new Map())
    const orthographes = parPli.get(pli)
    orthographes.set(nom, (orthographes.get(nom) || 0) + 1)
  }
  return parPli
}

/**
 * L'orthographe que la base porte déjà pour ce nom, quand elle est SANS APPEL.
 *
 * ⚠ C'EST L'ANALOGUE DU ZÉRO RESTITUÉ DEPUIS LA BASE, et pour la même raison :
 *   la base est la référence, pas le fichier. `calculerCommerciaux` groupe les
 *   agents par la CHAÎNE EXACTE de `agentCommercial`. Écrire « ouedraogo s. » à
 *   côté des 300 fiches qui portent « OUEDRAOGO S. » créerait un SECOND
 *   commercial dans le tableau de bord, avec une part du portefeuille et une part
 *   du volume de l'autre. Rien dans l'import ne le signalerait, et le graphe
 *   mentirait sans message d'erreur.
 *
 * ⚠ ON N'ALIGNE QUE SI UNE ORTHOGRAPHE DOMINE STRICTEMENT. Si la base est
 *   partagée 150 / 150 entre deux écritures, choisir serait tirer au sort le nom
 *   affiché sur des centaines de fiches. Dans ce cas on garde ce que le fichier
 *   dit, et on le signale : c'est un arbitrage humain, pas un calcul.
 *
 * @returns {{valeur: string, aligne: boolean, nouveau?: boolean, concurrentes?: string[], remplace?: string}}
 */
export function alignerSurLaBase(nom, parPli) {
  const pli = plier(nom)
  const orthographes = parPli?.get?.(pli)
  if (!orthographes || orthographes.size === 0) return { valeur: nom, aligne: false, nouveau: true }

  const classees = [...orthographes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const [dominante, compte] = classees[0]
  const exAequo = classees.filter(([, n]) => n === compte)

  if (exAequo.length > 1) {
    // Partage : on ne tranche pas. Si le fichier porte l'une des orthographes en
    // présence, elle est aussi légitime que l'autre et on la garde telle quelle.
    return { valeur: nom, aligne: false, concurrentes: exAequo.map(([o]) => o) }
  }
  if (dominante === nom) return { valeur: nom, aligne: false }
  return { valeur: dominante, aligne: true, remplace: nom }
}

/**
 * L'agent commercial d'une ligne, ou le motif du refus.
 *
 * @param valeur           la case, telle que le tableur l'a rendue
 * @param celluleNumerique Excel a-t-il stocké cette case comme un NOMBRE ?
 * @param parPli           l'index des orthographes de la base (voir `alignerSurLaBase`)
 *
 * ⚠ AUCUNE RÈGLE DE LONGUEUR NE VALIDE UN NOM. C'est la différence de fond avec
 *   le numéro agent : « KONE » et « OUEDRAOGO W. Jean-Baptiste » sont tous deux
 *   justes. Les refus portent donc sur ce qui n'est PAS un nom — une date, une
 *   case sans la moindre lettre, un « NÉANT », deux noms dans une case — et sur
 *   rien d'autre. Un nom qu'on ne reconnaît pas n'est pas un nom faux.
 *
 * ⚠ UNE CASE STOCKÉE EN NOMBRE EST REFUSÉE PAR « SANS LETTRE », et c'est voulu :
 *   un commercial dont le nom est un nombre n'existe pas, donc la colonne a été
 *   remplie avec autre chose (un code, un numéro de téléphone). Mieux vaut
 *   l'ignorer que l'écrire dans le champ qui nomme les commerciaux.
 */
export function normaliserAgentCommercial(valeur, celluleNumerique = false, parPli = null) {
  const brut = resserrer(valeur)
  if (brut === '') return { refus: 'vide', detail: 'case vide' }

  if (EST_UNE_DATE.test(brut)) return refusDate(brut)

  if (ditPasDeCommercial(brut)) {
    return {
      refus: 'non-renseigne',
      detail: `« ${brut} » veut dire « pas de commercial ». La case reste vide :`
        + " l'écran affiche déjà « Non attribué » pour un champ vide.",
    }
  }

  if (SEPARATEURS_COMMERCIAL.test(brut)) {
    return {
      refus: 'multiple',
      detail: `plusieurs commerciaux dans la même case : « ${brut} ».`
        + " Une fiche n'a qu'un agent commercial : choisir lequel dans le fichier.",
    }
  }

  if (!CONTIENT_UNE_LETTRE.test(brut)) {
    return {
      refus: 'sans-lettre',
      detail: `« ${brut} » ne contient aucune lettre : ce n'est pas un nom.`
        + (celluleNumerique ? ' La case est stockée en NOMBRE par le tableur.' : ''),
    }
  }

  if (brut.length > LONGUEUR_MAX_COMMERCIAL) {
    return {
      refus: 'longueur',
      detail: `${brut.length} caractères : trop long pour un nom (maximum ${LONGUEUR_MAX_COMMERCIAL}).`
        + ` « ${brut.slice(0, 40)}… »`,
    }
  }

  return { nom: brut, ...alignerSurLaBase(brut, parPli) }
}

// ════════════════════════════════════════════════════════════════════════════
// LES DEUX DESCRIPTIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Ce qu'un champ importable doit savoir faire.
 *
 *   colonne          l'intitulé attendu dans le fichier, à la lettre de l'écran
 *   colonneInterdite celle qu'il ne faut JAMAIS prendre pour l'autre, ou null
 *   clesEcrites      les clés Firestore touchées — c'est elles que l'annulation
 *                    remet en place, et leur PRÉSENCE qu'elle restitue
 *   contexte(fiches) ce que la base doit fournir avant de normaliser une valeur
 *   normaliser(v, numerique, ctx) → {valeur, ajuste, note} | {refus, detail}
 *   lire(fiche)      la valeur actuellement en base, en texte
 *   memeValeur(a, b) a et b désignent-ils la même chose ? (sinon : CONFLIT)
 *   champsAEcrire(fiche, valeur) → l'objet passé à `batch.update`
 */

export const CHAMP_NUMERO = Object.freeze({
  cle: 'numero',
  colonne: 'Numéro agent',
  colonneInterdite: 'Numéro personnel',
  libelle: 'numéro agent',
  libelleCourt: 'numéro',
  titreAjustements: 'Zéros restitués — à relire avant d’écrire :',
  action: 'AGENT_NUMBER_IMPORTED',
  actionAnnulation: 'AGENT_IMPORT_REVERTED',
  prefixeSauvegarde: 'import-numeros',
  script: 'scripts/importerNumerosAgent.mjs',
  clesEcrites: ['codeAgent', 'numeroAgent'],

  contexte: () => null,

  normaliser(valeur, celluleNumerique) {
    const lu = normaliserNumeroAgent(valeur, celluleNumerique)
    if (lu.refus) return lu
    return {
      valeur: lu.numero,
      ajuste: lu.zerosRestitues > 0,
      note: lu.zerosRestitues > 0 ? `numéro complété de ${lu.zerosRestitues} zéro(s) de tête` : '',
    }
  },

  lire: (fiche) => champsAgent(fiche).numeroAgent,

  /**
   * ⚠ COMPARAISON SUR LA FORME NORMALISÉE, PAS SUR LA CHAÎNE BRUTE. Sinon un
   *   espace résiduel ou un zéro manquant en base ferait un « conflit » là où il
   *   n'y a qu'une écriture différente du même numéro — et la boutique partirait
   *   vérifier à la main des centaines de faux problèmes.
   */
  memeValeur(actuel, propose) {
    const lu = normaliserNumeroAgent(actuel)
    return !lu.refus && lu.numero === propose
  },

  /**
   * ⚠ ON ÉCRIT LES DEUX CHAMPS, PAS SEULEMENT LE NUMÉRO. C'est le point le plus
   *   dangereux de tout cet import, et il ne se voit pas.
   *
   *   `champsAgent` décide qu'une fiche est « déjà rangée » par la PRÉSENCE des
   *   clés `codeAgent`/`numeroAgent`, pas par leur valeur. Une fiche d'avant la
   *   séparation n'a aucune des deux : son identifiant est lu depuis `orange`.
   *   Écrire `numeroAgent` tout seul y ferait apparaître une clé — et dès lors
   *   l'application cesserait de lire `orange`, donc LE CODE AGENT DISPARAÎTRAIT
   *   DE L'ÉCRAN. Sur 15 000 fiches, un import censé ajouter une information en
   *   aurait effacé une autre, sans erreur et sans compteur.
   *
   * ⚠ LE CODE ÉCRIT VIENT DE LA FICHE, JAMAIS DU FICHIER. Même quand un zéro a
   *   été restitué pour retrouver la fiche, c'est `champsAgent(fiche).codeAgent`
   *   qui est écrit — la base est la référence. Recopier le code du fichier ferait
   *   entrer dans la fiche la version tronquée par le tableur.
   */
  champsAEcrire: (fiche, valeur) => ({
    codeAgent: champsAgent(fiche).codeAgent,
    numeroAgent: valeur,
  }),
})

export const CHAMP_COMMERCIAL = Object.freeze({
  cle: 'commercial',
  colonne: 'Agent commercial',
  colonneInterdite: null,
  libelle: 'agent commercial',
  libelleCourt: 'commercial',
  titreAjustements: 'Orthographes alignées sur la base — à relire avant d’écrire :',
  action: 'AGENT_COMMERCIAL_IMPORTED',
  actionAnnulation: 'AGENT_COMMERCIAL_REVERTED',
  prefixeSauvegarde: 'import-commerciaux',
  script: 'scripts/importerAgentsCommerciaux.mjs',

  /**
   * ⚠ UNE SEULE CLÉ, ET SURTOUT PAS LES DEUX AUTRES. Le piège de l'import de
   *   numéros ne se pose pas ici : `agentCommercial` n'entre pas dans le calcul
   *   de `champsAgent`, donc l'écrire sur une fiche héritée ne fait pas cesser la
   *   lecture de `orange`. Y ajouter `codeAgent`/`numeroAgent` « pour ranger la
   *   fiche au passage » serait une écriture que personne n'a demandée, sur des
   *   milliers de fiches, dans un import qui parle d'autre chose.
   */
  clesEcrites: ['agentCommercial'],

  contexte: (fiches) => indexerCommerciaux(fiches),

  normaliser(valeur, celluleNumerique, parPli) {
    const lu = normaliserAgentCommercial(valeur, celluleNumerique, parPli)
    if (lu.refus) return lu

    const note = lu.aligne
      ? `orthographe alignée sur la base : « ${lu.remplace} » → « ${lu.valeur} »`
      : (lu.concurrentes
        ? `la base porte ${lu.concurrentes.length} orthographes à égalité`
          + ` (${lu.concurrentes.map((o) => `« ${o} »`).join(', ')}) : celle du fichier est gardée`
        : '')

    return {
      valeur: lu.valeur,
      ajuste: Boolean(lu.aligne),
      nouveau: Boolean(lu.nouveau),
      concurrentes: lu.concurrentes ?? null,
      note,
    }
  },

  lire: (fiche) => resserrer(fiche?.agentCommercial),

  /**
   * ⚠ COMPARAISON SUR LE PLI. « OUEDRAOGO S. » et « ouedraogo s. » sont le même
   *   commercial : les opposer ferait un CONFLIT à trancher à la main sur des
   *   centaines de fiches, pour une différence de casse. L'écriture en place
   *   n'est pas remplacée pour autant — on ne touche qu'aux cases vides.
   */
  memeValeur: (actuel, propose) => plier(actuel) === plier(propose),

  champsAEcrire: (_fiche, valeur) => ({ agentCommercial: valeur }),
})

export const CHAMPS = Object.freeze({
  [CHAMP_NUMERO.cle]: CHAMP_NUMERO,
  [CHAMP_COMMERCIAL.cle]: CHAMP_COMMERCIAL,
})

/** Le champ désigné par `--champ=`, ou null. */
export const champParCle = (cle) => CHAMPS[String(cle ?? '').trim().toLowerCase()] ?? null

/** Conservés pour les appelants qui ne connaissent que l'import de numéros. */
export const COLONNE_NUMERO = CHAMP_NUMERO.colonne
export const COLONNE_INTERDITE = CHAMP_NUMERO.colonneInterdite
export const COLONNE_COMMERCIAL = CHAMP_COMMERCIAL.colonne
