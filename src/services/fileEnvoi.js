/**
 * fileEnvoi.js — les opérations de caisse qui attendent le réseau (lots G3b et
 * G4b, docs/rester-dans-le-quota-gratuit.md §G3 et §G4).
 *
 * Y passent, réseau ou pas : la saisie, sa modification et son annulation, le
 * règlement (par tranche ou en entier), le remboursement, la correction d'une
 * ligne validée, le ravitaillement et son retour, et l'ajout d'un client. Chacune
 * est d'abord ÉCRITE sur l'appareil, puis envoyée. Une coupure ne la perd pas :
 * elle repart au retour du réseau, même après l'extinction de la machine.
 *
 * ⚠ RENVOYER UNE OPÉRATION DOIT ÊTRE SANS DANGER, ET C'EST LE SERVEUR QUI LE
 *   GARANTIT. Une réponse perdue en route fait renvoyer une opération que le
 *   serveur a peut-être déjà appliquée. Les commandes portent leur `commandeId`,
 *   le règlement son `idempotencyKey`, le client son identifiant : chacun est
 *   reconnu au second passage (lots G3a et G4a). Sans cette garde, la file
 *   doublerait des mouvements d'argent.
 *
 * ⚠ UN REFUS EST DÉFINITIF, UNE PANNE NE L'EST PAS. Un code métier
 *   (`INSUFFICIENT_STORE_BALANCE`…) dit que le serveur a lu l'opération et n'en
 *   veut pas : la renvoyer ne changerait rien. Tout le reste (réseau absent,
 *   délai dépassé, erreur interne) se retente, dans l'ordre.
 *
 * ⚠ UNE SEULE À LA FOIS, DANS L'ORDRE DE SAISIE. Un règlement, une modification
 *   ou une annulation hors ligne visent une ligne saisie hors ligne : ils ne
 *   peuvent partir qu'après elle.
 */

export const SAISIE = 'saisie'
export const REGLEMENT = 'reglement'
export const REMBOURSEMENT = 'remboursement'
export const CLIENT = 'client'
export const RAVITAILLEMENT = 'ravitaillement'
export const RETOUR = 'retour'
export const MODIFICATION = 'modification'
export const CORRECTION = 'correction'
export const ANNULATION = 'annulation'

// Ce qu'une annulation vise : chacune de ces lignes a sa commande au serveur.
export const CIBLE_NON_TERMINEE = 'non_terminee'
export const CIBLE_VALIDEE = 'validee'
export const CIBLE_RETOUR = 'retour'

export const EN_ATTENTE = 'en_attente'
export const REFUSEE = 'refusee'
export const ENVOYEE = 'envoyee'

/** Ce que le formulaire attend la première réponse avant de rendre la main. */
export const ATTENTE_FORMULAIRE_MS = 8000

/** Entre deux essais, tant qu'une opération attend. */
export const REESSAI_MS = 30000

const CODES_FIRESTORE_DEFINITIFS = ['permission-denied', 'invalid-argument', 'already-exists']

/**
 * Un refus du serveur, à ne pas renvoyer.
 *
 * Les erreurs métier des functions portent leur code en majuscules dans
 * `details.code` : `storeTransactionCommandService.js` le remonte en `code`, le
 * service de règlement le laisse où il est. Une panne de réseau arrive en
 * `functions/internal` ou `unavailable`, sans `details` : elle se retente.
 *
 * ⚠ DEUX RÉPONSES EN MAJUSCULES NE SONT PAS DES REFUS. Les prendre pour tels
 *   perdrait une opération que le serveur accepterait au prochain essai.
 *   - `UNAUTHENTICATED` : le SDK envoie la requête SANS jeton quand il n'a pas
 *     pu le rafraîchir (`getAuthToken` avale l'erreur). La machine est éteinte
 *     la nuit, donc le jeton est expiré au matin ; sur un réseau instable, la
 *     requête passe là où le rafraîchissement a échoué. La session, elle, est
 *     bonne.
 *   - « champs non autorisés » : un serveur antérieur au lot G3a ne connaît pas
 *     `commandeId`. Il n'a rien appliqué : l'opération attend son déploiement.
 *     C'est ce qui rend l'ordre de déploiement sans danger.
 */
const codeDe = (erreur) => String(erreur?.details?.code ?? erreur?.code ?? '')

export function estRefusDefinitif(erreur) {
  const code = codeDe(erreur)
  if (code === 'UNAUTHENTICATED') return false
  if (code === 'INVALID_REQUEST_ID' && /champs non autorisés/.test(String(erreur?.message ?? ''))) return false
  return /^[A-Z][A-Z0-9_]+$/.test(code) || CODES_FIRESTORE_DEFINITIFS.includes(code)
}

// Le SDK ajoute le statut HTTP à tout message (« … [400] ») : c'est de la
// tuyauterie, et ce message-ci s'affiche sur la ligne refusée.
const resumerErreur = (erreur) => ({
  code: codeDe(erreur),
  message: String(erreur?.message ?? erreur ?? 'Erreur inconnue').replace(/\s*\[\d+\]$/, '').slice(0, 300),
})

/**
 * @param {{
 *   stockage: {
 *     lister: () => Promise<object[]>,
 *     ajouter: (op: object) => Promise<void>,
 *     modifier: (id: string, champs: object) => Promise<void>,
 *     retirer: (id: string) => Promise<void>,
 *   },
 *   executer: (op: object) => Promise<any>,
 *   nouvelId: () => string,
 *   verrouiller?: (fn: Function) => Promise<any>,
 *   planifier?: Function,
 *   annulerPlan?: Function,
 *   maintenant?: () => number,
 * }} dependances
 *   `stockage.lister` rend les opérations dans l'ordre de saisie ;
 *   `verrouiller` empêche deux onglets d'envoyer en même temps
 */
export function creerFileEnvoi({
  stockage,
  executer,
  nouvelId,
  verrouiller = (fn) => fn(),
  planifier = (fn, ms) => setTimeout(fn, ms),
  annulerPlan = (id) => clearTimeout(id),
  maintenant = () => Date.now(),
}) {
  const abonnes = new Set()
  const attentes = new Map()
  let enCours = null
  let encoreUneFois = false
  let relance = null
  let arretee = false

  const notifier = async () => {
    if (abonnes.size === 0) return
    const operations = await stockage.lister()
    for (const abonne of abonnes) abonne(operations)
  }

  const regler = (id, issue) => {
    const attente = attentes.get(id)
    if (!attente) return false
    attentes.delete(id)
    annulerPlan(attente.minuteur)
    issue(attente)
    return true
  }

  const boucle = async () => {
    if (relance !== null) {
      annulerPlan(relance)
      relance = null
    }
    while (!arretee) {
      const prochaine = (await stockage.lister()).find((op) => op.etat === EN_ATTENTE)
      if (!prochaine) return

      let resultat
      try {
        resultat = await executer(prochaine)
      } catch (erreur) {
        if (estRefusDefinitif(erreur)) {
          // La caissière attend encore la réponse : elle verra le refus dans
          // son formulaire, champs gardés, comme avant la file. Ailleurs, le
          // refus reste visible dans la liste des envois.
          const attendue = attentes.has(prochaine.id)
          if (attendue) await stockage.retirer(prochaine.id)
          else await stockage.modifier(prochaine.id, { etat: REFUSEE, erreur: resumerErreur(erreur), tentatives: prochaine.tentatives + 1 })
          regler(prochaine.id, (a) => a.reject(erreur))
          await notifier()
          continue
        }
        await stockage.modifier(prochaine.id, { erreur: resumerErreur(erreur), tentatives: prochaine.tentatives + 1, dernierEssai: maintenant() })
        // Le réseau manque : aucune opération ne partira avant le prochain
        // essai. Celles qu'un formulaire attend rendent la main tout de suite,
        // au lieu de faire patienter la caissière pour rien.
        for (const id of [...attentes.keys()]) {
          regler(id, (a) => a.resolve({ statut: EN_ATTENTE, operation: a.operation }))
        }
        if (!arretee) relance = planifier(() => { relance = null; vider() }, REESSAI_MS)
        await notifier()
        return
      }

      await stockage.retirer(prochaine.id)
      regler(prochaine.id, (a) => a.resolve({ statut: ENVOYEE, resultat, operation: a.operation }))
      await notifier()
    }
  }

  /** Envoie ce qui attend, une opération après l'autre. Sans effet si un envoi est en cours. */
  function vider() {
    if (arretee) return Promise.resolve()
    if (enCours) {
      encoreUneFois = true
      return enCours
    }
    enCours = Promise.resolve()
      .then(() => verrouiller(boucle))
      .catch((erreur) => console.warn('File d’envoi interrompue :', erreur?.message ?? erreur))
      .finally(() => {
        enCours = null
        if (encoreUneFois) {
          encoreUneFois = false
          vider()
        }
      })
    return enCours
  }

  /**
   * Écrit l'opération sur l'appareil, l'envoie, et attend sa première réponse.
   *
   * @returns {Promise<{ statut: 'envoyee' | 'en_attente', resultat?: any, operation: object }>}
   *   rejetée par un refus du serveur arrivé pendant l'attente
   */
  async function soumettre(type, charge, { id = nouvelId(), attente = ATTENTE_FORMULAIRE_MS } = {}) {
    // Le même geste confirmé deux fois (même clé de règlement) pendant qu'il
    // attend : une seule opération dans la file. Le serveur, lui, reconnaîtrait
    // le doublon, mais la liste des envois le montrerait deux fois.
    const deja = (await stockage.lister()).find((op) => op.id === id)
    if (deja?.etat === EN_ATTENTE) {
      vider()
      return { statut: EN_ATTENTE, operation: deja }
    }
    if (deja) await stockage.retirer(id)
    const operation = { id, type, charge, etat: EN_ATTENTE, creeLe: maintenant(), tentatives: 0, erreur: null }
    await stockage.ajouter(operation)
    const issue = new Promise((resolve, reject) => {
      const minuteur = planifier(() => {
        regler(id, (a) => a.resolve({ statut: EN_ATTENTE, operation: a.operation }))
      }, attente)
      attentes.set(id, { resolve, reject, minuteur, operation })
    })
    await notifier()
    vider()
    return issue
  }

  /** Retire une opération refusée de la liste. Une opération en attente ne se retire pas. */
  async function retirer(id) {
    const operation = (await stockage.lister()).find((op) => op.id === id)
    if (operation?.etat !== REFUSEE) return false
    await stockage.retirer(id)
    await notifier()
    return true
  }

  function abonner(abonne) {
    abonnes.add(abonne)
    stockage.lister().then((operations) => {
      if (abonnes.has(abonne)) abonne(operations)
    })
    return () => abonnes.delete(abonne)
  }

  function arreter() {
    arretee = true
    if (relance !== null) annulerPlan(relance)
    relance = null
    abonnes.clear()
  }

  return { soumettre, vider, retirer, abonner, arreter }
}
