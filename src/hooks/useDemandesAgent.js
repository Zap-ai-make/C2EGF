import { useContext, useEffect, useRef, useState } from 'react'
import { AuthContext } from '../context/AuthContext.jsx'
import { firestoreService } from '../services/firestore.js'
import { LIAISON_OXYGEN_ACTIVE } from '../services/liaisonOxygenService.js'
import { ligneDeDemande, trierDemandes } from '../utils/demandesAgent.js'
import { sonnerDemande } from '../utils/sonDemande.js'
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
 *   internet : l'écoute s'ouvre, et Firestore répond depuis le cache
 *   (`includeMetadataChanges` marque chaque réponse). Une réponse du cache
 *   peut RETIRER une demande, jamais en montrer une que le serveur n'a pas
 *   confirmée.
 *
 * ⚠ ET LE CACHE RÉPOND AUSSI EN LIGNE. Chaque fois qu'une demande se ferme,
 *   Firestore répond depuis le cache le temps de reconfirmer (~300 ms à
 *   l'essai réel). Vider le tableau à chaque fois le ferait clignoter sous le
 *   doigt de la caissière. Les demandes confirmées restent donc ; c'est après
 *   `SANS_SERVEUR_MS` sans le serveur — la connexion est tombée sans que le
 *   poste le sache — qu'elles partent.
 *
 * ⚠ UNE ÉCOUTE REFUSÉE SE TAIT. Tant que la règle n'est pas déployée, la
 *   caisse marche comme avant, sans demande et sans bandeau d'erreur.
 *
 * CE QUI ARRIVE SE SIGNALE (demandé par l'utilisateur le 2026-11-27) : un
 * petit son, et `arrivees` — l'instant où ce poste a vu chaque demande
 * arriver — pour que sa ligne pulse. Seul le serveur annonce une arrivée.
 * Ce qui attendait déjà quand l'écran s'ouvre ne sonne pas ; ce qui est arrivé
 * pendant une coupure sonne au retour du réseau.
 */
export const SANS_SERVEUR_MS = 10_000

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
  const [arrivees, setArrivees] = useState(() => new Map())
  // Ce que le serveur a montré en dernier, pour cette boutique. Il survit à
  // une coupure — ce qui arrive entre-temps sonne au retour — mais pas à
  // l'écran qu'on quitte : ce qui attend à l'ouverture ne sonne pas.
  const vues = useRef({ storeId: null, ids: null })

  useEffect(() => {
    if (!actif) return undefined
    // Les demandes que le serveur a confirmées en dernier, et l'attente qui
    // court depuis la première réponse du cache qui a suivi.
    let confirmees = new Set()
    let sansServeur = null
    const montrer = (documents) => {
      setLues({ storeId, lignes: trierDemandes(documents.map((d) => ligneDeDemande(d.id, d))) })
    }
    const signalerArrivees = (ids) => {
      const avant = vues.current.storeId === storeId ? vues.current.ids : null
      vues.current = { storeId, ids }
      if (!avant) return
      const nouvelles = [...ids].filter((id) => !avant.has(id))
      if (nouvelles.length === 0) return
      const le = Date.now()
      setArrivees((precedentes) => {
        const suivantes = new Map([...precedentes].filter(([id]) => ids.has(id)))
        for (const id of nouvelles) suivantes.set(id, le)
        return suivantes
      })
      sonnerDemande()
    }
    const recevoir = (documents, _changements, origine) => {
      if (origine?.depuisServeur === true) {
        clearTimeout(sansServeur)
        sansServeur = null
        confirmees = new Set(documents.map((d) => d.id))
        signalerArrivees(confirmees)
        montrer(documents)
        return
      }
      montrer(documents.filter((d) => confirmees.has(d.id)))
      sansServeur ??= setTimeout(() => {
        confirmees = new Set()
        setLues({ storeId, lignes: [] })
      }, SANS_SERVEUR_MS)
    }
    recevoir.onError = (erreur) => {
      logger.user.error('Demandes des agents', erreur)
      setLues({ storeId, lignes: [] })
    }
    const arreter = firestoreService.subscribeToCollection('demandesAgent', recevoir, REQUETE)
    return () => {
      clearTimeout(sansServeur)
      arreter?.()
    }
  }, [actif, storeId])

  return { demandes: actif && lues.storeId === storeId ? lues.lignes : [], arrivees }
}
