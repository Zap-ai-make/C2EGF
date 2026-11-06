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
 *
 * Depuis le lot G2, l'annuaire est gardé sur l'appareil (`copieAnnuaire.js`) et
 * relu par différence : voir `ecouterAnnuaireGarde`.
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

/**
 * Au-delà de ce nombre de tranches, l'écoute des changements est rouverte à
 * partir de la plus récente.
 *
 * ⚠ UNE ÉCOUTE REPRISE APRÈS 30 MINUTES SE PAIE EN ENTIER. Celle des
 *   changements garde chaque tranche modifiée depuis son ouverture : au bout
 *   d'une journée, elle en tiendrait des dizaines, relues à chaque réveil de la
 *   machine. La rouvrir coûte 1 lecture et la ramène à vide.
 */
export const SEUIL_REOUVERTURE = 8

/** Compare deux horodatages Firestore, `Timestamp` ou `{ seconds, nanoseconds }`. */
export function comparerHorodatages(a, b) {
  return (a.seconds - b.seconds) || (a.nanoseconds - b.nanoseconds)
}

/** Le `majLe` le plus récent des tranches : la copie connaît tout ce qui l'a précédé. */
export function plusRecent(tranches) {
  let max = { seconds: 0, nanoseconds: 0 }
  for (const { majLe } of tranches) {
    if (majLe && comparerHorodatages(majLe, max) > 0) max = majLe
  }
  return { seconds: max.seconds, nanoseconds: max.nanoseconds }
}

const versTranche = (d) => {
  const donnees = d.data() ?? {}
  return { id: d.id, majLe: donnees.majLe ?? null, entrees: donnees.entrees ?? {} }
}

const estPlusRecente = (tranche, connue) =>
  Boolean(tranche.majLe) && (!connue?.majLe || comparerHorodatages(tranche.majLe, connue.majLe) > 0)

const aplatir = (tranches) => {
  const clients = []
  for (const id of [...tranches.keys()].sort()) {
    for (const [clientId, entree] of Object.entries(tranches.get(id).entrees)) {
      clients.push({ id: clientId, ...entree })
    }
  }
  return clients
}

/**
 * L'annuaire gardé sur l'appareil, relu par différence (lot G2,
 * docs/rester-dans-le-quota-gratuit.md §G2). Même contrat qu'une écoute de la
 * collection : `{ complet, clients }`, les erreurs vers `onError`. Il se branche
 * donc tel quel dans `ecouterAvecRepli`.
 *
 * - SANS COPIE, la collection entière est écoutée, comme au lot A1 : 65
 *   lectures. Sa première réponse du serveur devient la copie.
 * - AVEC COPIE, la liste s'affiche tout de suite, réseau ou pas. Seules les
 *   tranches dont le `majLe` dépasse le plus récent de la copie sont
 *   demandées : 1 lecture si rien n'a changé.
 *
 * ⚠ SEULES LES RÉPONSES DU SERVEUR FONT FOI. Une réponse tirée du cache de
 *   Firestore peut mêler des tranches d'époques différentes : en retenir le
 *   `majLe` le plus récent ferait sauter la modification d'une tranche restée
 *   en retard. Une réponse du serveur est cohérente : toute écriture
 *   postérieure porte un `majLe` plus grand que tous les siens, donc la
 *   requête suivante la verra.
 *
 * ⚠ `_etat` N'EST LU QU'AU PREMIER CHARGEMENT. Il dit si l'annuaire est
 *   rempli ; une fois la copie faite, il l'était. Le relire coûterait une
 *   lecture par ouverture pour une réponse qui ne change plus.
 *
 * @param {{
 *   copie: null | {
 *     lire: () => Promise<null | { tranches: Array<{ id: string, majLe: object, entrees: object }> }>,
 *     enregistrer: (tranches: Array<object>, options?: { complete?: boolean }) => Promise<void>,
 *   },
 *   ecouterTout: (cb: Function) => () => void,
 *   ecouterDepuis: (depuis: { seconds: number, nanoseconds: number }, cb: Function) => () => void,
 * }} sources
 *   `copie` vaut `null` là où Firestore ne garde pas de cache (émulateurs) ;
 *   chaque écoute appelle `cb({ depuisServeur, docs })` et `cb.onError(err)`
 * @param {{ onNext: Function, onError?: Function }} observer
 * @returns {() => void} ferme l'écoute en cours
 */
export function ecouterAnnuaireGarde({ copie, ecouterTout, ecouterDepuis }, observer) {
  let arrete = false
  let fermer = null
  const tranches = new Map()

  const remplacerEcoute = (ouvrir) => {
    const precedente = fermer
    fermer = null
    precedente?.()
    fermer = ouvrir()
  }
  // Une copie qui ne s'enregistre pas (disque plein, navigation privée) coûte
  // un chargement complet à la prochaine ouverture, rien de plus : la liste
  // affichée, elle, est juste.
  const enregistrer = (liste, options) => {
    copie?.enregistrer(liste, options).catch((err) => {
      console.warn('Copie de l’annuaire non enregistrée sur l’appareil :', err?.name ?? err)
    })
  }
  const emettre = () => observer.onNext({ complet: true, clients: aplatir(tranches) })
  const transmettreErreur = (err) => {
    if (!arrete) observer.onError?.(err)
  }

  const surChangements = ({ depuisServeur, docs }) => {
    if (arrete || !depuisServeur) return
    const nouvelles = docs
      .filter((d) => d.id !== DOC_ETAT)
      .map(versTranche)
      .filter((t) => estPlusRecente(t, tranches.get(t.id)))
    if (nouvelles.length > 0) {
      for (const t of nouvelles) tranches.set(t.id, t)
      enregistrer(nouvelles)
      emettre()
    }
    if (docs.length > SEUIL_REOUVERTURE) ecouterLesChangements()
  }
  surChangements.onError = transmettreErreur

  const ecouterLesChangements = () => {
    remplacerEcoute(() => ecouterDepuis(plusRecent(tranches.values()), surChangements))
  }

  const surTout = ({ depuisServeur, docs }) => {
    if (arrete) return
    const lu = lireAnnuaire(docs)
    // Hors ligne au premier chargement : le cache de Firestore montre ce qu'il
    // a, comme au lot A1, sans devenir la copie. Un cache vide ne dit rien de
    // l'annuaire : il n'ouvre pas le repli, qui relirait toute la base au
    // retour du réseau.
    if (!depuisServeur) {
      if (lu.complet) observer.onNext(lu)
      return
    }
    if (!lu.complet) {
      observer.onNext(lu)
      return
    }
    tranches.clear()
    for (const d of docs) {
      if (d.id !== DOC_ETAT) tranches.set(d.id, versTranche(d))
    }
    enregistrer([...tranches.values()], { complete: true })
    emettre()
    ecouterLesChangements()
  }
  surTout.onError = transmettreErreur

  const demarrer = (copieLue) => {
    if (arrete) return
    if (!copieLue) {
      remplacerEcoute(() => ecouterTout(surTout))
      return
    }
    for (const t of copieLue.tranches) tranches.set(t.id, t)
    emettre()
    ecouterLesChangements()
  }

  if (copie) {
    copie.lire().then(demarrer, (err) => {
      console.warn('Copie de l’annuaire illisible, chargement complet :', err?.name ?? err)
      demarrer(null)
    })
  } else {
    demarrer(null)
  }

  return () => {
    arrete = true
    const derniere = fermer
    fermer = null
    derniere?.()
  }
}
