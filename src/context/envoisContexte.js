import { createContext, useContext } from 'react'

/**
 * La file d'envoi de la session boutique (lot G3b, docs/rester-dans-le-quota-
 * gratuit.md §G3), fournie par `EnvoisProvider`.
 *
 * ⚠ CE MODULE NE DÉPEND DE RIEN, ET C'EST VOULU. Les contextes des
 *   transactions et des clients le lisent : s'il chargeait Firebase, chaque
 *   test qui les monte devrait le simuler. `null` hors du fournisseur : ces
 *   contextes retombent alors sur l'appel direct d'avant la file.
 *
 * `enAttente` est la liste complète (la déconnexion s'y fie) ; `signalerAttente` dit
 * si l'écran doit le montrer, sans clignoter à chaque geste (lot H).
 */
export const EnvoisContext = createContext(null)

export function useEnvois() {
  return useContext(EnvoisContext)
}
