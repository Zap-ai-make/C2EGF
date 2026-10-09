import { useState, useEffect } from 'react'
import {
  subscribeOutgoingCollaborations,
  subscribeIncomingCollaborations,
  subscribeMyDebts,
  subscribeMyCredits,
} from '../../services/collaborationService'
import { subscribeStoreAdminDealerRequests } from '../../services/storeAdminDealerService'
import { safeUnsubscribe } from '../../services/resilientOnSnapshot'
import {
  COLLAB_OPERATION_TYPE_LABELS,
  COLLAB_STATUS_LABELS,
  DEBT_STATUS_LABELS,
  COLLABORATIONS_HISTORY_PAGE_SIZE,
} from '../../constants/collaborationConstants'
import {
  DEALER_REQUEST_STATUS_LABELS,
  DEALER_REQUEST_TYPE_LABELS,
} from '../../constants/dealerConstants'
import { STORE_MOVEMENT_TYPES, estSupprimee } from '../../utils/constants'
import { useTransactions } from '../../context/transactions.jsx'
import { formatCurrency } from '../../utils/formatCurrency'
import { formatFirestoreDate } from '../../utils/formatFirestoreDate'
import { formatTransactionDateTime } from '../../utils/helpers'
import { isSameBusinessDay } from '../../utils/businessDate'
import { FIRESTORE_CONFIG } from '../../constants/firestoreConstants'
import Dialog from '../ui/Dialog.jsx'
import StatusBadge from '../ui/StatusBadge'

/**
 * Les archives — les trois sources qui rejoignent l'historique.
 *
 * ARCHIVE N'EST PAS DOUBLON
 * ─────────────────────────
 * L'onglet « Dealer » montre les mêmes documents que la page « Demandes
 * Dealer », et ce n'est pas un double emploi : ce sont deux JOBS différents sur
 * une même donnée. La page est la FILE — on y agit, elle porte un compteur, elle
 * vit du côté « courant » de la barre. L'onglet est l'ARCHIVE — on y relit, sans
 * rien pouvoir faire, du côté « référentiel ». C'est la même distinction que
 * porte le filet de la barre de navigation ; la respecter ici évite d'inventer
 * une troisième nature de page.
 *
 * D'où la règle de ce fichier : AUCUNE ACTION SUR CE QU'UN TIERS A DÉCIDÉ. Une
 * demande au dealer, une collaboration, une dette : on les relit, on n'y touche
 * pas — sinon l'archive redeviendrait une file.
 *
 * L'EXCEPTION, ET CE QUI LA DISTINGUE
 * ───────────────────────────────────
 * Les mouvements que la boutique s'est appliqués à elle-même ne sont la
 * décision de personne d'autre. Une clôture lancée par erreur met les soldes à
 * zéro : elle doit se défaire LÀ OÙ ON LA LIT, sinon il n'existe aucun endroit
 * pour la défaire. L'action reste donc bornée à ce seul tableau, et à la
 * journée en cours — au-delà, le serveur refuse (storeTransactionCommand.js,
 * action `cancelClosure`), et le bouton ne s'affiche même pas.
 *
 * CE QUE CE LOT NE FAIT PAS, ET POURQUOI JE LE DIS
 * ───────────────────────────────────────────────
 * Pas de filtre de période sur ces trois onglets. L'ajouter demande d'étendre
 * les requêtes du service ET, pour les dettes filtrées par statut, un index
 * composite de plus. Filtrer côté client après un `limit()` serait le piège
 * classique : `limit` s'applique AVANT sur le serveur, et des lignes jamais
 * chargées disparaîtraient sans que rien ne le signale. On montre donc les
 * cinquante dernières, les plus récentes d'abord — et l'onglet le dit.
 */

const TAILLE = COLLABORATIONS_HISTORY_PAGE_SIZE

function Coquille({ titre, lignes, enTetes, children }) {
  if (lignes === null) {
    return (
      <ul aria-hidden="true" className="divide-y divide-line">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="px-4 py-4">
            <span className="block h-4 w-2/3 rounded bg-gray-200 motion-safe:animate-pulse" />
          </li>
        ))}
      </ul>
    )
  }
  if (lignes.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-base font-medium text-ink">{titre}</p>
        <p className="mt-1 text-sm text-ink-muted">
          Rien n’est encore passé par ici.
        </p>
      </div>
    )
  }
  return (
    <>
      <ul aria-label={enTetes} className="divide-y divide-line">{children}</ul>
      {lignes.length >= TAILLE && (
        <p className="border-t border-line px-4 py-2 text-xs text-ink-muted">
          Les {TAILLE} plus récentes.
        </p>
      )}
    </>
  )
}

function Ligne({ principal, secondaire, montant, date, statut, libelleStatut }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="truncate text-sm font-medium text-ink">{principal}</span>
        {secondaire && <span className="text-sm text-ink-muted">{secondaire}</span>}
        <span className="text-sm font-semibold tabular-nums text-ink">{formatCurrency(montant)}</span>
        <span className="text-xs text-ink-muted">{formatFirestoreDate(date)}</span>
      </span>
      <StatusBadge status={statut} label={libelleStatut} />
    </li>
  )
}

const statutVisuel = (brut) =>
  brut === 'confirmed' || brut === 'settled' ? 'confirmed'
    : brut === 'rejected' ? 'rejected' : 'pending'

/** Collaborations terminées, les deux sens confondus. */
export function ArchiveCollaborations({ storeId }) {
  const [emises, setEmises] = useState(null)
  const [recues, setRecues] = useState(null)

  useEffect(() => {
    setEmises(null)
    setRecues(null)
    if (!storeId) return undefined
    const commun = { storeId, statuses: ['confirmed', 'rejected'], limitCount: TAILLE }
    const arret = [
      subscribeOutgoingCollaborations({ ...commun, onUpdate: setEmises }),
      subscribeIncomingCollaborations({ ...commun, onUpdate: setRecues }),
    ]
    return () => arret.forEach((stop) => stop?.())
  }, [storeId])

  const lignes = (emises === null || recues === null)
    ? null
    // Les deux sens sont deux requêtes ; l'ordre chronologique se refait donc
    // ici, sur la réunion — sinon les reçues se rangeraient toutes après les
    // émises, quelle que soit leur date.
    : [...emises.map((c) => ({ ...c, sens: 'outgoing' })), ...recues.map((c) => ({ ...c, sens: 'incoming' }))]
      .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))

  return (
    <Coquille titre="Aucune collaboration terminée" lignes={lignes} enTetes="Collaborations terminées">
      {lignes?.map((c) => (
        <Ligne
          key={c.id}
          principal={c.sens === 'outgoing'
            ? (c.supplierStoreName ?? c.supplierStoreId)
            : (c.requestingStoreName ?? c.requestingStoreId)}
          secondaire={`${c.sens === 'outgoing' ? 'Demandée' : 'Exécutée'} · ${COLLAB_OPERATION_TYPE_LABELS[c.operationType] ?? c.operationType}`}
          montant={c.amount}
          date={c.createdAt}
          statut={statutVisuel(c.status)}
          libelleStatut={COLLAB_STATUS_LABELS[c.status] ?? c.status}
        />
      ))}
    </Coquille>
  )
}

/** Dettes et créances, ouvertes comme soldées. */
export function ArchiveDettes({ storeId }) {
  const [dettes, setDettes] = useState(null)
  const [creances, setCreances] = useState(null)

  useEffect(() => {
    setDettes(null)
    setCreances(null)
    if (!storeId) return undefined
    const commun = { storeId, limitCount: TAILLE }
    const arret = [
      subscribeMyDebts({ ...commun, onUpdate: setDettes }),
      subscribeMyCredits({ ...commun, onUpdate: setCreances }),
    ]
    return () => arret.forEach((stop) => stop?.())
  }, [storeId])

  const lignes = (dettes === null || creances === null)
    ? null
    : [...dettes.map((d) => ({ ...d, sens: 'debt' })), ...creances.map((d) => ({ ...d, sens: 'credit' }))]
      .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))

  return (
    <Coquille titre="Aucune dette interne" lignes={lignes} enTetes="Dettes internes">
      {lignes?.map((d) => (
        <Ligne
          key={d.id}
          principal={d.sens === 'debt'
            ? (d.creditorStoreName ?? d.creditorStoreId)
            : (d.debtorStoreName ?? d.debtorStoreId)}
          secondaire={d.sens === 'debt' ? 'Dette' : 'Créance'}
          montant={d.originalAmount}
          date={d.createdAt}
          statut={statutVisuel(d.status)}
          libelleStatut={DEBT_STATUS_LABELS[d.status] ?? d.status}
        />
      ))}
    </Coquille>
  )
}

/** Ce qu'une clôture a balayé revient aux soldes — tant qu'on est le même jour. */
const CLOTURE = 'Clôture'

/**
 * Une clôture est-elle encore annulable ?
 *
 * Les trois conditions sont celles du serveur, dans le même ordre : c'est
 * délibéré. Un bouton qui s'affiche là où `cancelClosure` refusera ne donne pas
 * le choix au gérant, il lui donne une erreur — et le serveur reste l'autorité,
 * ceci n'étant que la politesse de ne pas proposer l'impossible.
 */
const clotureAnnulable = (mouvement, maintenant = new Date()) =>
  mouvement?.type === CLOTURE
  && mouvement.statut !== FIRESTORE_CONFIG.STATUS.CANCELLED
  && !estSupprimee(mouvement)
  && Array.isArray(mouvement.soldes) && mouvement.soldes.length > 0
  && Boolean(mouvement.createdAt)
  && isSameBusinessDay(mouvement.createdAt?.toDate ? mouvement.createdAt.toDate() : mouvement.createdAt, maintenant)

/**
 * Les mouvements de la boutique, en TABLEAU.
 *
 * POURQUOI PAS LA LISTE QU'ON AVAIT
 * ─────────────────────────────────
 * Une liste met chaque ligne sur son propre rythme : le montant de l'une ne
 * tombe pas sous le montant de l'autre, et comparer deux clôtures demande de
 * relire horizontalement. Ces lignes-là s'empilent par dizaines et se lisent en
 * colonnes — « combien est entré, combien est sorti » — ce qu'un tableau fait
 * et qu'une liste ne fait pas. La corbeille, qui répond au même besoin, en est
 * déjà un.
 *
 * ⚠ L'HEURE VIENT DE `formatTransactionDateTime`, ET C'EST UNE CORRECTION.
 *   Le serveur écrit `date` sans heure — « 09/10/2026 » — et l'écran la relisait
 *   avec `new Date()`, qui lit une date française à l'américaine : le jour et le
 *   mois s'échangeaient, et l'heure valait minuit pour tout le monde. Ce
 *   formateur-là n'utilise la chaîne QUE si elle porte une heure, et retombe
 *   sinon sur l'horodatage serveur `createdAt`, qui est exact à la milliseconde.
 */
function MouvementsBoutique({ mouvements, onAnnuler }) {
  if (mouvements.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-base font-medium text-ink">Aucun ravitaillement ni clôture</p>
        <p className="mt-1 text-sm text-ink-muted">Rien n’est encore passé par ici.</p>
      </div>
    )
  }

  const enTetes = ['Date & heure', 'Type', 'Détail', 'Montant', 'Statut']

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" aria-label="Mouvements de la boutique">
        <thead>
          <tr className="border-b border-line bg-surface-2">
            {enTetes.map((enTete) => (
              <th
                key={enTete}
                scope="col"
                className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted ${
                  enTete === 'Montant' ? 'text-right' : enTete === 'Statut' ? 'text-right' : 'text-left'
                }`}
              >
                {enTete}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mouvements.map((m) => {
            const annulable = clotureAnnulable(m)
            return (
              <tr key={m.id} className="border-b border-line/60" data-testid={`mouvement-${m.id}`}>
                <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-ink">
                  {formatTransactionDateTime(m)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-ink">{m.type}</td>
                <td className="px-4 py-3 text-sm text-ink-muted">
                  {m.expediteur || m.note || '—'}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold tabular-nums text-ink">
                  {formatCurrency(m.montant)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {annulable ? (
                    <button
                      type="button"
                      onClick={() => onAnnuler(m)}
                      data-testid={`annuler-cloture-${m.id}`}
                      className="rounded border border-danger/40 px-3 py-1 text-xs font-semibold text-danger transition-colors hover:bg-danger-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
                    >
                      Annuler
                    </button>
                  ) : (
                    <StatusBadge
                      status={m.statut === FIRESTORE_CONFIG.STATUS.CANCELLED ? 'rejected' : 'confirmed'}
                      label={m.statut}
                    />
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Ravitaillements demandés au dealer — en lecture seule. */
export function ArchiveDealer({ currentUser, userProfile }) {
  const [lignes, setLignes] = useState(null)
  const [aAnnuler, setAAnnuler] = useState(null)
  const [enCours, setEnCours] = useState(false)
  const [echec, setEchec] = useState(null)
  const { completedTransactions = [], cancelClosure } = useTransactions()

  // Les mouvements que la boutique s'est appliqués à elle-même : ravitaillements
  // reçus, clôtures de journée. Ils viennent du registre `history`, pas du
  // circuit dealer — deux sources, un même onglet, parce que le gérant qui vient
  // ici cherche « d'où vient mon stock et où il est parti », pas « quel service
  // l'a écrit ».
  const mouvements = completedTransactions.filter((t) => STORE_MOVEMENT_TYPES.includes(t.type))

  useEffect(() => {
    setLignes(null)
    if (!userProfile?.storeId) return undefined
    // Écouteur brut : son démontage doit être rendu total (cf. safeUnsubscribe).
    return safeUnsubscribe(subscribeStoreAdminDealerRequests({
      currentUser,
      userProfile,
      statusFilter: null,
      typeFilter: null,
      onUpdate: ({ requests }) => setLignes(requests),
      onError: () => setLignes([]),
    }))
  }, [currentUser, userProfile])

  const confirmerAnnulation = async () => {
    if (!aAnnuler) return
    setEnCours(true)
    setEchec(null)
    try {
      await cancelClosure(aAnnuler.id)
      setAAnnuler(null)
    } catch (error) {
      // Le dialogue reste ouvert : il porte le message, et le gérant voit que
      // son geste n'a pas abouti.
      setEchec(error?.message || "L'annulation a échoué.")
    } finally {
      setEnCours(false)
    }
  }

  return (
    <>
      <MouvementsBoutique
        mouvements={mouvements}
        onAnnuler={setAAnnuler}
      />

      {/* Le circuit dealer reste listé à part : une demande au dealer attend une
          réponse d'un tiers, un ravitaillement saisi ici est déjà acquis. Les
          confondre dans une seule liste mélangerait deux degrés de certitude.

          D'où ce titre, qui n'existait pas : tant que les deux étaient des
          listes, leur ressemblance passait pour de la continuité. Le premier
          bloc est devenu un tableau — sans rien pour dire où il s'arrête, ses
          colonnes semblaient se déliter en cours de route. */}
      <h3 className="m-0 border-y border-line bg-surface-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Demandes au dealer
      </h3>
      <Coquille titre="Aucune demande au dealer" lignes={lignes} enTetes="Demandes au dealer">
        {lignes?.map((r) => (
          <Ligne
            key={r.id}
            principal={DEALER_REQUEST_TYPE_LABELS[r.type] ?? r.type}
            secondaire={r.network}
            montant={r.amount}
            date={r.createdAt}
            statut={statutVisuel(r.status)}
            libelleStatut={DEALER_REQUEST_STATUS_LABELS[r.status] ?? r.status}
          />
        ))}
      </Coquille>

      {/* Annuler une clôture rend les soldes qu'elle avait balayés : la
          confirmation dit CE QU'ELLE FAIT, chiffres compris, plutôt qu'un
          « Êtes-vous sûr ? » qui n'informe personne. */}
      <Dialog
        open={Boolean(aAnnuler)}
        onClose={() => { setAAnnuler(null); setEchec(null) }}
        title="Annuler cette clôture ?"
        testId="confirmer-annulation-cloture"
        footer={(
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => { setAAnnuler(null); setEchec(null) }}
              className="rounded border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              Garder la clôture
            </button>
            <button
              type="button"
              onClick={confirmerAnnulation}
              disabled={enCours}
              data-testid="confirmer-annuler-cloture"
              className="rounded bg-danger px-4 py-2 text-sm font-semibold text-white transition-colors hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:cursor-wait disabled:opacity-60"
            >
              {enCours ? 'Annulation…' : 'Annuler la clôture'}
            </button>
          </div>
        )}
      >
        {aAnnuler && (
          <div className="space-y-3 text-sm text-ink">
            <p className="m-0">
              Les réserves balayées reviendront aux soldes :
              {' '}
              <span className="font-semibold tabular-nums">{formatCurrency(aAnnuler.montant)}</span>
              {' '}au total.
            </p>
            {Array.isArray(aAnnuler.soldes) && (
              <ul className="m-0 list-none space-y-1 rounded border border-line bg-surface-2 p-3">
                {aAnnuler.soldes.map((solde) => (
                  <li key={solde.network} className="flex justify-between gap-4">
                    <span>{solde.network}</span>
                    <span className="tabular-nums text-ink-muted">
                      stock {formatCurrency(solde.stock)} · espèce {formatCurrency(solde.liquidite)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {echec && <p className="m-0 text-danger" role="alert">{echec}</p>}
          </div>
        )}
      </Dialog>
    </>
  )
}
