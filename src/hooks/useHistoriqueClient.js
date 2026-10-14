import { useCallback, useEffect, useRef, useState } from 'react'
import { chargerHistoriqueClient, CODE_CURSEUR_PERIME } from '../services/clientHistoryService.js'

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
  // Le jeton de la requête EN COURS. Incrémenté à chaque appel : une réponse ne
  // s'applique que si son jeton est encore le jeton courant.
  const jetonRef = useRef(0)
  /**
   * ⚠ LE VERROU PORTE UN JETON, PAS SEULEMENT UN IDENTIFIANT DE CLIENT.
   *   Un verrou qui ne retient que le client suffit à refuser un second appel
   *   pour ce client — mais pas à savoir LAQUELLE de deux requêtes successives
   *   le détient. Deux conséquences, toutes deux vécues :
   *
   *   · fermer le panneau puis rouvrir LE MÊME client avant que la première
   *     requête ne réponde : le second appel était refusé par un verrou que plus
   *     personne ne surveillait, et l'écran restait vide en annonçant « aucune
   *     opération » — sur un agent qui en a.
   *   · aller sur un autre client puis revenir : la réponse de la PREMIÈRE
   *     requête rendait le verrou de la seconde, encore en vol.
   *
   *   Le jeton s'incrémente à chaque appel. Une réponse ne s'applique que si son
   *   jeton est encore le jeton courant, et ne rend le verrou que si elle le
   *   détient toujours. `StrictMode` reste couvert : son rejeu demande le MÊME
   *   client sans que le jeton ait changé, donc il est refusé.
   */
  const enVolRef = useRef(null) // { id, jeton } de la requête qui détient le verrou

  const charger = useCallback(async (id, curseur) => {
    if (enVolRef.current?.id === id) return
    const jeton = jetonRef.current + 1
    jetonRef.current = jeton
    enVolRef.current = { id, jeton }
    setEtat(curseur ? 'chargementPage' : 'chargement')
    setErreur(null)
    try {
      const reponse = await chargerHistoriqueClient(id, curseur)
      if (jetonRef.current !== jeton) return

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
      if (jetonRef.current !== jeton) return
      // ⚠ UN CURSEUR PÉRIMÉ SE JETTE, SINON « RÉESSAYER » BOUCLE À VIE. Le
      //   serveur refuse un repère dont le document a disparu — ce qui arrive
      //   pour de vrai : `reopenHistory` supprime la ligne d'historique qu'il
      //   remet en brouillon. Sans cette remise à zéro, `reessayer` rejoue le
      //   MÊME curseur et échoue identiquement, et la seule sortie
      //   (fermer puis rouvrir) n'est écrite nulle part à l'écran.
      if (err?.code === CODE_CURSEUR_PERIME) curseurRef.current = null
      setErreur(err?.message || 'Impossible de charger l’historique.')
      setEtat('erreur')
    } finally {
      // Seul le jeton qui détient encore le verrou peut le rendre : une
      // réponse périmée ne doit pas libérer la requête qui lui a succédé.
      if (enVolRef.current?.jeton === jeton) enVolRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!clientId) {
      curseurRef.current = null
      // On quitte : plus aucune requête ne détient légitimement le verrou, et
      // l'effet ne se redéclenchera pas tout seul si l'on revient sur le MÊME
      // client. Sans cette libération, rouvrir la même fiche n'affiche rien.
      enVolRef.current = null
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
    // `encore` est remis à zéro ici AUSSI, comme dans la branche de fermeture.
    // L'asymétrie était sans effet visible — le bouton n'existe que si des
    // lignes sont déjà affichées — mais laisser un `encore` du client précédent
    // dans l'état d'un nouveau client est un piège pour la prochaine retouche.
    setEncore(false)
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
