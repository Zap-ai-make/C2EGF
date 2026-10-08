import { useCallback, useMemo, useState } from 'react'
import { useToast } from '../../hooks/useToast'
import { useTransactions } from '../../context/transactions.jsx'
import { useSimpleNetworkData } from '../../hooks/useSimpleNetworkData'
import { runStoreTransactionCommand } from '../../services/storeTransactionCommandService'
import { parseFcfaAmount } from '../../utils/fcfaAmount.js'
import { formatCurrency } from '../../utils/formatCurrency'
import { NETWORK_OPTIONS } from '../../utils/constants'
import Dialog from '../ui/Dialog.jsx'
import RavitaillementForm from './RavitaillementForm.jsx'
import {
  ravitaillementsEnCours,
  grouperParExpediteur,
  expediteursConnus,
} from '../../utils/ravitaillement.js'

/**
 * Le ravitaillement — ce qu'on a reçu, et ce qu'il reste à rendre.
 *
 * POURQUOI UNE LISTE LÀ OÙ IL Y AVAIT UN FORMULAIRE
 * ────────────────────────────────────────────────
 * Le bouton ouvrait directement la saisie : la boutique pouvait déclarer ce
 * qu'elle recevait, jamais ce qu'elle rendait. Or le stock reçu le matin doit
 * repartir le soir, et aucune opération ne savait le faire — un dépôt déplace
 * DEUX réserves, alors qu'il s'agit d'en vider une seule.
 *
 * La liste vient donc devant, et la saisie derrière un bouton : on ouvre cet
 * écran dix fois pour rendre, une fois pour déclarer.
 *
 * LE GROUPEMENT PAR EXPÉDITEUR N'EST PAS UN CONFORT DE LECTURE
 * ───────────────────────────────────────────────────────────
 * L'argent vient de personnes différentes et n'est pas fongible entre elles :
 * on ne solde pas une livraison de l'une avec ce qu'on doit à l'autre. Le
 * total qui règle AVEC QUELQU'UN est donc celui de sa colonne, jamais le total
 * général.
 *
 * Le total général est quand même affiché, en tête, parce qu'il répond à une
 * autre question — « combien la boutique doit-elle encore en tout ? » — qu'on
 * se pose en fermant, et qu'on ne peut pas reconstituer de tête en additionnant
 * cinq colonnes. Il informe ; il ne sert à solder personne.
 */

const VASES = [
  { cle: 'stock', libelle: 'Stock' },
  { cle: 'liquidite', libelle: 'Espèce' },
]

const libelleVase = (cle) => VASES.find((v) => v.cle === cle)?.libelle ?? cle

/**
 * Le réseau dont on lit les réserves. Le serveur, lui, résout `STORE_NETWORKS[0]`
 * (storeTransactionCommand.js, action `returnReplenishment`) : c'est le même
 * premier réseau du profil, et il reste l'autorité — ceci ne sert qu'à montrer
 * le disponible avant le clic.
 */
const RESEAU = NETWORK_OPTIONS[0]

function FormulaireRetour({ ravitaillement, onFait, onAnnuler }) {
  const { showToast } = useToast()
  const { getStock, getLiquidite } = useSimpleNetworkData()
  const [montant, setMontant] = useState('')
  const [vase, setVase] = useState(ravitaillement.balanceType ?? 'stock')
  const [envoiEnCours, setEnvoiEnCours] = useState(false)

  const reste = Number(ravitaillement.remainingAmount) || 0

  /**
   * DEUX PLAFONDS, ET IL FAUT SAVOIR LEQUEL BLOQUE.
   *
   * Le reste dû dit ce que la boutique DEVRAIT rendre ; le disponible dit ce
   * qu'elle PEUT rendre. Les deux divergent dès que le stock reçu le matin est
   * parti en dépôts dans la journée : on doit encore un million et il n'en
   * reste que deux cent mille en réserve.
   *
   * Les confondre dans un seul « montant invalide » rendrait les deux
   * situations indiscernables — alors qu'elles se corrigent autrement : l'une
   * en rendant moins, l'autre en rendant dans l'AUTRE réserve.
   */
  const disponible = vase === 'stock'
    ? Number(getStock(RESEAU)) || 0
    : Number(getLiquidite()) || 0

  const valeur = parseFcfaAmount(montant)
  const tropGrand = valeur !== null && valeur > reste
  const tropPeuEnReserve = valeur !== null && !tropGrand && valeur > disponible
  const peutEnvoyer = valeur !== null && !tropGrand && !tropPeuEnReserve && !envoiEnCours

  const envoyer = useCallback(async (event) => {
    event.preventDefault()
    if (!peutEnvoyer) return
    setEnvoiEnCours(true)
    try {
      await runStoreTransactionCommand({
        action: 'returnReplenishment',
        replenishmentId: ravitaillement.id,
        amount: valeur,
        balanceType: vase,
      })
      showToast(`Retour enregistré : ${formatCurrency(valeur)} en ${libelleVase(vase).toLowerCase()}.`, 'success')
      onFait?.()
    } catch (err) {
      // Le serveur rédige des refus lisibles — « Stock insuffisant.
      // Disponible : … » — et c'est lui qui connaît l'état réel.
      showToast(err?.message || "Le retour n'a pas pu être enregistré.", 'error')
    } finally {
      setEnvoiEnCours(false)
    }
  }, [peutEnvoyer, ravitaillement.id, valeur, vase, showToast, onFait])

  return (
    <form onSubmit={envoyer} className="space-y-4" data-testid="formulaire-retour">
      <p className="m-0 text-sm text-ink-muted">
        Reçu de <span className="font-semibold text-ink">{ravitaillement.expediteur}</span>
        {' · '}reste dû <span className="font-semibold tabular-nums text-ink">{formatCurrency(reste)}</span>
      </p>

      <div>
        <label htmlFor="retour-montant" className="mb-1 block text-sm font-semibold text-ink">
          Montant rendu (FCFA)
        </label>
        <input
          id="retour-montant"
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          autoFocus
          value={montant}
          onChange={(event) => setMontant(event.target.value)}
          data-testid="retour-montant"
          aria-invalid={tropGrand || tropPeuEnReserve || undefined}
          className={`w-full rounded border-2 px-3 py-2 tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
            tropGrand || tropPeuEnReserve ? 'border-danger' : 'border-line'
          }`}
        />
        {tropGrand && (
          <p className="mt-1 text-sm text-danger">
            Supérieur au reste dû ({formatCurrency(reste)}).
          </p>
        )}
      </div>

      <fieldset className="m-0 border-0 p-0">
        {/* On reçoit du stock électronique et on rend souvent des espèces :
            la réserve rendue est un choix à part entière, pas une conséquence. */}
        <legend className="mb-2 text-sm font-semibold text-ink">Rendu en</legend>
        <div className="flex gap-2">
          {VASES.map((v) => (
            <label
              key={v.cle}
              className={`flex-1 cursor-pointer rounded border-2 px-3 py-2 text-center text-sm font-medium transition-colors ${
                vase === v.cle ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-ink'
              }`}
            >
              <input
                type="radio"
                name="retour-vase"
                value={v.cle}
                checked={vase === v.cle}
                onChange={() => setVase(v.cle)}
                className="sr-only"
              />
              {v.libelle}
            </label>
          ))}
        </div>

        {/* Le disponible suit la réserve choisie : basculer Stock ↔ Espèce
            change le chiffre, parce que ce sont deux caisses séparées. */}
        <p className="mt-2 text-sm text-ink-muted" data-testid="retour-disponible">
          Disponible : <span className="font-semibold tabular-nums text-ink">{formatCurrency(disponible)}</span>
        </p>

        {tropPeuEnReserve && (
          <p className="mt-1 text-sm text-danger" data-testid="retour-reserve-insuffisante">
            {libelleVase(vase)} insuffisant{vase === 'liquidite' ? 'e' : ''}. Disponible : {formatCurrency(disponible)}.
          </p>
        )}
      </fieldset>

      <div className="flex justify-end gap-3 border-t border-line pt-4">
        <button
          type="button"
          onClick={onAnnuler}
          disabled={envoiEnCours}
          className="rounded border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-brand-50 disabled:opacity-60"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={!peutEnvoyer}
          data-testid="confirmer-retour"
          className="rounded bg-brand-500 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
        >
          {envoiEnCours ? 'Enregistrement…' : 'Enregistrer le retour'}
        </button>
      </div>
    </form>
  )
}

function RavitaillementPanel({ open, onClose }) {
  const { completedTransactions = [] } = useTransactions()
  const [vue, setVue] = useState('liste')
  const [cible, setCible] = useState(null)

  const enCours = useMemo(() => ravitaillementsEnCours(completedTransactions), [completedTransactions])
  const groupes = useMemo(() => grouperParExpediteur(enCours), [enCours])
  const expediteurs = useMemo(() => expediteursConnus(completedTransactions), [completedTransactions])
  const totalDu = useMemo(
    () => enCours.reduce((somme, ligne) => somme + (Number(ligne.remainingAmount) || 0), 0),
    [enCours],
  )

  const revenirALaListe = useCallback(() => {
    setVue('liste')
    setCible(null)
  }, [])

  const fermer = useCallback(() => {
    revenirALaListe()
    onClose?.()
  }, [revenirALaListe, onClose])

  const titre = vue === 'nouveau' ? 'Nouveau ravitaillement' : vue === 'retour' ? 'Rendre au dealer' : 'Ravitaillement'

  return (
    <Dialog
      open={open}
      onClose={fermer}
      title={titre}
      description={vue === 'liste' ? 'Ce que la boutique doit encore, et à qui.' : undefined}
      testId="panneau-ravitaillement"
      largeur="max-w-xl"
      spacious
    >
      {vue === 'nouveau' && (
        <RavitaillementForm
          expediteurs={expediteurs}
          onComplete={revenirALaListe}
          onCancel={revenirALaListe}
        />
      )}

      {vue === 'retour' && cible && (
        <FormulaireRetour
          ravitaillement={cible}
          onFait={revenirALaListe}
          onAnnuler={revenirALaListe}
        />
      )}

      {vue === 'liste' && (
        <div className="space-y-5">
          {groupes.length === 0 && (
            <p className="m-0 rounded border border-line bg-surface-2 px-4 py-6 text-center text-sm text-ink-muted">
              Rien à rendre pour le moment.
            </p>
          )}

          {/* Le total de tout ce qui est dû, toutes personnes confondues. Il ne
              sert à solder personne — on rend à chacun sa colonne — mais c'est
              le chiffre qu'on cherche en fermant, et il ne s'additionne pas de
              tête sur cinq groupes. */}
          {groupes.length > 0 && (
            <div
              className="flex flex-wrap items-baseline justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3"
              data-testid="total-ravitaillements"
            >
              <span className="text-sm font-semibold text-brand-700">
                {enCours.length} livraison{enCours.length > 1 ? 's' : ''} à rendre
              </span>
              <span className="font-mono text-base font-bold tabular-nums text-brand-700">
                {formatCurrency(totalDu)}
              </span>
            </div>
          )}

          {groupes.map((groupe) => (
            <section key={groupe.expediteur} data-testid={`groupe-${groupe.expediteur}`}>
              <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-line pb-1.5">
                <h3 className="m-0 text-sm font-bold text-ink">{groupe.expediteur}</h3>
                <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                  {formatCurrency(groupe.total)}
                </span>
              </div>

              <ul className="m-0 list-none space-y-2 p-0">
                {groupe.lignes.map((ligne) => (
                  <li
                    key={ligne.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2.5"
                    data-testid={`ravitaillement-${ligne.id}`}
                  >
                    <div className="min-w-0 text-sm">
                      <p className="m-0 text-ink">
                        <span className="font-semibold tabular-nums">{formatCurrency(ligne.montant)}</span>
                        {' en '}{libelleVase(ligne.balanceType).toLowerCase()}
                        <span className="text-ink-muted">{' · '}{ligne.date}</span>
                      </p>
                      <p className="m-0 text-xs text-ink-muted">
                        rendu {formatCurrency(Number(ligne.returnedAmount) || 0)}
                        {' · '}
                        <span className="font-semibold text-ink">reste {formatCurrency(ligne.remainingAmount)}</span>
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => { setCible(ligne); setVue('retour') }}
                      data-testid={`retour-${ligne.id}`}
                      className="shrink-0 rounded border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-brand-400 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                    >
                      Retour
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <div className="flex justify-end border-t border-line pt-4">
            <button
              type="button"
              onClick={() => setVue('nouveau')}
              data-testid="nouveau-ravitaillement"
              className="rounded bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              Nouveau ravitaillement
            </button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

export default RavitaillementPanel
