import { activeProfile } from '../config/activeClientProfile.js'

// Constantes réseau et codes associés (référentiel produit, indépendant du profil)
export const NETWORK_CODES = {
  'Orange': '000001',
  'Moov': '000626',
  'Telecel': '000002',
  'Coris': '000003',
  'Sank': '000004'
}

// Options réseau visibles pour CE client — dérivées du profil client actif
// (networks.enabled). Ex. TAOFIC → ['Orange'] ; pilote → les 5 réseaux.
export const NETWORK_OPTIONS = [...activeProfile.networks.enabled]

// Types de transaction — dérivés du profil (transactions.types).
// Ex. TAOFIC → Dépôt/Retrait ; pilote → Dépôt/Retrait/Crédit.
export const TRANSACTION_TYPES = activeProfile.transactions.types.map(
  (type) => ({ value: type, label: type })
)

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
    MODIFICATION_CANCELLED: 'Modification annulée',
    IMPORT_SUCCESS: (count) => `${count} transactions importées avec succès !`
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
