import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { subscribeDealerBalance } from '../services/storeTransferService'
import { emptyDealerInventory } from '../utils/dealerInventory'

/**
 * L'inventaire du dealer — ses deux cuves, et ses compteurs de flux.
 *
 * POURQUOI CE HOOK EXISTE
 * ───────────────────────
 * L'abonnement vivait dans `DealerInventoryBar`, qui était la seule chose à
 * l'afficher. Depuis la refonte du poste (spec S3), les cuves apparaissent à
 * DEUX endroits : dans la barre latérale, où l'on peut les ajuster, et en
 * résumé dans l'en-tête mobile, où la barre n'est pas dépliée. Deux vues, une
 * seule source — sinon elles divergeraient au premier oubli.
 *
 * DEUX CONSOMMATEURS, UNE SEULE ÉCOUTE RÉSEAU
 * ───────────────────────────────────────────
 * Le hook est appelé deux fois, donc `onSnapshot` l'est aussi. Ce n'est pas un
 * doublon coûteux : le SDK Firestore multiplexe les écoutes portant sur la même
 * cible — un seul flux part vers le serveur, et les deux abonnés reçoivent la
 * même donnée. Lifter l'état dans un contexte n'apporterait rien de plus, et
 * empêcherait `DealerInventoryBar` d'être monté seul par les tests.
 *
 * Le rôle est vérifié ici : un non-dealer n'ouvre aucune écoute et lit un
 * inventaire vide. C'est la même garde qu'auparavant, simplement déplacée.
 */
export function useDealerInventory() {
  const { currentUser, userProfile } = useAuth()
  const [inventory, setInventory] = useState(emptyDealerInventory())

  const dealerUid = currentUser?.uid
  const isDealer = userProfile?.role === 'dealer'

  useEffect(() => {
    if (!isDealer || !dealerUid) {
      setInventory(emptyDealerInventory())
      return undefined
    }
    return subscribeDealerBalance({ dealerUid, onUpdate: setInventory })
  }, [dealerUid, isDealer])

  return { inventory, isDealer }
}

export default useDealerInventory
