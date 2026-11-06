import { activeProfile } from '../config/activeClientProfile.js'

// Options réseau visibles pour CE client — dérivées du profil client actif
// (networks.enabled). Ex. TAOFIC → ['Orange'] ; pilote → les 5 réseaux.
export const NETWORK_OPTIONS = [...activeProfile.networks.enabled]

// Types de transaction — dérivés du profil (transactions.types).
// Ex. TAOFIC → Dépôt/Retrait ; pilote → Dépôt/Retrait/Crédit.
export const TRANSACTION_TYPES = activeProfile.transactions.types.map(
  (type) => ({ value: type, label: type })
)

/**
 * Les mouvements de la BOUTIQUE, par opposition aux transactions d'un client.
 *
 * Ils vivent dans la même collection `history` — c'est le même registre, et
 * c'est voulu : un solde ne se reconstitue qu'en relisant tout ce qui l'a fait
 * bouger. Mais ils n'ont ni client ni code agent, et s'affichaient donc sous
 * « Client inconnu » avec une colonne vide au milieu des dépôts d'agents.
 *
 * D'où cette liste : un seul endroit décide ce qui relève du registre de la
 * boutique, et les deux écrans (onglet clients, onglet Ravitaillement) s'y
 * réfèrent au lieu de recopier chacun ses noms de types.
 *
 * Le RETOUR y est entré le 31 octobre 2026 : rendu au dealer, il n'a pas plus
 * de client qu'un ravitaillement, et « polluait l'historique des clients » —
 * il se lit désormais sous sa livraison, dans l'onglet Ravitaillement.
 */
export const STORE_MOVEMENT_TYPES = ['Ravitaillement', 'Retour', 'Clôture']

/**
 * Une ligne à la corbeille.
 *
 * Le test porte sur `deletedAt` et NON sur le statut. Deux raisons, et la
 * seconde compte autant que la première :
 *
 *   1. Une ligne « Annulée » d'avant ce lot n'a pas été supprimée par qui que
 *      ce soit — elle a été annulée pour une raison métier. La faire tomber
 *      dans la corbeille réécrirait son histoire a posteriori.
 *   2. `deletedAt` porte l'information dont la corbeille a besoin pour trier
 *      et pour dire « supprimée par Awa à 15h10 ». Un statut ne dit que quoi,
 *      jamais quand ni par qui.
 */
export const estSupprimee = (transaction) => Boolean(transaction?.deletedAt)

// Méthodes de paiement — dérivées du profil (transactions.paymentMethods).
export const PAYMENT_METHODS = [...activeProfile.transactions.paymentMethods]

// Styles pour les types de transactions — le SENS du mouvement d'argent.
//
// C'etait un code couleur decoratif : depot vert, retrait bleu, credit rouge.
// Le rouge disait « erreur » d'un credit qui est une operation normale, et le
// bleu du retrait ne se rattachait a rien. Les jetons de src/index.css portent
// la distinction que l'application confondait (DESIGN.md §5) :
//
//   Depot   l'agent apporte des especes, la liquidite ENTRE   -> inflow
//   Retrait l'agent repart avec des especes, la liquidite SORT -> outflow
//   Credit  avance non reglee, en attente — ni entree, ni echec -> pending
//
// `outflow` n'est PAS `danger` : un retrait est un mouvement normal.
//
// `bgColor` teintait la LIGNE entiere, sur toute sa largeur. A quarante lignes,
// le tableau devenait un aplat rose et vert ou la couleur ne distinguait plus
// rien : elle tapissait. Vu a la capture, corrige aussitot. La teinte ne porte
// plus que les deux cellules qui disent le sens -- le type et le montant. Le
// fond reste disponible pour les listes courtes ou une ligne doit ressortir en
// bloc (le formulaire de nature d'operation s'en sert).
export const TRANSACTION_STYLES = {
  'Retrait': {
    textColor: 'text-outflow',
    bgColor: 'bg-outflow-soft'
  },
  'Dépôt': {
    textColor: 'text-inflow',
    bgColor: 'bg-inflow-soft'
  },
  'Crédit': {
    textColor: 'text-pending',
    bgColor: 'bg-pending-soft'
  },
  default: {
    textColor: 'text-ink-muted',
    bgColor: 'bg-canvas'
  }
}

// Configuration pour l'export Excel
export const EXPORT_CONFIG = {
  COLUMN_WIDTHS: [
    { wch: 5 },   // N°
    { wch: 20 },  // Date & Heure  
    { wch: 25 },  // Client
    { wch: 10 },  // Type
    { wch: 15 },  // Réseau
    { wch: 10 },  // Code
    { wch: 15 },  // Montant
    { wch: 10 },  // Statut
    { wch: 25 }   // Email
  ],
  SHEET_NAME: 'Historique',
  FILE_EXTENSIONS: '.xlsx,.xls,.xlsm'
}

// Messages d'erreur et de succès
export const MESSAGES = {
  ERRORS: {
    FORM_INCOMPLETE: 'Veuillez remplir tous les champs',
    NO_EXPORT_DATA: 'Aucune transaction à exporter',
    IMPORT_ERROR: 'Erreur lors de l\'import du fichier. Vérifiez le format.',
    TRANSACTION_NOT_FOUND: 'Transaction introuvable'
  },
  SUCCESS: {
    TRANSACTION_SAVED: 'Transaction sauvée en attente',
    TRANSACTION_VALIDATED: 'Transaction validée',
    TRANSACTION_MODIFIED: 'Transaction modifiée avec succès',
    // Message distinct : après la correction d'une ligne rouverte, le gérant
    // doit savoir qu'elle est REPARTIE dans l'historique. « Modifiée avec
    // succès » le laisserait la chercher dans les non terminées, où elle n'est
    // plus.
    TRANSACTION_CORRECTED: 'Transaction corrigée et replacée dans l’historique',
    MODIFICATION_CANCELLED: 'Modification annulée',
    IMPORT_SUCCESS: (count) => `${count} transactions importées avec succès !`
  },
  // Lot G3b : l'opération est écrite sur l'appareil et partira seule. Ni
  // « sauvée » ni « validée » : le serveur ne l'a pas encore vue, et elle peut
  // encore être refusée. Ni « pas de réseau » : un serveur qui démarre à froid
  // peut dépasser l'attente du formulaire, réseau présent.
  EN_ATTENTE: {
    TRANSACTION: 'Connexion absente ou lente : la transaction est gardée sur cet appareil et partira dès que possible.',
    REGLEMENT: 'Connexion absente ou lente : le règlement est gardé sur cet appareil et partira dès que possible.',
    CLIENT: 'Connexion absente ou lente : la fiche est gardée sur cet appareil et partira dès que possible.',
  }
}

// Configuration des filtres
export const FILTER_CONFIG = {
  SEARCH_DEBOUNCE_MS: 300,
  DAYS_PER_PAGE: 7,
  DATE_FORMAT: {
    locale: 'fr-FR',
    options: {
      day: '2-digit',
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }
  }
}
