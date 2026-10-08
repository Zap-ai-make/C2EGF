/**
 * storeProfile.js — axes BOUTIQUE du profil client, côté Cloud Functions.
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ FICHIER GÉNÉRÉ par scripts/generate-functions-config.mjs depuis le profil client
 * (config/clients/<id>.js). NE PAS ÉDITER À LA MAIN.
 *
 * Alimente les collaborations inter-boutiques et les dettes internes :
 *   • STORE_NETWORKS           — réseaux opérés par les boutiques. Le réseau d'une
 *     collaboration est RÉSOLU ici, jamais accepté du client. Sert aussi à décider
 *     si un règlement déplace du stock (méthode mappée sur un réseau) ou non.
 *   • COLLABORATIONS_ENABLED   — false ⇒ tous les callables du module refusent.
 *   • DEBT_SETTLEMENT_METHODS  — méthodes déclarables pour rembourser une dette
 *     (méthodes du profil + « Banque »). Volontairement distinct des méthodes de
 *     règlement d'une transaction client.
 *
 *   • STORE_REPLENISHMENT_SENDERS — expéditeurs prédéfinis d'un ravitaillement.
 *     Liste OUVERTE : la boutique peut ajouter un nom, qui est alors mémorisé sur
 *     son document « stores/<storeId> ». Cette liste-ci n'est donc pas un
 *     garde-fou d'autorisation — un expéditeur est une étiquette, pas une
 *     permission —, seulement le vocabulaire commun qui évite que trois
 *     orthographes d'un même nom deviennent trois créanciers.
 *
 * ⚠ Ces méthodes ne sont validées qu'à la DÉCLARATION d'une tranche, jamais à sa
 * confirmation : une tranche portant un ancien code doit rester confirmable.
 */
export const STORE_NETWORKS = ['Orange']

export const STORE_TRANSACTION_TYPES = ['Dépôt', 'Retrait']

export const STORE_PAYMENT_METHODS = ['Orange Money', 'Cash']

export const CASHIER_CAN_EDIT_BALANCES = false

export const COLLABORATIONS_ENABLED = true

export const DEBT_SETTLEMENT_METHODS = ['Orange Money', 'Cash', 'Banque']

export const STORE_REPLENISHMENT_SENDERS = ['Patron', 'Mme Sawadogo', 'Mohamed', 'DG', 'Maï', 'Yasmine']
