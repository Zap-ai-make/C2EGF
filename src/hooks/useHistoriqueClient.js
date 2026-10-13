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
  // ⚠ UNE SEULE REQUÊTE EN VOL À LA FOIS, ET CE N'EST PAS UNE OPTIMISATION.
  //   `StrictMode` double-invoque l'effet de montage en développement : sans
  //   cette garde, chaque ouverture du panneau part en DEUX appels de Cloud
  //   Function, payés deux fois. Et deux clics rapprochés sur « Charger plus »
  //   repartent tous les deux avec le même curseur. `clientRef` ne couvre pas ce
  //   cas : il protège d'un changement de client, pas d'un second appel pour le
  //   même. Même garde que `useRealtimePaginatedRequests.js:78`.
  const enVolRef = useRef(false)

  const charger = useCallback(async (id, curseur) => {
    if (enVolRef.current) return
    enVolRef.current = true
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
      // Toujours relâchée, même en erreur : sinon le hook reste bloqué à
      // jamais et `reessayer` ne repart plus.
      enVolRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!clientId) {
      clientRef.current = null
      curseurRef.current = null
      enVolRef.current = false
      setEtat('inactif')
      setLignes([])
      setEnCours([])
      setTotaux(null)
      setEncore(false)
      return
    }
    curseurRef.current = null
    // Un changement de client est légitime même si une requête de l'ANCIEN est
    // encore en vol : on relâche la garde pour que le nouveau parte quand même.
    // La réponse tardive de l'ancien est déjà écartée par `clientRef` ci-dessus.
    enVolRef.current = false
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
