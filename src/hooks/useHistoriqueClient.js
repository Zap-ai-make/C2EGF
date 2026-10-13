import { useCallback, useEffect, useRef, useState } from 'react'
import { chargerHistoriqueClient } from '../services/clientHistoryService.js'

/**
 * Le cumul des pages de l'historique d'un agent.
 *
 * ⚠ ON DÉDOUBLONNE À CHAQUE PAGE. Une opération écrite pendant la lecture décale
 *   la pagination et peut faire revenir un document déjà affiché. Deux lignes
 *   identiques dans une liste d'argent se lisent comme deux opérations.
 *
 * ⚠ UN CHANGEMENT DE CLIENT REMET TOUT À ZÉRO. Sans ça, ouvrir le panneau d'un
 *   second agent lui empilerait les pages du premier — et le panneau afficherait
 *   sous son nom des opérations qui ne sont pas les siennes.
 *
 * ⚠ LE CURSEUR EST OPAQUE : `{ chemin: string }`, le chemin du dernier document
 *   lu côté serveur. Le hook ne l'inspecte jamais ni ne le reconstruit — il le
 *   reçoit dans `curseurSuivant` et le renvoie tel quel au service.
 */
export function useHistoriqueClient(clientId) {
  const [etat, setEtat] = useState('inactif')
  const [erreur, setErreur] = useState(null)
  const [enCours, setEnCours] = useState([])
  const [lignes, setLignes] = useState([])
  const [totaux, setTotaux] = useState(null)
  const [encore, setEncore] = useState(false)
  const curseurRef = useRef(null)
  // Le client EN COURS de chargement : une réponse arrivée après un changement
  // de client ne doit pas s'afficher sous le nom du nouveau.
  const clientRef = useRef(null)
  /**
   * ⚠ LE VERROU RETIENT POUR QUI IL A ÉTÉ POSÉ, et pas seulement qu'il est posé.
   *   Un booléen ne suffisait pas, pour deux raisons qui se ressemblent :
   *
   *   · `StrictMode` rejoue l'effet de montage sans que rien ne distingue ce
   *     rejeu d'un vrai changement de client. Un verrou booléen qu'on relâche
   *     « parce que le client a changé » se relâche donc aussi au rejeu, et
   *     laisse partir un second appel de Cloud Function, payé pour rien.
   *   · La réponse tardive d'une requête périmée relâchait le verrou d'une
   *     requête qui, elle, était toujours en vol.
   *
   *   En y mettant l'identifiant du client, les deux disparaissent : un second
   *   appel pour le MÊME client est refusé, un appel pour un AUTRE client passe,
   *   et seule la requête qui détient le verrou peut le rendre.
   */
  const enVolRef = useRef(null)

  const charger = useCallback(async (id, curseur) => {
    if (enVolRef.current === id) return
    enVolRef.current = id
    clientRef.current = id
    setEtat(curseur ? 'chargementPage' : 'chargement')
    setErreur(null)
    try {
      const reponse = await chargerHistoriqueClient(id, curseur)
      if (clientRef.current !== id) return

      setLignes((precedentes) => {
        const base = curseur ? precedentes : []
        const vues = new Set(base.map((l) => l.id))
        return [...base, ...(reponse.lignes ?? []).filter((l) => !vues.has(l.id))]
      })
      if (!curseur) {
        setEnCours(reponse.enCours ?? [])
        setTotaux(reponse.totaux ?? null)
      }
      curseurRef.current = reponse.curseurSuivant ?? null
      setEncore(Boolean(reponse.encore))
      setEtat('pret')
    } catch (err) {
      if (clientRef.current !== id) return
      setErreur(err?.message || 'Impossible de charger l’historique.')
      setEtat('erreur')
    } finally {
      // Seul le détenteur rend le verrou : une réponse périmée ne doit pas
      // libérer la requête qui lui a succédé.
      if (enVolRef.current === id) enVolRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!clientId) {
      clientRef.current = null
      curseurRef.current = null
      setEtat('inactif')
      setLignes([])
      setEnCours([])
      setTotaux(null)
      setEncore(false)
      return
    }
    curseurRef.current = null
    setLignes([])
    setEnCours([])
    setTotaux(null)
    void charger(clientId, null)
  }, [clientId, charger])

  const chargerPlus = useCallback(async () => {
    if (!clientId || !encore || !curseurRef.current) return
    await charger(clientId, curseurRef.current)
  }, [charger, clientId, encore])

  const reessayer = useCallback(async () => {
    if (!clientId) return
    await charger(clientId, curseurRef.current)
  }, [charger, clientId])

  return { enCours, lignes, totaux, etat, erreur, encore, chargerPlus, reessayer }
}
