import { useState, useEffect } from 'react'
import { subscribeIncomingCollaborationsCount } from '../services/collaborationService'

/**
 * Le nombre de collaborations reçues qui attendent MON exécution.
 *
 * POURQUOI UN HOOK PLUTÔT QU'UN ABONNEMENT DANS CHAQUE APPELANT
 * ─────────────────────────────────────────────────────────────
 * Ce compteur est lu à DEUX endroits qui ne se voient pas : la barre de
 * navigation, qui doit alerter même quand l'écran est fermé, et l'onglet
 * « Collaborations », qui doit dire la même chose quand il est ouvert. Deux
 * abonnements écrits séparément finiraient par diverger sur un détail — la
 * remise à zéro au changement de boutique, ou l'arrêt au démontage — et deux
 * chiffres différents pour la même file feraient douter le gérant de ce qu'il
 * lit.
 *
 * Sans boutique, il vaut 0 et n'ouvre rien : un profil incomplet ne doit pas
 * faire tomber la barre de navigation.
 */
export function useIncomingCollaborationsCount(storeId) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    setCount(0)
    if (!storeId) return undefined
    return subscribeIncomingCollaborationsCount({ storeId, onUpdate: setCount })
  }, [storeId])

  return count
}

export default useIncomingCollaborationsCount
