import { useContext, useEffect, useState } from 'react'
import { AuthContext } from '../context/AuthContext.jsx'
import { firestoreService } from '../services/firestore.js'
import { LIAISON_OXYGEN_ACTIVE } from '../services/liaisonOxygenService.js'
import { ligneDeDemande, trierDemandes } from '../utils/demandesAgent.js'
import { useEnLigne } from './useEnLigne.js'
import logger from '../utils/logger.js'

/**
 * Les demandes des agents en attente pour la boutique de la caissière
 * (docs/superpowers/specs/2026-11-17-demandes-agent-design.md §5.5).
 *
 * UNE écoute par session de caisse, sur `etat == 'en_attente'` : quelques
 * centaines de lectures par jour pour toutes les boutiques. La limite de 200
 * borne la lecture ; ce n'est pas une limite du nombre de demandes.
 *
 * ⚠ HORS LIGNE, RIEN. Valider et rejeter exigent le réseau, et une demande
 *   vue depuis le cache de l'appareil a peut-être été annulée par l'agent
 *   depuis. La caissière saisit alors comme avant (contrat §4.2).
 *
 * ⚠ SEUL LE SERVEUR FAIT FOI. `navigator.onLine` dit vrai sur un Wi-Fi sans
 *   internet : l'écoute s'ouvre, et Firestore répond depuis le cache. Ces
 *   réponses-là ne montrent rien. Quand la connexion tombe en cours de
 *   journée, Firestore le signale par une réponse du cache, et les lignes
 *   partent (`includeMetadataChanges`).
 *
 * ⚠ UNE ÉCOUTE REFUSÉE SE TAIT. Tant que la règle n'est pas déployée, la
 *   caisse marche comme avant, sans demande et sans bandeau d'erreur.
 */
const REQUETE = Object.freeze({
  where: [{ field: 'etat', operator: '==', value: 'en_attente' }],
  limitCount: 200,
  includeMetadataChanges: true,
})

export function useDemandesAgent() {
  const { userProfile, activeStore } = useContext(AuthContext) ?? {}
  const enLigne = useEnLigne()
  const storeId = activeStore?.id && activeStore.id === userProfile?.storeId ? activeStore.id : null
  const actif = LIAISON_OXYGEN_ACTIVE && enLigne && Boolean(storeId)
  // Les lignes portent la boutique qui les a lues : changer de boutique ne
  // montre jamais, même un instant, les demandes de la précédente.
  const [lues, setLues] = useState({ storeId: null, lignes: [] })

  useEffect(() => {
    if (!actif) return undefined
    const recevoir = (documents, _changements, origine) => {
      const lignes = origine?.depuisServeur === true ? documents.map((d) => ligneDeDemande(d.id, d)) : []
      setLues({ storeId, lignes: trierDemandes(lignes) })
    }
    recevoir.onError = (erreur) => {
      logger.user.error('Demandes des agents', erreur)
      setLues({ storeId, lignes: [] })
    }
    const arreter = firestoreService.subscribeToCollection('demandesAgent', recevoir, REQUETE)
    return () => arreter?.()
  }, [actif, storeId])

  return { demandes: actif && lues.storeId === storeId ? lues.lignes : [] }
}
