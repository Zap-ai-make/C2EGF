import { useState, useEffect } from 'react'
import {
  subscribeOutgoingCollaborations,
  subscribeIncomingCollaborations,
  subscribeMyDebts,
  subscribeMyCredits,
} from '../../services/collaborationService'
import { subscribeStoreAdminDealerRequests } from '../../services/storeAdminDealerService'
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
import { formatCurrency } from '../../utils/formatCurrency'
import { formatFirestoreDate } from '../../utils/formatFirestoreDate'
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
 * D'où la règle de ce fichier : AUCUNE ACTION. Pas de bouton, pas de dialogue.
 * Une archive qui laisserait agir redeviendrait une file.
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

/** Ravitaillements demandés au dealer — en lecture seule. */
export function ArchiveDealer({ currentUser, userProfile }) {
  const [lignes, setLignes] = useState(null)

  useEffect(() => {
    setLignes(null)
    if (!userProfile?.storeId) return undefined
    return subscribeStoreAdminDealerRequests({
      currentUser,
      userProfile,
      statusFilter: null,
      typeFilter: null,
      onUpdate: ({ requests }) => setLignes(requests),
      onError: () => setLignes([]),
    })
  }, [currentUser, userProfile])

  return (
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
  )
}
