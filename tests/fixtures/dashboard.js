/**
 * Fixtures pour TC-011A — useAllTransactions
 *
 * Dataset figé, déterministe :
 *   - aucun Date.now()
 *   - aucun Math.random()
 *   - aucune date relative
 *
 * Règles de nommage :
 *   - pendingTransactions : objets présents dans les drafts Firestore
 *   - completedTransactions : objets présents dans l'historique Firestore
 *   - Les IDs sont des chaînes littérales, préfixées par leur provenance (p- ou c-)
 *     sauf pour les cas de doublon (shared-001).
 */

// ---------------------------------------------------------------------------
// Cas 1 — Union nominale (3 IDs distincts, aucun doublon)
// ---------------------------------------------------------------------------

/** Deux transactions en attente avec des IDs distincts */
export const pendingNominal = [
  {
    id: 'p-alpha',
    type: 'Dépôt',
    montant: 1000,
    statut: 'Non Terminées',
    storeId: 'store-a',
    reseau: 'Orange',
    createdAt: '2026-06-17T08:00:00.000Z',
  },
  {
    id: 'p-beta',
    type: 'Retrait',
    montant: 500,
    statut: 'Non Terminées',
    storeId: 'store-a',
    reseau: 'Moov',
    createdAt: '2026-06-17T09:00:00.000Z',
  },
]

/** Une transaction complétée avec un ID différent des pending */
export const completedNominal = [
  {
    id: 'c-gamma',
    type: 'Dépôt',
    montant: 2000,
    statut: 'Validée',
    storeId: 'store-a',
    reseau: 'Telecel',
    createdAt: '2026-06-17T07:00:00.000Z',
  },
]

// ---------------------------------------------------------------------------
// Cas 2 — Déduplication (id: 'shared-001' présent dans pending ET completed)
//
// Comportement attendu (algorithme Map) :
//   La clé 'shared-001' est insérée lors du parcours de pending (position 0).
//   Lors du parcours de completed, transactionMap.set('shared-001', ...) écrase
//   la VALEUR mais conserve la POSITION d'insertion originale.
//   => dans Array.from(transactionMap.values()), 'shared-001' reste en position 0,
//      avec la valeur de completedShared (pas pendingShared).
// ---------------------------------------------------------------------------

/** Version pending du doublon — statut Non Terminées, montant 300 */
export const pendingShared = [
  {
    id: 'shared-001',
    type: 'Dépôt',
    montant: 300,
    statut: 'Non Terminées',
    storeId: 'store-a',
    reseau: 'Orange',
    createdAt: '2026-06-16T10:00:00.000Z',
  },
]

/** Version completed du doublon — statut Validée, montant 350 (différent pour vérifier l'écrasement) */
export const completedShared = [
  {
    id: 'shared-001',
    type: 'Dépôt',
    montant: 350,
    statut: 'Validée',
    storeId: 'store-a',
    reseau: 'Orange',
    createdAt: '2026-06-16T11:00:00.000Z',
  },
]

// ---------------------------------------------------------------------------
// Cas 3 — Transactions sans id (falsy) : undefined, null, ''
//
// La condition `if (transaction.id)` exclut toutes les valeurs falsy JS :
//   undefined, null, '' (chaîne vide), 0, false, NaN.
// ---------------------------------------------------------------------------

/** Tableau de pending contenant 3 transactions sans id (falsy) + 1 avec id valide */
export const pendingWithFalsyIds = [
  {
    id: undefined,
    type: 'Dépôt',
    montant: 100,
    statut: 'Non Terminées',
    storeId: 'store-a',
  },
  {
    id: null,
    type: 'Retrait',
    montant: 200,
    statut: 'Non Terminées',
    storeId: 'store-a',
  },
  {
    id: '',
    type: 'Crédit',
    montant: 300,
    statut: 'Non Terminées',
    storeId: 'store-a',
  },
  {
    id: 'valid-id-001',
    type: 'Dépôt',
    montant: 400,
    statut: 'Non Terminées',
    storeId: 'store-a',
    reseau: 'Orange',
    createdAt: '2026-06-17T06:00:00.000Z',
  },
]

// ---------------------------------------------------------------------------
// Fixtures TC-011B — useDashboardData
//
// Date de reference figee : 2026-06-17 (horloge figee via vi.setSystemTime).
// Champ de date client : dateAjout (format accepte par parsefrenchDate).
// Champ de date transaction : date (lu par useTodayTransactions).
// Champ montant transaction : montant (lu par getTopTransaction).
// Champ client transaction : client (objet { nom, prenom }) lu par useDashboardData.
// ---------------------------------------------------------------------------

// ---- Clients ---------------------------------------------------------------

/**
 * Client ajoute le jour de reference : 17/06/2026.
 * Comptera dans monthlyClients ET dailyClients.
 */
export const clientToday = {
  id: 'client-today-001',
  nom: 'Dupont',
  prenom: 'Marie',
  dateAjout: '17/06/2026',
}

/**
 * Client ajoute dans le mois de reference (juin 2026) mais pas le jour J.
 * Comptera dans monthlyClients, PAS dans dailyClients.
 */
export const clientThisMonth = {
  id: 'client-month-001',
  nom: 'Martin',
  prenom: 'Paul',
  dateAjout: '05/06/2026',
}

/**
 * Client ajoute hors du mois de reference (janvier 2025).
 * Ne comptera ni dans monthlyClients ni dans dailyClients.
 */
export const clientPreviousMonth = {
  id: 'client-past-001',
  nom: 'Bernard',
  prenom: 'Luc',
  dateAjout: '15/01/2025',
}

/**
 * Client sans champ dateAjout.
 * parsefrenchDate(undefined) => null => exclu de monthlyClients et dailyClients.
 * Comptera uniquement dans totalClients.
 */
export const clientWithoutDate = {
  id: 'client-nodate-001',
  nom: 'Sans',
  prenom: 'Date',
}

// ---- Transactions ----------------------------------------------------------

/**
 * Transaction du jour (17/06/2026) avec le montant le plus eleve.
 * Sera incluse dans todayTransactions.
 * topClient sera construit a partir de client.nom et client.prenom.
 */
export const transactionTopToday = {
  id: 'txn-top-today-001',
  date: '17/06/2026 09:30',
  montant: 5000,
  type: 'Dépôt',
  statut: 'Validée',
  storeId: 'store-a',
  reseau: 'Orange',
  client: {
    nom: 'Dupont',
    prenom: 'Marie',
  },
}

/**
 * Transaction du jour (17/06/2026) avec un montant inferieur.
 * Sera incluse dans todayTransactions mais ne sera pas le top.
 */
export const transactionLowToday = {
  id: 'txn-low-today-001',
  date: '17/06/2026 08:00',
  montant: 1000,
  type: 'Retrait',
  statut: 'Validée',
  storeId: 'store-a',
  reseau: 'Moov',
  client: {
    nom: 'Martin',
    prenom: 'Paul',
  },
}

/**
 * Transaction du 16/06/2026 (hier par rapport a la date de reference).
 * Exclue de todayTransactions.
 */
export const transactionYesterday = {
  id: 'txn-yesterday-001',
  date: '16/06/2026 14:00',
  montant: 8000,
  type: 'Dépôt',
  statut: 'Validée',
  storeId: 'store-a',
  reseau: 'Telecel',
  client: {
    nom: 'Bernard',
    prenom: 'Luc',
  },
}

/**
 * Transaction sans champ date.
 * parsefrenchDate(undefined) => null => exclue de todayTransactions.
 */
export const transactionWithoutDate = {
  id: 'txn-nodate-001',
  montant: 9999,
  type: 'Crédit',
  statut: 'Non Terminées',
  storeId: 'store-a',
  reseau: 'Orange',
  client: {
    nom: 'Inconnu',
    prenom: 'Client',
  },
}

// ---------------------------------------------------------------------------
// Fixtures TC-012 — useTodayTransactions filtrage statut 'Annulée'
//
// Date de reference figee : 2026-06-17 (horloge figee via vi.setSystemTime).
// Ces fixtures couvrent le comportement apres MASTER-SEC-003 :
//   la transaction 'Annulée' ne doit pas apparaitre dans les agregations dashboard.
// ---------------------------------------------------------------------------

/**
 * Transaction du jour (17/06/2026) avec statut 'Annulée'.
 * Doit etre exclue de todayTransactions apres la correction MASTER-SEC-003.
 * Avant la correction : incluse (regression).
 */
export const transactionAnnuleeToday = {
  id: 'txn-annulee-today-001',
  date: '17/06/2026 11:00',
  montant: 3000,
  type: 'Dépôt',
  statut: 'Annulée',
  storeId: 'store-a',
  reseau: 'Orange',
  client: {
    nom: 'Annulé',
    prenom: 'Client',
  },
}

/**
 * Transaction du jour (17/06/2026) avec statut 'Remboursée'.
 * Doit etre incluse dans todayTransactions (pas un statut annule).
 */
export const transactionRembToday = {
  id: 'txn-remb-today-001',
  date: '17/06/2026 10:00',
  montant: 2500,
  type: 'Retrait',
  statut: 'Remboursée',
  storeId: 'store-a',
  reseau: 'Moov',
  client: {
    nom: 'Rembourse',
    prenom: 'Client',
  },
}

/**
 * Transaction du jour (17/06/2026) avec statut 'Non Terminées'.
 * Doit etre incluse dans todayTransactions (statut en attente, pas annule).
 */
export const transactionPendingToday = {
  id: 'txn-pending-today-001',
  date: '17/06/2026 07:00',
  montant: 1500,
  type: 'Dépôt',
  statut: 'Non Terminées',
  storeId: 'store-a',
  reseau: 'Telecel',
  client: {
    nom: 'EnAttente',
    prenom: 'Client',
  },
}
