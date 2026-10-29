/**
 * outils.js — LE CŒUR. Déclarations lues par le modèle + exécution contre
 * Firestore, avec le jeton de l'utilisateur connecté.
 *
 * Le modèle ne touche jamais la base. Il demande un outil ; c'est ce fichier
 * qui lit, avec l'identité de la personne connectée, et les règles Firestore
 * s'appliquent sans une ligne de code en plus.
 *
 * ⚠ RÈGLES QUI ONT TOUTES COÛTÉ UNE CORRECTION AILLEURS — ne pas les défaire :
 *   - Un outil ne LÈVE JAMAIS. Un refus est une RÉPONSE que le modèle doit
 *     pouvoir expliquer, pas un plantage de l'écran.
 *   - « Je n'ai pas le droit » et « il n'y a rien » sont deux réponses
 *     DIFFÉRENTES. Les confondre fait mentir l'assistant.
 *   - Le code technique va à la console, JAMAIS au modèle : tout ce qu'on lui
 *     donne, il peut le répéter à l'écran, et « permission-denied » n'est pas
 *     une phrase qu'on dit à un agent de comptoir.
 *   - Les champs d'audit sont retirés : le modèle n'en fait rien et ils sont
 *     facturés à chaque ligne.
 *   - Les TOTAUX portent sur tout ce qui a été retenu, l'EXTRAIT sur 50 lignes.
 *     Sans les totaux, le modèle additionne les cinquante premières lignes et
 *     appelle ça le mois.
 *   - Une liste coupée le DIT (`tronque: true`). Une somme faite sur une liste
 *     tronquée rend un nombre faux QUI A L'AIR JUSTE.
 *
 * La boutique n'est jamais passée en paramètre : `firestoreService` porte la
 * boutique active, exactement comme pour les écrans. Le cloisonnement vient
 * donc gratuitement, et un outil ne peut pas se tromper de boutique.
 */

// ⚠ LE SINGLETON, JAMAIS SES MÉTHODES DÉTACHÉES. `firestore.js` exporte aussi
//   `getClients`, `getDrafts`… par déstructuration : appelées seules, elles
//   perdent leur `this` et lèvent un TypeError à chaque lecture. C'est arrivé
//   ici, et `traduirePanne` le maquillait en « Je n'ai pas pu lire » (tc-301).
import { firestoreService } from '../../services/firestore.js'
import { businessDateKey, storedBusinessDateKey } from '../../utils/businessDate.js'
import { CLES_DESTINATIONS } from './destinations.js'

const EXTRAIT_MAX = 50
const STATUTS_DEFAITS = Object.freeze(['Annulée', 'Supprimée'])

/** Un refus nommé, lisible par le modèle, sans une once de jargon. */
function refus(message) {
  return { erreur: true, message }
}

/**
 * Traduit une panne en phrase humaine. La brute part TOUJOURS en console :
 * un message rassurant posé sur un diagnostic faux coûte une demi-journée.
 */
function traduirePanne(cause, quoi) {
  console.error(`[assistant] échec de lecture — ${quoi}`, cause)
  const code = cause?.code ?? ''
  if (code === 'permission-denied') {
    return refus(`Je n'ai pas accès à ${quoi} pour cette boutique.`)
  }
  if (code === 'unavailable' || cause?.name === 'FirebaseError') {
    return refus(`Je n'ai pas pu lire ${quoi} à l'instant. Réessayez dans un moment.`)
  }
  return refus(`Je n'ai pas pu lire ${quoi}.`)
}

/** Retire les champs d'audit et les horodatages bruts. */
function nettoyer(document_, champs) {
  const propre = {}
  for (const champ of champs) {
    const valeur = document_?.[champ]
    if (valeur === undefined || valeur === null || valeur === '') continue
    propre[champ] = valeur
  }
  return propre
}

function estDefait(transaction) {
  return STATUTS_DEFAITS.includes(transaction?.statut)
}

function montantDe(transaction) {
  const montant = Number(transaction?.montant)
  return Number.isFinite(montant) ? montant : 0
}

/**
 * La journée du tableau de bord (`useTodayTransactions`), pas une seconde
 * définition : date saisie dans la journée métier du profil. Une ligne sans
 * date lisible n'est pas « du jour » — la compter gonflerait le bilan.
 */
function estDuJour(ligne, cleDuJour) {
  if (!ligne?.date) return false
  try {
    return storedBusinessDateKey(ligne.date) === cleDuJour
  } catch {
    return false
  }
}

/** Totaux sur TOUT ce qui a été retenu, puis extrait borné. */
function totaliser(lignes) {
  const retenues = lignes.filter((l) => !estDefait(l))
  const total = retenues.reduce((somme, l) => somme + montantDe(l), 0)
  const parType = {}
  for (const ligne of retenues) {
    const type = ligne?.type ?? 'Autre'
    parType[type] = (parType[type] ?? 0) + montantDe(ligne)
  }
  return { nombre: retenues.length, total, parType, retenues }
}

function nomComplet(client) {
  return [client?.prenom, client?.nom].filter(Boolean).join(' ').trim() || 'sans nom'
}

// ─────────────────────────────────────────────────────────────────────────────
// Déclarations lues par le modèle
//
// ⚠ Écrites À LA MAIN, pas dérivées des types. Une `description` est de la
//   DOCUMENTATION LUE PAR LE MODÈLE : c'est elle qui décide s'il choisit le bon
//   outil. Dérivée d'un type, on obtient des noms de champs sans la phrase qui
//   dit QUAND s'en servir.
// ─────────────────────────────────────────────────────────────────────────────

export const DECLARATIONS = Object.freeze([
  {
    name: 'bilan_du_jour',
    description:
      "Le point complet de la journée pour cette boutique : nombre d'opérations, " +
      "total encaissé, répartition par type, créances en cours et nombre de clients. " +
      "À EMPLOYER DÈS QU'ON DEMANDE « où on en est », « fais le point », « le bilan », " +
      "« la situation », « ça donne quoi aujourd'hui ». Rend tout d'un coup : ne lance " +
      'pas plusieurs autres outils pour reconstituer ce que celui-ci donne déjà.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'chercher_client',
    description:
      "Retrouve un client par son nom, son prénom, son code agent ou son numéro. " +
      "À employer pour « c'est quoi le code de X », « est-ce que X existe déjà », " +
      '« retrouve-moi X ». Rend aussi la boutique qui a enregistré la fiche.',
    parameters: {
      type: 'OBJECT',
      properties: {
        recherche: { type: 'STRING', description: 'Nom, prénom, code agent ou numéro' },
      },
      required: ['recherche'],
    },
  },
  {
    name: 'creances_en_cours',
    description:
      "Les opérations non terminées de la boutique : ce que les clients doivent " +
      'encore. À employer pour « qui me doit de l\'argent », « les créances », ' +
      '« ce qui reste à régler ». Rend le total dû et le détail par client.',
    parameters: {
      type: 'OBJECT',
      properties: {
        client: { type: 'STRING', description: "Nom ou code d'un client, pour ne voir que lui" },
      },
    },
  },
  {
    name: 'operations_recentes',
    description:
      "L'historique récent des opérations terminées de la boutique, avec les totaux. " +
      "À employer pour « qu'est-ce qu'on a fait », « retrouve l'opération de X », " +
      '« les dépôts de cette semaine ».',
    parameters: {
      type: 'OBJECT',
      properties: {
        client: { type: 'STRING', description: "Nom ou code d'un client" },
        type: { type: 'STRING', description: 'Dépôt ou Retrait' },
      },
    },
  },
  {
    name: 'proposer_l_ecran',
    description:
      "Pose un bouton SOUS ta réponse pour ouvrir un écran. C'est le cas NORMAL " +
      "après une question : la personne finit de te lire, puis décide. " +
      `Écrans possibles : ${CLES_DESTINATIONS.join(', ')}.`,
    parameters: {
      type: 'OBJECT',
      properties: { ecran: { type: 'STRING', enum: [...CLES_DESTINATIONS] } },
      required: ['ecran'],
    },
  },
  {
    name: 'aller_a',
    description:
      "Ouvre un écran IMMÉDIATEMENT. Réservé à une intention explicite : " +
      "« ouvre les clients », « emmène-moi à l'historique ». N'emploie JAMAIS " +
      "cet outil pour répondre à une question — l'écran changerait pendant qu'on te lit. " +
      `Écrans possibles : ${CLES_DESTINATIONS.join(', ')}.`,
    parameters: {
      type: 'OBJECT',
      properties: { ecran: { type: 'STRING', enum: [...CLES_DESTINATIONS] } },
      required: ['ecran'],
    },
  },
  {
    name: 'fermer_l_assistant',
    description: "Ferme le panneau. Uniquement si on te le demande (« merci », « ferme »).",
    parameters: { type: 'OBJECT', properties: {} },
  },
])

/** Les outils qui agissent sur l'écran : exécutés par le composant, pas ici. */
export const OUTILS_DE_GESTE = Object.freeze(['aller_a', 'proposer_l_ecran', 'fermer_l_assistant'])

// ─────────────────────────────────────────────────────────────────────────────
// Exécution
// ─────────────────────────────────────────────────────────────────────────────

function correspond(client, recherche) {
  const aiguille = recherche.trim().toLowerCase()
  if (!aiguille) return false
  return [client?.nom, client?.prenom, client?.codeAgent, client?.numeroAgent, client?.orange, client?.numeroPersonnel]
    .filter(Boolean)
    .some((champ) => String(champ).toLowerCase().includes(aiguille))
}

async function bilanDuJour() {
  // Lectures en parallèle : les enchaîner doublait l'attente au comptoir.
  const [clients, brouillons, historique] = await Promise.allSettled([
    firestoreService.getClients(),
    firestoreService.getDrafts(),
    firestoreService.getHistory(),
  ])

  if (historique.status === 'rejected') return traduirePanne(historique.reason, "l'historique")

  // ⚠ BORNÉ À LA JOURNÉE. Sans ce filtre, le « bilan du jour » additionnait
  //   tout l'historique : le cumul depuis l'ouverture, au chiffre près, sous
  //   l'étiquette d'aujourd'hui. Les créances, elles, ne se périment pas.
  const cleDuJour = businessDateKey()
  const lignes = (Array.isArray(historique.value) ? historique.value : []).filter((l) => estDuJour(l, cleDuJour))
  const { nombre, total, parType } = totaliser(lignes)

  const creances = brouillons.status === 'fulfilled' && Array.isArray(brouillons.value) ? brouillons.value : []
  const creancesRetenues = creances.filter((c) => !estDefait(c))
  const totalCreances = creancesRetenues.reduce((somme, c) => somme + montantDe(c), 0)

  return {
    operations_terminees: nombre,
    total_encaisse: total,
    par_type: parType,
    creances_en_cours: creancesRetenues.length,
    total_des_creances: totalCreances,
    clients_enregistres:
      clients.status === 'fulfilled' && Array.isArray(clients.value) ? clients.value.length : null,
    // Une panne partielle est DITE, jamais tue : un zéro silencieux ment.
    lectures_incompletes: [
      clients.status === 'rejected' ? 'clients' : null,
      brouillons.status === 'rejected' ? 'créances' : null,
    ].filter(Boolean),
  }
}

async function chercherClient({ recherche } = {}) {
  if (typeof recherche !== 'string' || recherche.trim().length < 2) {
    return refus('Dites-moi au moins deux lettres du nom, ou le code agent.')
  }

  let clients
  try {
    clients = await firestoreService.getClients()
  } catch (cause) {
    return traduirePanne(cause, 'la liste des clients')
  }

  const trouves = (Array.isArray(clients) ? clients : []).filter((c) => correspond(c, recherche))
  if (trouves.length === 0) {
    // « Il n'y a rien » — distinct d'un refus, et dit comme tel.
    return { trouves: 0, clients: [], message: `Aucun client ne correspond à « ${recherche} ».` }
  }

  return {
    trouves: trouves.length,
    tronque: trouves.length > EXTRAIT_MAX,
    clients: trouves.slice(0, EXTRAIT_MAX).map((c) => ({
      nom: nomComplet(c),
      ...nettoyer(c, ['codeAgent', 'numeroAgent', 'numeroPersonnel', 'registeredStoreName']),
    })),
  }
}

async function creancesEnCours({ client } = {}) {
  let brouillons
  try {
    brouillons = await firestoreService.getDrafts()
  } catch (cause) {
    return traduirePanne(cause, 'les créances')
  }

  let lignes = (Array.isArray(brouillons) ? brouillons : []).filter((l) => !estDefait(l))
  if (typeof client === 'string' && client.trim()) {
    const aiguille = client.trim().toLowerCase()
    lignes = lignes.filter((l) =>
      [l?.clientNom, l?.nom, l?.codeAgent, l?.clientId]
        .filter(Boolean)
        .some((champ) => String(champ).toLowerCase().includes(aiguille)),
    )
  }

  if (lignes.length === 0) {
    return { nombre: 0, total_du: 0, creances: [], message: 'Aucune créance en cours.' }
  }

  const total = lignes.reduce((somme, l) => somme + montantDe(l), 0)
  return {
    nombre: lignes.length,
    total_du: total, // total sur TOUT ce qui est retenu, pas sur l'extrait
    tronque: lignes.length > EXTRAIT_MAX,
    creances: lignes.slice(0, EXTRAIT_MAX).map((l) =>
      nettoyer(l, ['clientNom', 'nom', 'codeAgent', 'type', 'montant', 'reseau', 'statut', 'date']),
    ),
  }
}

async function operationsRecentes({ client, type } = {}) {
  let historique
  try {
    historique = await firestoreService.getHistory()
  } catch (cause) {
    return traduirePanne(cause, "l'historique")
  }

  let lignes = Array.isArray(historique) ? historique : []
  if (typeof client === 'string' && client.trim()) {
    const aiguille = client.trim().toLowerCase()
    lignes = lignes.filter((l) =>
      [l?.clientNom, l?.nom, l?.codeAgent, l?.clientId]
        .filter(Boolean)
        .some((champ) => String(champ).toLowerCase().includes(aiguille)),
    )
  }
  if (typeof type === 'string' && type.trim()) {
    const voulu = type.trim().toLowerCase()
    lignes = lignes.filter((l) => String(l?.type ?? '').toLowerCase() === voulu)
  }

  const { nombre, total, parType, retenues } = totaliser(lignes)
  if (nombre === 0) {
    return { nombre: 0, total: 0, operations: [], message: 'Aucune opération ne correspond.' }
  }

  return {
    nombre,
    total,
    par_type: parType,
    tronque: retenues.length > EXTRAIT_MAX,
    operations: retenues.slice(0, EXTRAIT_MAX).map((l) =>
      nettoyer(l, ['clientNom', 'nom', 'codeAgent', 'type', 'montant', 'reseau', 'statut', 'date']),
    ),
  }
}

const EXECUTANTS = Object.freeze({
  bilan_du_jour: bilanDuJour,
  chercher_client: chercherClient,
  creances_en_cours: creancesEnCours,
  operations_recentes: operationsRecentes,
})

/**
 * Exécute un outil de lecture. NE LÈVE JAMAIS.
 * Les outils de geste ne passent pas par ici : le composant les traite.
 */
export async function executerOutil(nom, arguments_ = {}) {
  const executant = EXECUTANTS[nom]
  if (!executant) return refus(`Je ne sais pas faire « ${nom} ».`)
  try {
    return await executant(arguments_)
  } catch (cause) {
    console.error(`[assistant] outil ${nom} a échoué`, cause)
    return refus("Je n'ai pas pu aller chercher cette information.")
  }
}
