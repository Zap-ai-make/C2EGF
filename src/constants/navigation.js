/**
 * Les destinations de l'espace boutique, en DEUX GROUPES.
 *
 *   courant      la journée en cours : l'état du jour, et les endroits où l'on agit
 *   referentiel  ce qu'on va chercher : les consultations
 *
 * Le groupe n'est pas décoratif, et c'est tout l'intérêt d'en faire une donnée
 * plutôt qu'un ordre dans un tableau (DESIGN.md §6 : la structure encode du sens).
 * Il porte un invariant :
 *
 *   ⚠ UN COMPTEUR D'ATTENTE NE PEUT APPARAÎTRE QUE SUR LE GROUPE `courant`.
 *
 * Raison : un compteur veut dire « quelqu'un attend une réponse de vous », et on
 * ne répond qu'à l'endroit où l'on agit. Un compteur sur « Clients » parce qu'un
 * client vient d'être créé serait une nouveauté, pas une attente — et trois
 * pastilles rouges qui diraient trois choses différentes ne seraient plus un
 * système, seulement du bruit. `assertCompteurAutorise` ci-dessous rend cette
 * règle exécutable au lieu de la laisser en commentaire.
 *
 * `Profil` a quitté cette liste. Ce n'est pas une destination sœur des autres :
 * c'est le compte. Il est rendu à part, à droite de la barre, et la rangée y
 * gagne une place — ce qui laisse le module Dettes internes s'y installer sans
 * que la barre grossisse.
 */

import { COLLABORATIONS_ENABLED } from './collaborationConstants.js'

export const NAV_GROUPS = Object.freeze({
  COURANT: 'courant',
  REFERENTIEL: 'referentiel',
})

export const INTERNAL_DEBTS_PATH = '/dettes'

/**
 * ⚠ La liste VARIE selon le profil client : « Dettes internes » n'existe que si
 *   `collaborations.enabled` l'autorise. C'est l'état « désactivé » de
 *   DESIGN.md §10, traité comme il doit l'être — l'entrée n'existe pas du tout.
 *   Pas de page grisée, pas de bouton mort : un gérant ne doit jamais voir une
 *   porte qu'il ne peut pas ouvrir. La route est absente pour la même raison.
 */
export const STORE_NAV_ITEMS = [
  { name: 'Tableau de bord', path: '/',                group: NAV_GROUPS.COURANT },
  { name: 'Transactions',    path: '/transactions',    group: NAV_GROUPS.COURANT },
  { name: 'Formulaire',      path: '/formulaire',      group: NAV_GROUPS.COURANT },
  { name: 'Demandes Dealer', path: '/dealer-requests', group: NAV_GROUPS.COURANT },
  ...(COLLABORATIONS_ENABLED
    ? [{ name: 'Dettes internes', path: INTERNAL_DEBTS_PATH, group: NAV_GROUPS.COURANT }]
    : []),
  { name: 'Clients',         path: '/clients',         group: NAV_GROUPS.REFERENTIEL },
  { name: 'Historique',      path: '/historique',      group: NAV_GROUPS.REFERENTIEL },
]

/** Le compte. Rendu à droite de la barre, jamais dans la rangée. */
export const STORE_ACCOUNT_ITEM = { name: 'Profil', path: '/profil' }

export function navItemsOfGroup(group) {
  return STORE_NAV_ITEMS.filter((item) => item.group === group)
}

/**
 * L'invariant, sous forme exécutable : rendre un compteur sur une destination
 * de consultation est un défaut de conception, pas une variation d'affichage.
 * On le fait tomber en développement et en test, jamais en production — un
 * gérant n'a pas à perdre sa barre de navigation pour une pastille mal placée.
 */
export function assertCompteurAutorise(path) {
  const item = STORE_NAV_ITEMS.find((entry) => entry.path === path)
  if (item && item.group !== NAV_GROUPS.COURANT && import.meta.env?.DEV) {
    throw new Error(
      `Compteur interdit sur « ${item.name} » (${path}) : un compteur signale une ` +
      `attente, et on n'agit que dans le groupe « ${NAV_GROUPS.COURANT} ».`,
    )
  }
  return true
}

export const ADMIN_NAV_ITEMS = [
  { name: 'Vue générale', path: '/admin', section: 'main' },
  { name: 'Boutiques', path: '/admin/stores', section: 'supervision' },
  { name: 'Utilisateurs', path: '/admin/users', section: 'supervision' },
  { name: 'Dealer', path: '/admin/dealer', section: 'supervision' },
  { name: 'Inventaire Dealer', path: '/admin/dealer-inventory', section: 'supervision' },
  { name: 'Clients', path: '/admin/clients', section: 'supervision' },
  { name: 'Historique', path: '/admin/history', section: 'supervision' },
  { name: 'Rapports', path: '/admin/reports', section: 'supervision' },
  { name: 'Profil', path: '/admin/profile', section: 'admin' },
]

export const DEALER_NAV_ITEMS = [
  { name: 'Vue générale', path: '/dealer' },
  { name: 'Boutiques', path: '/dealer/stores' },
  { name: 'Ravitaillements', path: '/dealer/requests' },
  { name: 'Retours boutiques', path: '/dealer/transfers' },
  { name: 'Historique', path: '/dealer/history' },
  { name: 'Profil', path: '/dealer/profile' },
]
