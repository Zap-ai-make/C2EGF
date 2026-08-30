import { useState, useEffect, useMemo, useCallback } from 'react'
import { AlertTriangle, Lock } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { subscribeMyDebts, subscribeMyCredits } from '../../services/collaborationService'
import { computeDebtPositions } from '../../utils/debtPositions'
import { formatCurrency } from '../../utils/formatCurrency'
import { formatFirestoreDate } from '../../utils/formatFirestoreDate'
import { DEBT_STATUS_LABELS } from '../../constants/collaborationConstants'
import PageHeader from '../../components/ui/PageHeader'
import StatusBadge from '../../components/ui/StatusBadge'
import Fleau from '../../components/debts/Fleau'

/**
 * Dettes internes — la page qui répond à « avec qui suis-je à découvert, de
 * combien, et qu'est-ce que je fais maintenant ? ».
 *
 * DEUX ABONNEMENTS, PAS UN
 * ────────────────────────
 * Firestore ne sait pas répondre en une requête : une dette me désigne soit
 * comme débitrice, soit comme créancière, et un `where` ne fait pas de « ou ».
 * D'où deux abonnements, croisés en mémoire par `computeDebtPositions`.
 *
 * L'ÉTAT « PÉRIMÉ » EST LE PLUS IMPORTANT DE CETTE PAGE
 * ────────────────────────────────────────────────────
 * Un `onSnapshot` qui tombe est terminal : sans `resilientOnSnapshot`, la page
 * afficherait indéfiniment des chiffres morts, plausibles, et sans le dire.
 * C'est le pire mode de défaillance pour un écran qui porte de l'argent. Le
 * wrapper se relève ; la page, elle, doit DIRE qu'elle attend — d'où le bandeau
 * et l'heure du dernier rafraîchissement réussi.
 *
 * ET L'ÉTAT « REFUSÉ » N'EST PAS LE MÊME
 * ──────────────────────────────────────
 * `permission-denied` et `failed-precondition` ne se réessaient pas : ils
 * exigent un déploiement. Proposer d'attendre serait envoyer le gérant dans le
 * mur. La page bascule donc sur un état plein, qui dit que ça ne reviendra pas
 * tout seul — et non un bandeau qui laisserait croire à une reprise.
 */

const CHARGEMENT_INITIAL = { debts: null, credits: null }

/** Le détail d'une dette, sous la poutre dépliée. */
function LigneDette({ item, sens }) {
  const estDette = sens === 'debt'
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-2 last:border-b-0">
      <span className="flex items-baseline gap-2">
        <span className={`text-xs font-semibold uppercase tracking-wide ${estDette ? 'text-outflow' : 'text-inflow'}`}>
          {estDette ? 'Dette' : 'Créance'}
        </span>
        <span className="text-sm font-medium tabular-nums text-ink">
          {formatCurrency(item.remainingAmount)}
        </span>
        {/* Le montant initial n'apparaît QUE s'il diffère du reste dû : le
            répéter à l'identique sur chaque ligne noierait l'information dans
            sa propre redite. */}
        {item.settledAmount > 0 && (
          <span className="text-xs text-ink-muted">
            sur {formatCurrency(item.originalAmount)}
          </span>
        )}
      </span>
      <span className="flex items-center gap-3">
        <span className="text-xs text-ink-muted">{formatFirestoreDate(item.createdAt)}</span>
        <StatusBadge
          status={item.status === 'settled' ? 'confirmed' : 'pending'}
          label={DEBT_STATUS_LABELS[item.status] ?? item.status}
        />
      </span>
    </li>
  )
}

function StoreInternalDebts() {
  const { currentUser, userProfile } = useAuth()
  const storeId = userProfile?.storeId ?? null

  const [donnees, setDonnees] = useState(CHARGEMENT_INITIAL)
  const [erreur, setErreur] = useState(null)
  const [dernierSucces, setDernierSucces] = useState(null)
  const [partenaireDeplie, setPartenaireDeplie] = useState(null)

  useEffect(() => {
    setDonnees(CHARGEMENT_INITIAL)
    setErreur(null)
    setDernierSucces(null)
    if (!storeId) return undefined

    // Un succès sur l'un des deux flux efface le bandeau : les données
    // reviennent, il n'y a plus rien à signaler. Une erreur DÉFINITIVE, elle,
    // ne s'efface pas — c'est le seul cas où l'écran cesse de se corriger tout
    // seul, et le masquer au premier snapshot de l'autre flux ferait croire que
    // la page est complète alors qu'il lui manque une moitié.
    const succes = (cle) => (rows) => {
      setDonnees((etat) => ({ ...etat, [cle]: rows }))
      setDernierSucces(new Date())
      setErreur((precedente) => (precedente?.permanent ? precedente : null))
    }
    const echec = (err) => setErreur((precedente) => (precedente?.permanent ? precedente : err))

    const arret = [
      subscribeMyDebts({ storeId, onUpdate: succes('debts'), onError: echec }),
      subscribeMyCredits({ storeId, onUpdate: succes('credits'), onError: echec }),
    ]
    return () => arret.forEach((stop) => stop?.())
    // ⚠ On dépend de l'IDENTIFIANT de l'utilisateur, jamais de l'objet.
    //   `useAuth()` peut rendre un objet neuf à chaque rendu ; l'effet se
    //   relancerait alors après chaque `setState` qu'il déclenche lui-même,
    //   remettrait l'écran en chargement, se réabonnerait, et la page ne
    //   quitterait jamais son squelette. Deux abonnements Firestore rouverts à
    //   chaque snapshot, en prime.
  }, [storeId, currentUser?.uid])

  const chargement = donnees.debts === null || donnees.credits === null

  const positions = useMemo(
    () => computeDebtPositions({
      storeId,
      debts: donnees.debts ?? [],
      credits: donnees.credits ?? [],
    }),
    [storeId, donnees.debts, donnees.credits],
  )

  const basculer = useCallback(
    (partnerId) => setPartenaireDeplie((actuel) => (actuel === partnerId ? null : partnerId)),
    [],
  )

  const detail = useCallback(
    (partner) => (
      <ul aria-label={`Dettes et créances avec ${partner.name}`}>
        {partner.debts.map((item) => <LigneDette key={item.id} item={item} sens="debt" />)}
        {partner.credits.map((item) => <LigneDette key={item.id} item={item} sens="credit" />)}
      </ul>
    ),
    [],
  )

  // ── L'échec définitif : un état plein, pas un bandeau ──────────────────────
  if (erreur?.permanent) {
    return (
      <div>
        <PageHeader title="Dettes internes" />
        <div className="rounded-xl border border-line bg-surface p-10 text-center" role="alert">
          <Lock className="mx-auto mb-3 h-8 w-8 text-ink-muted" aria-hidden="true" strokeWidth={1.5} />
          <p className="text-base font-medium text-ink">Ces données ne s’affichent pas</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">{erreur.message}</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Dettes internes"
        subtitle="Ce que vous devez aux autres boutiques, et ce qu’elles vous doivent."
      />

      {/* ── Périmé : on le DIT, au lieu d'afficher des chiffres morts ──────── */}
      {erreur && (
        <div
          className="mb-4 flex items-start gap-3 rounded-lg border border-warn/40 bg-warn-soft px-4 py-3"
          role="status"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" strokeWidth={2} />
          <p className="text-sm text-warn">
            Ces montants ne se mettent plus à jour
            {dernierSucces && ` — dernière lecture à ${dernierSucces.toLocaleTimeString('fr-FR')}`}.
            La connexion est en cours de rétablissement.
          </p>
        </div>
      )}

      <Fleau
        positions={positions}
        loading={chargement}
        expandedPartnerId={partenaireDeplie}
        onTogglePartner={basculer}
        renderDetails={detail}
      />
    </div>
  )
}

export default StoreInternalDebts
