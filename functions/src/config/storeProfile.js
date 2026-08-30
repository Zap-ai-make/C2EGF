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
 * ⚠ Ces méthodes ne sont validées qu'à la DÉCLARATION d'une tranche, jamais à sa
 * confirmation : une tranche portant un ancien code doit rester confirmable.
 */
export const STORE_NETWORKS = ['Orange']

export const COLLABORATIONS_ENABLED = true

export const DEBT_SETTLEMENT_METHODS = ['Orange Money', 'Cash', 'Banque']
