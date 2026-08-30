import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  subscribeDebtSettlements,
  declareInternalDebtSettlement,
  confirmInternalDebtSettlement,
  rejectInternalDebtSettlement,
  declareInternalDebtCompensation,
  confirmInternalDebtCompensation,
  rejectInternalDebtCompensation,
} from '../../services/collaborationService'
import { parseAmount } from '../../utils/parseAmount'
import {
  DEBT_SETTLEMENT_METHODS,
  DEBT_STATUS_LABELS,
  settlementMethodLabel,
} from '../../constants/collaborationConstants'
import { formatCurrency } from '../../utils/formatCurrency'
import { formatFirestoreDate } from '../../utils/formatFirestoreDate'
import StatusBadge from '../ui/StatusBadge'
import Dialog from '../ui/Dialog'

/**
 * Le détail d'un partenaire, déplié sous sa poutre — et le seul endroit de
 * l'application d'où part une écriture sur une dette.
 *
 * LA COMPENSATION NE PASSE PAS PAR LE MÊME GUICHET
 * ────────────────────────────────────────────────
 * Une tranche de compensation vit dans la même sous-collection qu'un règlement
 * ordinaire, mais elle impute DEUX dettes au lieu d'une. La confirmer par le
 * chemin des règlements n'imputerait que la première, et l'autre boutique
 * resterait débitrice d'un montant déjà éteint. Le serveur refuse ce croisement
 * dans les deux sens ; l'interface doit donc router sur `method`, et c'est
 * `routerConfirmation` qui porte cette décision — une seule fois, pas dans
 * chaque bouton.
 *
 * CE QUI RESTE DÉCLARABLE N'EST PAS CE QUI RESTE DÛ
 * ─────────────────────────────────────────────────
 * Les tranches déjà déclarées RÉSERVENT leur montant tant qu'elles ne sont ni
 * confirmées ni rejetées. Proposer le reste dû comme plafond ferait échouer la
 * commande côté serveur (`SETTLEMENT_EXCEEDS_REMAINING`) sur une saisie que
 * l'écran venait d'autoriser. On soustrait donc le déclaré, et on le dit.
 *
 * LES MONTANTS NE SONT PAS CONVERTIS ICI
 * ──────────────────────────────────────
 * `parseAmount` sert à VALIDER avant d'ouvrir le réseau ; la valeur envoyée
 * reste la saisie brute, dont le service est la source unique de conversion.
 * Deux conversions finiraient par diverger.
 */

const EST_COMPENSATION = (tranche) => tranche?.method === 'compensation'

function routerConfirmation(tranche) {
  return EST_COMPENSATION(tranche) ? confirmInternalDebtCompensation : confirmInternalDebtSettlement
}

function routerRejet(tranche) {
  return EST_COMPENSATION(tranche) ? rejectInternalDebtCompensation : rejectInternalDebtSettlement
}

/** Les tranches d'une dette, abonnées tant que la ligne est à l'écran. */
function useTranches(debtId) {
  const [tranches, setTranches] = useState([])
  useEffect(() => {
    if (!debtId) return undefined
    return subscribeDebtSettlements({ debtId, onUpdate: setTranches })
  }, [debtId])
  return tranches
}

function Bouton({ variante = 'neutre', className = '', ...props }) {
  const styles = {
    primaire: 'bg-brand-500 text-white hover:bg-brand-600',
    neutre: 'border border-line bg-surface text-ink hover:bg-brand-50',
    danger: 'border border-danger/40 bg-danger-soft text-danger hover:bg-danger-soft/70',
  }
  return (
    <button
      type="button"
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-50 ${styles[variante]} ${className}`}
      {...props}
    />
  )
}

function LigneTranche({ tranche, onConfirmer, onRejeter, actionnable }) {
  const enAttente = tranche.settlementStatus === 'declared'
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5 pl-4">
      <span className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium tabular-nums text-ink">
          {formatCurrency(tranche.amount)}
        </span>
        <span className="text-xs text-ink-muted">{settlementMethodLabel(tranche.method)}</span>
        <span className="text-xs text-ink-muted">{formatFirestoreDate(tranche.declaredAt)}</span>
      </span>
      <span className="flex items-center gap-2">
        <StatusBadge
          status={
            tranche.settlementStatus === 'confirmed' ? 'confirmed'
              : tranche.settlementStatus === 'rejected' ? 'rejected' : 'pending'
          }
          label={
            tranche.settlementStatus === 'confirmed' ? 'Confirmé'
              : tranche.settlementStatus === 'rejected' ? 'Rejeté' : 'Déclaré'
          }
        />
        {enAttente && actionnable && (
          <>
            <Bouton variante="primaire" onClick={() => onConfirmer(tranche)}>Confirmer</Bouton>
            <Bouton variante="danger" onClick={() => onRejeter(tranche)}>Rejeter</Bouton>
          </>
        )}
      </span>
    </li>
  )
}

function LigneDette({ item, sens, onRembourser, onConfirmer, onRejeter }) {
  const tranches = useTranches(item.id)
  const estDette = sens === 'debt'

  const reserve = useMemo(
    () => tranches
      .filter((t) => t.settlementStatus === 'declared')
      .reduce((somme, t) => somme + (Number.isSafeInteger(t.amount) ? t.amount : 0), 0),
    [tranches],
  )
  const declarable = Math.max(0, (item.remainingAmount ?? 0) - reserve)

  return (
    <li className="border-b border-line py-2 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex flex-wrap items-baseline gap-2">
          <span className={`text-xs font-semibold uppercase tracking-wide ${estDette ? 'text-outflow' : 'text-inflow'}`}>
            {estDette ? 'Dette' : 'Créance'}
          </span>
          <span className="text-sm font-medium tabular-nums text-ink">
            {formatCurrency(item.remainingAmount)}
          </span>
          {item.settledAmount > 0 && (
            <span className="text-xs text-ink-muted">sur {formatCurrency(item.originalAmount)}</span>
          )}
          {reserve > 0 && (
            <span className="text-xs text-warn">
              dont {formatCurrency(reserve)} en attente de confirmation
            </span>
          )}
        </span>

        <span className="flex items-center gap-3">
          <span className="text-xs text-ink-muted">{formatFirestoreDate(item.createdAt)}</span>
          <StatusBadge
            status={item.status === 'settled' ? 'confirmed' : 'pending'}
            label={DEBT_STATUS_LABELS[item.status] ?? item.status}
          />
          {estDette && item.status !== 'settled' && (
            <Bouton
              variante="primaire"
              disabled={declarable <= 0}
              onClick={() => onRembourser(item, declarable)}
              title={declarable <= 0 ? 'Tout le reste dû est déjà déclaré' : undefined}
            >
              Rembourser
            </Bouton>
          )}
        </span>
      </div>

      {tranches.length > 0 && (
        <ul aria-label={`Tranches de ${estDette ? 'la dette' : 'la créance'} ${item.id}`}>
          {tranches.map((tranche) => (
            <LigneTranche
              key={tranche.id}
              tranche={tranche}
              actionnable={!estDette}
              onConfirmer={(t) => onConfirmer(item, t)}
              onRejeter={(t) => onRejeter(item, t)}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function PartnerDetails({ partner }) {
  const [dialogue, setDialogue] = useState(null)
  const [montant, setMontant] = useState('')
  const [methode, setMethode] = useState(DEBT_SETTLEMENT_METHODS[0] ?? '')
  const [motif, setMotif] = useState('')
  const [erreur, setErreur] = useState(null)
  const [envoi, setEnvoi] = useState(false)

  const fermer = useCallback(() => {
    setDialogue(null)
    setMontant('')
    setMotif('')
    setErreur(null)
    setEnvoi(false)
  }, [])

  const ouvrir = useCallback((suivant) => {
    setErreur(null)
    setMontant('')
    setMotif('')
    setDialogue(suivant)
  }, [])

  /**
   * Un seul chemin d'envoi pour les six commandes. L'état d'envoi, la remise à
   * zéro et la traduction de l'erreur ne peuvent donc pas diverger d'un bouton
   * à l'autre — et un échec laisse le dialogue OUVERT avec sa saisie, au lieu
   * de la faire disparaître avec le message.
   */
  const envoyer = useCallback(async (action) => {
    setEnvoi(true)
    setErreur(null)
    try {
      await action()
      fermer()
    } catch (err) {
      setErreur(err?.message ?? 'L’opération n’a pas abouti.')
      setEnvoi(false)
    }
  }, [fermer])

  // ── La compensation : proposée seulement si elle est réellement possible ──
  const compensable = partner.compensable
  const detteAImputer = partner.debts.find((d) => d.remainingAmount > 0)
  const creanceOpposee = partner.credits.find((c) => c.remainingAmount > 0)
  const compensationPossible = compensable > 0 && detteAImputer && creanceOpposee

  const soumettre = () => {
    if (!dialogue) return
    if (dialogue.type === 'remboursement') {
      envoyer(() => declareInternalDebtSettlement({
        debtId: dialogue.debt.id,
        amount: montant,
        method: methode,
      }))
    } else if (dialogue.type === 'compensation') {
      envoyer(() => declareInternalDebtCompensation({
        debtId: detteAImputer.id,
        oppositeDebtId: creanceOpposee.id,
        amount: montant,
      }))
    } else if (dialogue.type === 'confirmation') {
      envoyer(() => routerConfirmation(dialogue.tranche)({
        debtId: dialogue.debt.id,
        settlementId: dialogue.tranche.id,
      }))
    } else if (dialogue.type === 'rejet') {
      envoyer(() => routerRejet(dialogue.tranche)({
        debtId: dialogue.debt.id,
        settlementId: dialogue.tranche.id,
        rejectionReason: motif,
      }))
    }
  }

  const montantValide = parseAmount(montant) !== null
  const plafond = dialogue?.type === 'remboursement' ? dialogue.declarable
    : dialogue?.type === 'compensation' ? compensable : null
  const montantDansLePlafond = plafond === null || (parseAmount(montant) ?? 0) <= plafond
  const motifValide = motif.trim().length >= 3 && motif.trim().length <= 500

  const peutSoumettre = !envoi && (
    dialogue?.type === 'confirmation' ? true
      : dialogue?.type === 'rejet' ? motifValide
        : montantValide && montantDansLePlafond
  )

  return (
    <div className="space-y-3">
      {compensationPossible && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2">
          <p className="text-sm text-ink">
            <span className="font-semibold tabular-nums">{formatCurrency(compensable)}</span>
            {' '}que vous vous devez mutuellement — une compensation les éteint des deux côtés.
          </p>
          <Bouton
            variante="primaire"
            onClick={() => ouvrir({ type: 'compensation' })}
            data-testid="ouvrir-compensation"
          >
            Compenser
          </Bouton>
        </div>
      )}

      <ul aria-label={`Dettes et créances avec ${partner.name}`}>
        {partner.debts.map((item) => (
          <LigneDette
            key={item.id}
            item={item}
            sens="debt"
            onRembourser={(debt, declarable) => ouvrir({ type: 'remboursement', debt, declarable })}
            onConfirmer={(debt, tranche) => ouvrir({ type: 'confirmation', debt, tranche })}
            onRejeter={(debt, tranche) => ouvrir({ type: 'rejet', debt, tranche })}
          />
        ))}
        {partner.credits.map((item) => (
          <LigneDette
            key={item.id}
            item={item}
            sens="credit"
            onRembourser={() => {}}
            onConfirmer={(debt, tranche) => ouvrir({ type: 'confirmation', debt, tranche })}
            onRejeter={(debt, tranche) => ouvrir({ type: 'rejet', debt, tranche })}
          />
        ))}
      </ul>

      <Dialog
        open={dialogue?.type === 'remboursement' || dialogue?.type === 'compensation'}
        onClose={fermer}
        testId="dialogue-declaration"
        title={dialogue?.type === 'compensation' ? 'Compenser' : 'Déclarer un remboursement'}
        description={
          dialogue?.type === 'compensation'
            ? `Jusqu’à ${formatCurrency(compensable)} avec ${partner.name}.`
            : `Jusqu’à ${formatCurrency(dialogue?.declarable ?? 0)} — le reste est déjà déclaré.`
        }
        footer={
          <>
            <Bouton onClick={fermer}>Annuler</Bouton>
            <Bouton variante="primaire" disabled={!peutSoumettre} onClick={soumettre}>
              {envoi ? 'Envoi…' : 'Déclarer'}
            </Bouton>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Montant</span>
            <input
              type="text"
              inputMode="numeric"
              value={montant}
              onChange={(e) => setMontant(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 tabular-nums text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            />
          </label>

          {dialogue?.type === 'remboursement' && (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Méthode</span>
              <select
                value={methode}
                onChange={(e) => setMethode(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                {DEBT_SETTLEMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          )}

          {/* Le message dit ce qui bloque, pas seulement que c'est bloqué. */}
          {montant !== '' && !montantValide && (
            <p className="text-sm text-danger">Entrez un montant entier, supérieur à zéro.</p>
          )}
          {montantValide && !montantDansLePlafond && (
            <p className="text-sm text-danger">
              Le maximum est {formatCurrency(plafond)}.
            </p>
          )}
          {erreur && <p className="text-sm text-danger" role="alert">{erreur}</p>}
        </div>
      </Dialog>

      <Dialog
        open={dialogue?.type === 'confirmation'}
        onClose={fermer}
        testId="dialogue-confirmation"
        title={EST_COMPENSATION(dialogue?.tranche) ? 'Confirmer la compensation' : 'Confirmer le règlement'}
        description={`${formatCurrency(dialogue?.tranche?.amount)} · ${settlementMethodLabel(dialogue?.tranche?.method)}`}
        footer={
          <>
            <Bouton onClick={fermer}>Annuler</Bouton>
            <Bouton variante="primaire" disabled={!peutSoumettre} onClick={soumettre}>
              {envoi ? 'Envoi…' : 'Confirmer'}
            </Bouton>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          {EST_COMPENSATION(dialogue?.tranche)
            ? 'Les deux dettes seront réduites d’autant. C’est définitif.'
            : 'La dette sera réduite d’autant. C’est définitif.'}
        </p>
        {erreur && <p className="mt-2 text-sm text-danger" role="alert">{erreur}</p>}
      </Dialog>

      <Dialog
        open={dialogue?.type === 'rejet'}
        onClose={fermer}
        testId="dialogue-rejet"
        title="Rejeter"
        description={`${formatCurrency(dialogue?.tranche?.amount)} · ${settlementMethodLabel(dialogue?.tranche?.method)}`}
        footer={
          <>
            <Bouton onClick={fermer}>Annuler</Bouton>
            <Bouton variante="danger" disabled={!peutSoumettre} onClick={soumettre}>
              {envoi ? 'Envoi…' : 'Rejeter'}
            </Bouton>
          </>
        }
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">
            Motif <span className="font-normal text-ink-muted">(3 à 500 caractères)</span>
          </span>
          <textarea
            rows={3}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          />
        </label>
        <p className="mt-1 text-xs text-ink-muted">
          La boutique qui a déclaré ce règlement lira ce motif.
        </p>
        {erreur && <p className="mt-2 text-sm text-danger" role="alert">{erreur}</p>}
      </Dialog>
    </div>
  )
}

export default PartnerDetails
