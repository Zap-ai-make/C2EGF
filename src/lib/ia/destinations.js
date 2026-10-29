/**
 * destinations.js — le catalogue NOMMÉ des écrans où l'assistant sait emmener.
 *
 * PUR. Aucune dépendance au routeur, à Firebase, à React ; il lit seulement la
 * liste des entrées de navigation, pour ne proposer que ce qu'elle montre.
 *
 * ⚠ Le modèle ne compose JAMAIS une URL. Il choisit une clé de ce catalogue, ou
 *   il ne va nulle part. Laisser composer un chemin l'envoie un jour sur une
 *   page qui n'existe pas, et l'utilisateur conclut que le logiciel est cassé.
 *
 * ⚠ Un refus est NOMMÉ, jamais rapproché « au plus proche ». Emmener quelqu'un
 *   sur un écran voisin de celui qu'il voulait est pire que de ne pas bouger :
 *   il croit y être.
 *
 * Espace BOUTIQUE uniquement (store_admin, member) — voir docs/ia/README.md.
 * Les espaces gérant et dealer ne sont pas dans le périmètre de l'assistant.
 */

import { STORE_ACCOUNT_ITEM, STORE_NAV_ITEMS } from '../../constants/navigation.js'

export const DESTINATIONS = Object.freeze({
  accueil: Object.freeze({
    chemin: '/',
    libelle: "l'accueil",
    quand: "le tableau de bord du jour : transactions, clients, activité",
  }),
  clients: Object.freeze({
    chemin: '/clients',
    libelle: 'les clients',
    quand: 'consulter ou corriger la liste des agents de la boutique',
  }),
  transactions: Object.freeze({
    chemin: '/transactions',
    libelle: 'les transactions',
    quand: 'enregistrer un dépôt ou un retrait, un ravitaillement ou un retour, et terminer les non terminées',
  }),
  historique: Object.freeze({
    chemin: '/historique',
    libelle: "l'historique",
    quand: 'retrouver une opération passée',
  }),
  nouvelleTransaction: Object.freeze({
    chemin: '/formulaire',
    libelle: 'le formulaire de transaction',
    quand: 'enregistrer un dépôt ou un retrait',
  }),
  ravitaillements: Object.freeze({
    chemin: '/dealer-requests',
    libelle: 'les demandes au dealer',
    // ⚠ PAS le ravitaillement reçu, qui se saisit dans les transactions.
    quand: 'suivre une demande de ravitaillement adressée au dealer, pas un ravitaillement reçu',
  }),
  clotures: Object.freeze({
    chemin: '/store/closures',
    libelle: 'les clôtures',
    quand: 'consulter les clôtures de caisse de la boutique',
  }),
  profil: Object.freeze({
    chemin: '/profil',
    libelle: 'le profil',
    quand: 'les informations du compte et de la boutique',
  }),
})

/**
 * Les clés dont l'écran est atteignable par ces chemins, dans l'ordre du
 * catalogue.
 *
 * ⚠ L'ASSISTANT N'EMMÈNE QUE LÀ OÙ LA BARRE DE NAVIGATION MÈNE. Un écran que le
 *   profil masque (tableau de bord, formulaire séparé, demandes au dealer chez
 *   C2EGF) ou qu'aucun lien n'ouvre (les clôtures) garde sa route ; y emmener la
 *   caissière la poserait sur un écran qu'elle n'a jamais vu.
 */
export function clesAtteignables(chemins) {
  const atteignables = new Set(chemins)
  return Object.keys(DESTINATIONS).filter((cle) => atteignables.has(DESTINATIONS[cle].chemin))
}

/** Les clés, pour la déclaration d'outil lue par le modèle : celles de la barre et du compte. */
export const CLES_DESTINATIONS = Object.freeze(clesAtteignables([
  ...STORE_NAV_ITEMS.map((item) => item.path),
  STORE_ACCOUNT_ITEM.path,
]))

/**
 * Résout une clé en destination.
 * @returns {{ok: true, destination: object, cle: string}
 *          | {ok: false, raison: string}}
 */
export function resoudreDestination(cle) {
  if (typeof cle !== 'string' || cle.length === 0) {
    return { ok: false, raison: "Aucun écran n'a été demandé." }
  }
  const destination = DESTINATIONS[cle]
  if (!destination) {
    // Nommé, pas rapproché : on refuse plutôt que d'emmener à côté.
    return { ok: false, raison: `Je ne connais pas d'écran nommé « ${cle} ».` }
  }
  if (!CLES_DESTINATIONS.includes(cle)) {
    return { ok: false, raison: `L'écran « ${destination.libelle} » n'est pas proposé dans cette boutique.` }
  }
  return { ok: true, destination, cle }
}

/** Le catalogue en texte, pour le prompt système. */
export function catalogueLisible() {
  return CLES_DESTINATIONS.map((cle) => `- ${cle} : ${DESTINATIONS[cle].quand}`).join('\n')
}
