import { REFUSEE } from '../services/fileEnvoi.js'
import { instantDeDepart } from './attente.js'

/**
 * Les demandes que les agents lancent depuis l'app Oxygen, telles que la
 * caissière les voit dans ses Non Terminées
 * (docs/superpowers/specs/2026-11-17-demandes-agent-design.md §5.5).
 *
 * Une demande n'est pas encore une opération : elle ne compte ni dans les cases
 * ni dans le Total caisse. Elle en prend seulement la forme, pour se lire dans
 * le même tableau que les opérations dont la caissière a l'habitude.
 */

const TYPE_DU_SENS = Object.freeze({ depot: 'Dépôt', retrait: 'Retrait' })

/**
 * Ce que l'agent demande (contrat demande-operation v10 §11.2) : une opération,
 * le remboursement de son crédit, ou celui d'un crédit du siège. Une demande
 * d'avant ce champ est une opération.
 */
export const NATURES_DEMANDE = Object.freeze({
  OPERATION: 'operation',
  REMBOURSEMENT: 'remboursement',
  REMB_SIEGE: 'remb_siege',
})

/** Accents et casse retirés : l'historique porte des « Retrait » et des « retrait ». */
const normaliser = (valeur) => String(valeur || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()

/** Les lignes qui n'ont pas eu lieu, et ne peuvent donc pas faire doublon. */
const STATUTS_DEFAITS = Object.freeze(['supprimee', 'annulee'])

const enDate = (valeur) => {
  if (!valeur) return null
  if (typeof valeur.toDate === 'function') return valeur.toDate()
  const date = valeur instanceof Date ? valeur : new Date(valeur)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * La ligne d'une demande, dans la forme d'une opération du tableau : le nom et
 * le code de l'agent viennent de la copie gardée sur la demande, la date de son
 * arrivée au serveur (`creeLe`) — c'est d'elle que se compte l'attente.
 */
export function ligneDeDemande(id, donnees) {
  const nature = donnees.nature ?? NATURES_DEMANDE.OPERATION
  return {
    id,
    estDemandeAgent: true,
    nature,
    ...(donnees.cibleId ? { cibleId: donnees.cibleId } : {}),
    ...(donnees.mode ? { mode: donnees.mode } : {}),
    sens: donnees.sens,
    clientId: donnees.clientId,
    client: { nom: donnees.agent?.nom ?? '', prenom: donnees.agent?.prenom ?? '' },
    code: donnees.agent?.code ?? '',
    type: nature === NATURES_DEMANDE.REMB_SIEGE ? 'Remb. siège' : (TYPE_DU_SENS[donnees.sens] ?? ''),
    reseau: donnees.reseau,
    montant: donnees.montant,
    createdAt: enDate(donnees.creeLe),
  }
}

/** Un instant en ms, quelle que soit sa forme (Timestamp, Date, nombre) ; `null` sinon. */
const enMs = (valeur) => {
  if (valeur == null) return null
  if (typeof valeur.toMillis === 'function') return valeur.toMillis()
  const date = valeur instanceof Date ? valeur : new Date(valeur)
  return Number.isNaN(date.getTime()) ? null : date.getTime()
}

/**
 * La ligne visée par un remboursement a-t-elle reçu une tranche APRÈS la
 * demande ? La caissière a peut-être encaissé au comptoir l'argent que l'agent
 * déclare aussi depuis l'app : l'accepter le compterait deux fois. Le reste
 * revérifié au serveur ne l'arrête pas tant qu'il suffit.
 *
 * Rend l'instant de la première de ces tranches, ou `null`. Un signal, jamais
 * un blocage, comme `dejaSaisie`.
 *
 * @returns {number|null}
 */
export function encaisseApres(demande, cible) {
  const depart = instantDeDepart(demande)
  if (depart === null || !Array.isArray(cible?.reglements)) return null
  for (const tranche of cible.reglements) {
    const le = enMs(tranche?.le)
    if (le !== null && le >= depart) return le
  }
  return null
}

/**
 * Combien de temps une demande qui vient d'arriver pulse DEVANT LA CAISSIÈRE
 * (demandé par l'utilisateur le 2026-11-27). Le son fait lever les yeux ; la
 * pulsation dit laquelle, parmi plusieurs, vient d'entrer. Plus longtemps, la
 * caissière saisirait ses opérations sous un tableau qui clignote.
 *
 * Le décompte part à son premier geste devant le tableau, pas à l'arrivée :
 * 20 s sur un écran en veille ne préviennent personne.
 */
export const PULSATION_MS = 20_000

/**
 * `arrivee` : `{ le, vueLe }` (`useEcouteDemandesAgent`), ou `undefined` pour
 * une demande qui attendait déjà. Pas encore vue, elle pulse.
 */
export const vientDArriver = (arrivee, maintenant) =>
  arrivee != null && (arrivee.vueLe == null || maintenant - arrivee.vueLe < PULSATION_MS)

/** La plus ancienne d'abord : c'est l'agent qui attend depuis le plus longtemps. */
export const trierDemandes = (lignes) =>
  [...lignes].sort((a, b) => (instantDeDepart(a) ?? 0) - (instantDeDepart(b) ?? 0))

/**
 * La caissière l'a-t-elle déjà saisie elle-même ? Hors ligne, elle ne voit pas
 * les demandes et saisit l'opération à la main ; la demande, elle, attend
 * toujours. La valider ensuite compterait l'argent deux fois.
 *
 * Rend la PREMIÈRE opération du même agent, du même type et du même montant
 * saisie depuis la demande, ou `null`. Un signal, jamais un blocage : deux
 * retraits identiques le même jour arrivent aussi.
 *
 * @returns {{id: string, instantMs: number} | null}
 */
export function dejaSaisie(ligne, operations = []) {
  const depart = instantDeDepart(ligne)
  if (depart === null) return null
  const type = normaliser(ligne.type)

  let premiere = null
  for (const op of operations) {
    if (!op || op.id === ligne.id || op.clientId !== ligne.clientId) continue
    if (normaliser(op.type) !== type || Number(op.montant) !== Number(ligne.montant)) continue
    if (STATUTS_DEFAITS.includes(normaliser(op.statut)) || op.envoi?.etat === REFUSEE) continue
    const instantMs = instantDeDepart(op)
    if (instantMs === null || instantMs < depart) continue
    if (!premiere || instantMs < premiere.instantMs) premiere = { id: op.id, instantMs }
  }
  return premiere
}
