/**
 * annuaireClients.js — lire la base clients par l'annuaire, et seulement s'il est complet.
 *
 * L'annuaire range les ~15 700 fiches de `globalClients` en 64 documents, tenus
 * à jour côté serveur (`functions/src/clients/annuaireClients.js`). Un
 * chargement complet coûte 64 lectures au lieu de ~15 700
 * (docs/rester-dans-le-quota-gratuit.md §A1).
 *
 * ⚠ L'ÉCOUTE DE `globalClients` RESTE LE REPLI, ET C'EST CE QUI REND LE
 *   DÉPLOIEMENT SANS DANGER, DANS N'IMPORTE QUEL ORDRE. Tant que `_etat` ne dit
 *   pas `complet` — annuaire pas encore rempli, remplissage interrompu — ou si
 *   la lecture est refusée — règles pas encore déployées —, la liste vient de
 *   l'ancien chemin, entière. Dès que l'annuaire est complet, le repli se ferme.
 */

export const COLLECTION_ANNUAIRE = 'annuaireClients'
export const DOC_ETAT = '_etat'

/**
 * Les documents de l'annuaire, ramenés aux fiches `{ id, ...champs }` que
 * l'application lit depuis toujours. `complet: false` tant que `_etat` ne le dit pas.
 *
 * @param {Array<{ id: string, data: () => object }>} docs
 */
export function lireAnnuaire(docs) {
  const etat = docs.find((d) => d.id === DOC_ETAT)?.data()
  if (etat?.complet !== true) return { complet: false, clients: [] }

  const clients = []
  for (const d of docs) {
    if (d.id === DOC_ETAT) continue
    for (const [id, entree] of Object.entries(d.data()?.entrees ?? {})) {
      clients.push({ id, ...entree })
    }
  }
  return { complet: true, clients }
}

/**
 * Écoute l'annuaire ; ouvre le repli tant qu'il n'est pas utilisable.
 *
 * @param {{ ecouterAnnuaire: Function, ecouterRepli: Function }} sources
 *   chacune reçoit un callback (avec `.onError`) et rend son désabonnement
 * @param {{ onNext: Function, onError?: Function }} observer
 * @returns {() => void} ferme l'annuaire ET le repli
 */
export function ecouterAvecRepli({ ecouterAnnuaire, ecouterRepli }, observer) {
  let arrete = false
  let fermerRepli = null

  const surRepli = (clients) => observer.onNext(clients)
  surRepli.onError = (err) => observer.onError?.(err)

  const ouvrirRepli = () => {
    if (arrete || fermerRepli) return
    fermerRepli = ecouterRepli(surRepli)
  }

  const surAnnuaire = ({ complet, clients }) => {
    if (arrete) return
    if (!complet) {
      ouvrirRepli()
      return
    }
    const fermer = fermerRepli
    fermerRepli = null
    fermer?.()
    observer.onNext(clients)
  }
  // Une lecture refusée (règles pas encore déployées) ou une écoute tombée
  // ne laisse pas l'écran sans liste : on repasse par `globalClients`. La
  // cause reste en console ; l'écran, lui, n'a rien perdu.
  surAnnuaire.onError = (err) => {
    console.warn('Annuaire des clients indisponible, repli sur globalClients :', err?.code ?? err)
    ouvrirRepli()
  }

  const fermerAnnuaire = ecouterAnnuaire(surAnnuaire)

  return () => {
    arrete = true
    fermerAnnuaire?.()
    const fermer = fermerRepli
    fermerRepli = null
    fermer?.()
  }
}
