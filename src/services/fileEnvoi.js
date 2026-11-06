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
 * ⚠ LA CAISSIÈRE N'ATTEND JAMAIS LE RÉSEAU (lot H). Le formulaire attendait la
 *   première réponse jusqu'à 8 s : sur un wifi sans internet, le navigateur se croit
 *   en ligne, et chaque opération coûtait ces 8 s au client devant le comptoir.
 *   `soumettre` rend la main dès l'écriture ; un refus arrive après coup, sur la
 *   ligne et dans la liste des envois, réseau présent ou pas.
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

/**
 * Ce qu'une opération peut attendre, réseau présent, avant que l'écran ne le dise.
 * Elle part d'ordinaire en une seconde : la signaler tout de suite ferait clignoter
 * le bandeau à chaque geste.
 */
export const SIGNAL_APRES_MS = 5000

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

/**
 * Faut-il dire à l'écran que des opérations attendent ? Hors ligne, oui. Réseau
 * présent, seulement quand l'une a déjà échoué une fois, ou n'est pas partie après
 * `SIGNAL_APRES_MS`. Sur un wifi sans internet, `navigator.onLine` reste vrai : c'est
 * alors l'âge de l'opération qui le dit.
 *
 * @param {object[]} enAttente les opérations en attente
 * @param {{ enLigne: boolean, maintenant: number }} contexte
 */
export function attenteASignaler(enAttente, { enLigne, maintenant }) {
  if (enAttente.length === 0) return false
  if (!enLigne) return true
  return enAttente.some((op) => op.tentatives > 0 || maintenant - op.creeLe >= SIGNAL_APRES_MS)
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
  const envoyees = new Set()
  let enCours = null
  let encoreUneFois = false
  let relance = null
  let arretee = false

  const notifier = async () => {
    if (abonnes.size === 0) return
    const operations = await stockage.lister()
    for (const abonne of abonnes) abonne(operations)
  }

  // Un écouteur qui lève ne doit pas arrêter l'envoi des suivantes.
  const signalerEnvoi = (operation, resultat) => {
    for (const ecouteur of envoyees) {
      try {
        ecouteur(operation, resultat)
      } catch (erreur) {
        console.warn('Après l’envoi d’une opération :', erreur?.message ?? erreur)
      }
    }
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
          // Le formulaire est fermé depuis longtemps : le refus reste visible, avec
          // sa raison, sur la ligne et dans la liste des envois.
          await stockage.modifier(prochaine.id, { etat: REFUSEE, erreur: resumerErreur(erreur), tentatives: prochaine.tentatives + 1 })
          await notifier()
          continue
        }
        await stockage.modifier(prochaine.id, { erreur: resumerErreur(erreur), tentatives: prochaine.tentatives + 1, dernierEssai: maintenant() })
        if (!arretee) relance = planifier(() => { relance = null; vider() }, REESSAI_MS)
        await notifier()
        return
      }

      await stockage.retirer(prochaine.id)
      // Avant la liste : l'écran corrige ses sources dans le même rendu que celui
      // où l'opération quitte la file, sans montrer un instant l'ancienne ligne.
      signalerEnvoi(prochaine, resultat)
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
   * Écrit l'opération sur l'appareil et rend la main : l'envoi part derrière.
   *
   * @returns {Promise<{ statut: 'en_attente', operation: object }>}
   */
  async function soumettre(type, charge, { id = nouvelId() } = {}) {
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
    await notifier()
    vider()
    return { statut: EN_ATTENTE, operation }
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

  /**
   * Prévient quand le serveur a accepté une opération, au moment où elle quitte la
   * file : ce que l'écran ne recevra d'aucune écoute (une période relue) se corrige là.
   *
   * @param {(operation: object, resultat: any) => void} ecouteur
   * @returns {() => void} le désabonnement
   */
  function apresEnvoi(ecouteur) {
    envoyees.add(ecouteur)
    return () => envoyees.delete(ecouteur)
  }

  function arreter() {
    arretee = true
    if (relance !== null) annulerPlan(relance)
    relance = null
    abonnes.clear()
    envoyees.clear()
  }

  return { soumettre, vider, retirer, abonner, apresEnvoi, arreter }
}
