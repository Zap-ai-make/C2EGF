import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { listAllActiveStores, createDealerRequest, parseDealerAmount } from '../../services/dealerService'
import { createPartnerDeposit } from '../../services/storeTransferService'
import { formatCurrency } from '../../utils/formatCurrency'
import {
  DEALER_REQUEST_TYPES,
  DEALER_REQUEST_TYPE_LABELS,
  DEALER_NETWORKS,
  IS_DEALER_MULTI_NETWORK,
} from '../../constants/dealerConstants'
import { NETWORK_CONFIG } from '../../constants/networkConfig'
import { DEALER_PARTNERS, partnerLabel, findPartner } from '../../constants/dealerPartners'
import { useDealerInventory } from '../../hooks/useDealerInventory'
import { projeterRavitaillement, projeterOperationPartenaire } from '../../utils/cuvesApresEnvoi'
import CuvesApresEnvoi from '../../components/dealer/CuvesApresEnvoi'

function validateAmount(raw) {
  const s = String(raw ?? '').trim()
  if (s === '') return 'Le montant est obligatoire.'
  if (!/^[0-9]+$/.test(s)) return 'Entier uniquement (pas de virgule, de point ni de notation scientifique).'
  const n = Number(s)
  if (!Number.isSafeInteger(n) || n <= 0) return 'Le montant doit être un entier strictement positif.'
  return null
}

function NewDealerRequest() {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const preStoreId = searchParams.get('storeId') || ''
  const preTypeBrut = searchParams.get('type') || ''
  // Un `?type=` inconnu ne pré-choisit rien plutôt que d'introduire une valeur
  // que le formulaire ne sait pas afficher.
  const preType = Object.values(DEALER_REQUEST_TYPES).includes(preTypeBrut) ? preTypeBrut : ''

  const [targetType, setTargetType] = useState('store') // 'store' | 'partner'

  const [stores, setStores] = useState([])
  const [storesLoading, setStoresLoading] = useState(true)
  const [storesError, setStoresError] = useState(null)

  const [selectedStoreId, setSelectedStoreId] = useState(preStoreId)
  const [requestType, setRequestType] = useState(preType)
  const [selectedPartnerId, setSelectedPartnerId] = useState('')
  const [partnerOperation, setPartnerOperation] = useState('deposit') // 'deposit' | 'withdrawal'
  const [network, setNetwork] = useState(DEALER_NETWORKS[0]) // réseau ciblé (multi-réseaux)
  const [amountRaw, setAmountRaw] = useState('')
  const [amountError, setAmountError] = useState(null)

  const [step, setStep] = useState('form') // 'form' | 'confirm'
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const submitLockRef = useRef(false)

  // ⚠ `listAllActiveStores`, et surtout PAS `listActiveStores` : cette
  //   dernière pagine à 20, et c'est exactement ce que faisait cet écran — il
  //   n'appelait le service qu'une fois, ignorait `hasMore` et `lastDoc`, et
  //   n'offrait donc que 20 boutiques sur 84. Un menu déroulant amputé des deux
  //   tiers de ses options n'est pas une liste partielle : c'est un geste
  //   qu'on ne peut pas faire. Défaut figé par tc-205.
  useEffect(() => {
    let cancelled = false
    listAllActiveStores()
      .then(result => { if (!cancelled) { setStores(result.stores); setStoresLoading(false) } })
      .catch(err => { if (!cancelled) { setStoresError(err.message); setStoresLoading(false) } })
    return () => { cancelled = true }
  }, [])

  // La garde reste : un `?storeId=` peut désigner une boutique fermée depuis, ou
  // n'avoir jamais existé. Mais elle ne se déclenche plus pour la seule raison
  // que la boutique était à la 40e place — et quand elle se déclenche, elle le
  // DIT, au lieu de vider le champ en silence.
  const [preStoreIntrouvable, setPreStoreIntrouvable] = useState(false)
  useEffect(() => {
    if (!preStoreId || stores.length === 0) return
    const exists = stores.some(s => s.id === preStoreId)
    setPreStoreIntrouvable(!exists)
    if (!exists) setSelectedStoreId('')
  }, [stores, preStoreId])

  const selectedStore = stores.find(s => s.id === selectedStoreId) || null
  const selectedPartner = findPartner(selectedPartnerId)
  const isPartner = targetType === 'partner'

  /**
   * Arrivée depuis la ligne d'une boutique : il ne reste QUE le montant.
   *
   * La ligne d'accueil et la carte boutique passent `?storeId=` ET `?type=`. Le
   * formulaire les honorait déjà ; ce qu'il ne faisait pas, c'était le DIRE et
   * en tirer les conséquences. Deux champs sur trois sont remplis, et le curseur
   * était quand même à l'entrée du formulaire : le dealer relisait un choix
   * qu'il venait de faire, puis descendait au montant.
   *
   * ⚠ Déplacer le focus sans l'annoncer désoriente un lecteur d'écran, qui
   *   atterrit sur un champ « Montant » sans savoir pour qui ni pour quoi. D'où
   *   la ligne `role="status"` ci-dessous : elle nomme la boutique et la
   *   ressource déjà choisies, et elle est LUE, pas seulement affichée.
   */
  const preRempli = Boolean(preStoreId && preType && selectedStore && !isPartner)
  const champMontantRef = useRef(null)
  const focusPreRempliFait = useRef(false)
  useEffect(() => {
    if (focusPreRempliFait.current || storesLoading || !preRempli) return
    focusPreRempliFait.current = true
    champMontantRef.current?.focus()
  }, [storesLoading, preRempli])

  /**
   * Les cuves du dealer, pour la projection de l'écran de confirmation.
   *
   * Le hook ouvre la même écoute Firestore que la barre latérale ; le SDK les
   * multiplexe, il n'y a pas de lecture supplémentaire (cf. `useDealerInventory`).
   */
  const { inventory } = useDealerInventory()
  const projectionCuves = useMemo(() => {
    const montant = parseDealerAmount(amountRaw)
    return isPartner
      ? projeterOperationPartenaire({ operation: partnerOperation, montant, inventaire: inventory, reseau: network })
      : projeterRavitaillement({ requestType, montant, inventaire: inventory, reseau: network })
  }, [isPartner, partnerOperation, requestType, amountRaw, inventory, network])

  const handleReview = useCallback(() => {
    if (isPartner) {
      if (!selectedPartnerId) return
    } else {
      if (!selectedStoreId || !requestType) return
    }
    const err = validateAmount(amountRaw)
    if (err) { setAmountError(err); return }
    setAmountError(null)
    setSubmitError(null)
    setStep('confirm')
  }, [isPartner, selectedPartnerId, selectedStoreId, requestType, amountRaw])

  const handleSubmit = useCallback(async () => {
    if (submitLockRef.current || isSubmitting) return
    submitLockRef.current = true
    setIsSubmitting(true)
    setSubmitError(null)

    try {
      if (isPartner) {
        // callable → network omis en mono (deploy-safe : le serveur applique le défaut).
        await createPartnerDeposit({
          partner: findPartner(selectedPartnerId),
          amount: parseDealerAmount(amountRaw),
          operation: partnerOperation,
          network: IS_DEALER_MULTI_NETWORK ? network : undefined,
        })
        // Le message porte le MÊME MOT que le bouton (« Confirmer » →
        // « confirmée ») et voyage dans l'état du routeur : c'est à l'arrivée
        // qu'on a besoin de savoir que le geste a abouti.
        navigate('/dealer/history', {
          replace: true,
          state: {
            message: `Opération partenaire confirmée : ${
              partnerOperation === 'withdrawal' ? 'retrait' : 'dépôt'
            } de ${formatCurrency(parseDealerAmount(amountRaw))} pour ${partnerLabel(findPartner(selectedPartnerId))}.`,
          },
        })
      } else {
        // écriture directe : network toujours présent (champ requis) ; mono = 'Orange'.
        await createDealerRequest({
          currentUser,
          userProfile,
          targetStoreId: selectedStoreId,
          requestType,
          amount: parseDealerAmount(amountRaw),
          network,
        })
        navigate('/dealer/requests', {
          replace: true,
          state: {
            message: `Ravitaillement confirmé : ${formatCurrency(parseDealerAmount(amountRaw))} de ${
              DEALER_REQUEST_TYPE_LABELS[requestType].replace(/^Ajout de /, '')
            } pour ${selectedStore?.name ?? selectedStoreId}.`,
          },
        })
      }
    } catch (err) {
      setSubmitError(err.message)
      setStep('form')
    } finally {
      submitLockRef.current = false
      setIsSubmitting(false)
    }
  }, [isPartner, currentUser, userProfile, selectedStoreId, selectedStore, requestType, selectedPartnerId, partnerOperation, network, amountRaw, navigate, isSubmitting])

  const switchTarget = (t) => {
    setTargetType(t)
    setStep('form')
    setSubmitError(null)
    setAmountError(null)
    setPartnerOperation('deposit')
    setNetwork(DEALER_NETWORKS[0]) // repart du réseau primaire au changement de cible
  }

  if (storesLoading) {
    return (
      <div className="max-w-xl mx-auto" data-testid="new-dealer-request">
        <div className="rounded-2xl bg-surface p-8 text-center text-ink-muted shadow-sm ring-1 ring-gray-100 motion-safe:animate-pulse">Chargement…</div>
      </div>
    )
  }
  if (storesError) {
    return (
      <div className="max-w-xl mx-auto" data-testid="new-dealer-request">
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft p-5 text-danger">
          <p className="font-medium">Impossible de charger les boutiques</p>
          <p className="text-sm mt-1">{storesError}</p>
        </div>
      </div>
    )
  }

  // ── Écran de confirmation ─────────────────────────────────────────────────
  if (step === 'confirm') {
    const parsedAmt = parseDealerAmount(amountRaw)
    return (
      <div className="max-w-xl mx-auto" data-testid="new-dealer-request">
        <div className="rounded-2xl bg-surface p-6 shadow-sm ring-1 ring-gray-100">
          <h1 className="text-lg font-bold text-ink mb-5">
            {isPartner ? 'Confirmer l\'opération partenaire' : 'Confirmer le ravitaillement'}
          </h1>
          <dl className="mb-6 divide-y divide-line/60">
            {isPartner ? (
              <>
                <div className="flex py-3">
                  <dt className="w-36 flex-shrink-0 text-sm text-ink-muted">Partenaire</dt>
                  <dd className="text-sm font-medium text-ink" data-testid="confirm-partner">{partnerLabel(selectedPartner)}</dd>
                </div>
                <div className="flex py-3">
                  <dt className="w-36 flex-shrink-0 text-sm text-ink-muted">Opération</dt>
                  <dd className="text-sm font-medium text-ink" data-testid="confirm-operation">
                    {partnerOperation === 'withdrawal'
                      ? `Retrait — stock +${formatCurrency(parsedAmt)}, liquidité −${formatCurrency(parsedAmt)}`
                      : `Dépôt — stock −${formatCurrency(parsedAmt)}, liquidité +${formatCurrency(parsedAmt)}`}
                  </dd>
                </div>
              </>
            ) : (
              <>
                <div className="flex py-3">
                  <dt className="w-36 flex-shrink-0 text-sm text-ink-muted">Boutique</dt>
                  <dd className="text-sm font-medium text-ink" data-testid="confirm-store">{selectedStore?.name ?? selectedStoreId}</dd>
                </div>
                <div className="flex py-3">
                  <dt className="w-36 flex-shrink-0 text-sm text-ink-muted">Type</dt>
                  <dd className="text-sm font-medium text-ink" data-testid="confirm-type">{DEALER_REQUEST_TYPE_LABELS[requestType]}</dd>
                </div>
              </>
            )}
            <div className="flex py-3">
              <dt className="w-36 flex-shrink-0 text-sm text-ink-muted">Montant</dt>
              <dd className="text-sm font-semibold text-ink" data-testid="confirm-amount">{formatCurrency(parsedAmt)}</dd>
            </div>
            <div className="flex py-3">
              <dt className="w-36 flex-shrink-0 text-sm text-ink-muted">Réseau</dt>
              <dd className="text-sm font-medium text-ink" data-testid="confirm-network">{network}</dd>
            </div>
          </dl>

          <CuvesApresEnvoi projection={projectionCuves} />

          {submitError && (
            <div role="alert" className="mb-4 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">{submitError}</div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { setStep('form'); setSubmitError(null) }}
              disabled={isSubmitting}
              className="flex-1 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-brand-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              data-testid="btn-cancel-confirm"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex-1 rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              aria-busy={isSubmitting}
              data-testid="btn-submit-confirm"
            >
              {isSubmitting ? 'Envoi en cours…' : 'Confirmer'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Formulaire ────────────────────────────────────────────────────────────
  const canReview = amountRaw.trim() !== '' && (isPartner ? !!selectedPartnerId : (selectedStoreId && requestType))
  const tabClass = (active) =>
    `flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
      active ? 'bg-brand-500 text-white' : 'border border-line bg-surface text-ink hover:bg-brand-50'
    }`

  return (
    <div className="max-w-xl mx-auto" data-testid="new-dealer-request">
      <div className="rounded-2xl bg-surface p-6 shadow-sm ring-1 ring-gray-100">
        <h1 className="text-lg font-bold text-ink mb-4">
          {isPartner ? 'Nouvelle opération partenaire' : 'Nouveau ravitaillement'}
        </h1>

        {/* Bascule destinataire */}
        <div className="mb-5 flex gap-2">
          <button type="button" className={tabClass(!isPartner)} onClick={() => switchTarget('store')} data-testid="target-store">Boutique</button>
          <button type="button" className={tabClass(isPartner)} onClick={() => switchTarget('partner')} data-testid="target-partner">Partenaire</button>
        </div>

        {submitError && (
          <div role="alert" className="mb-4 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">{submitError}</div>
        )}

        {/* Ce que le lien a déjà répondu — et pourquoi le curseur a sauté au
            montant. Annoncé (`role="status"`), pas seulement affiché. */}
        {preRempli && (
          <p role="status" data-testid="pre-rempli" className="mb-4 text-sm text-ink-muted">
            <span className="font-medium text-ink">{selectedStore.name}</span>
            {' — '}
            {DEALER_REQUEST_TYPE_LABELS[requestType].toLowerCase()}. Il ne reste
            que le montant à saisir.
          </p>
        )}

        <form onSubmit={e => { e.preventDefault(); handleReview() }} noValidate>
          {isPartner ? (
            <div className="mb-4">
              <label htmlFor="partner-select" className="mb-1 block text-sm font-medium text-ink">
                Partenaire <span aria-hidden="true" className="text-danger">*</span>
              </label>
              <select
                id="partner-select"
                value={selectedPartnerId}
                onChange={e => setSelectedPartnerId(e.target.value)}
                required
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                data-testid="select-partner"
              >
                <option value="">— Sélectionner un partenaire —</option>
                {DEALER_PARTNERS.map(p => (
                  <option key={p.id} value={p.id}>{partnerLabel(p)}</option>
                ))}
              </select>

              <fieldset className="mt-4">
                <legend className="mb-2 block text-sm font-medium text-ink">
                  Opération <span aria-hidden="true" className="text-danger">*</span>
                </legend>
                <div role="radiogroup" aria-label="Opération partenaire" className="inline-flex rounded-xl bg-canvas p-1">
                  {[
                    { value: 'deposit', label: 'Dépôt' },
                    { value: 'withdrawal', label: 'Retrait' },
                  ].map(op => {
                    const active = partnerOperation === op.value
                    return (
                      <button
                        key={op.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setPartnerOperation(op.value)}
                        className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                          active ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                        }`}
                        data-testid={`partner-op-${op.value}`}
                      >
                        {op.label}
                      </button>
                    )
                  })}
                </div>
              </fieldset>

              <p className="mt-3 text-xs text-ink-muted">
                {partnerOperation === 'withdrawal'
                  ? 'Retrait immédiat, sans notification : votre inventaire fait stock +montant et liquidité −montant.'
                  : 'Dépôt immédiat, sans notification : votre inventaire fait stock −montant et liquidité +montant.'}
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <label htmlFor="store-select" className="mb-1 block text-sm font-medium text-ink">
                  Boutique <span aria-hidden="true" className="text-danger">*</span>
                </label>
                <select
                  id="store-select"
                  value={selectedStoreId}
                  onChange={e => setSelectedStoreId(e.target.value)}
                  required
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                  data-testid="select-store"
                >
                  <option value="">— Sélectionner une boutique —</option>
                  {stores.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
                </select>
                {preStoreIntrouvable ? (
                  <p role="alert" className="mt-1 text-xs font-medium text-warn" data-testid="pre-store-introuvable">
                    La boutique du lien n’est plus en service. Choisissez-en une dans la liste.
                  </p>
                ) : (
                  !selectedStoreId && (
                    <p className="mt-1 text-xs text-ink-muted">
                      Les {stores.length} boutiques actives du réseau sont listées.
                    </p>
                  )
                )}
              </div>

              <div className="mb-4">
                <fieldset>
                  <legend className="mb-2 block text-sm font-medium text-ink">
                    Type de ravitaillement <span aria-hidden="true" className="text-danger">*</span>
                  </legend>
                  <div className="flex flex-wrap gap-4">
                    {Object.entries(DEALER_REQUEST_TYPE_LABELS).map(([value, label]) => (
                      <label key={value} className="flex items-center gap-2 cursor-pointer text-sm" data-testid={`radio-type-${value}`}>
                        <input
                          type="radio"
                          name="requestType"
                          value={value}
                          checked={requestType === value}
                          onChange={() => setRequestType(value)}
                          className="h-4 w-4 accent-brand-500 focus:ring-brand-400"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </>
          )}

          {/*
            Réseau — un sélecteur en multi-réseaux, RIEN en mono.
            ─────────────────────────────────────────────────────
            Il y avait ici, en mono-réseau, un champ en lecture seule affichant
            « Orange » : un champ qui ne peut valoir qu'une chose n'est pas un
            champ. Il ne se remplit pas, ne se choisit pas, n'échoue pas — et il
            occupait le même dessin, le même intitulé et le même rang que la
            boutique et le montant, qui, eux, demandent une décision. Sur un
            formulaire de trois questions, la troisième n'en était pas une.

            ⚠ Ce n'est PAS la valeur qui disparaît, seulement sa saisie :
              `network` reste dans l'état, part inchangé dans le payload
              (`network: 'Orange'` — tc-030 le fige) et reste écrit sur l'écran
              de confirmation, où il n'est plus un champ mais une mention du
              reçu.
          */}
          {IS_DEALER_MULTI_NETWORK && (
            <div className="mb-4">
              <label htmlFor="network-select" className="mb-1 block text-sm font-medium text-ink">Réseau</label>
              <select
                id="network-select"
                value={network}
                onChange={e => setNetwork(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                data-testid="select-network"
              >
                {DEALER_NETWORKS.map(n => (<option key={n} value={n}>{NETWORK_CONFIG[n]?.name ?? n}</option>))}
              </select>
            </div>
          )}

          {/* Montant */}
          <div className="mb-6">
            <label htmlFor="amount-input" className="mb-1 block text-sm font-medium text-ink">
              Montant (FCFA) <span aria-hidden="true" className="text-danger">*</span>
            </label>
            <input
              id="amount-input" type="text" inputMode="numeric" pattern="[0-9]*"
              ref={champMontantRef}
              value={amountRaw}
              onChange={e => { setAmountRaw(e.target.value); if (amountError) setAmountError(null) }}
              placeholder="Ex : 50000" required
              className={`w-full rounded-lg border bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 ${
                amountError ? 'border-danger focus:border-danger focus:ring-danger' : 'border-line focus:border-brand-400 focus:ring-brand-400'
              }`}
              aria-invalid={amountError ? 'true' : undefined}
              data-testid="input-amount"
            />
            {amountError ? (
              <p role="alert" className="mt-1 text-xs text-danger">{amountError}</p>
            ) : (
              <p className="mt-1 text-xs text-ink-muted">Entier positif uniquement, sans virgule ni point.</p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate('/dealer/requests')}
              className="flex-1 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              data-testid="btn-cancel-form"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={!canReview}
              className="flex-1 rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              data-testid="btn-review"
            >
              {/* Le bouton nomme CE QUI VA SE PASSER, et pas le geste abstrait
                  de vérifier. « Vérifier » seul ne disait ni quoi ni pour qui,
                  et un lecteur d'écran qui parcourt les boutons d'un formulaire
                  n'entendait qu'un verbe sans objet. */}
              {isPartner ? 'Vérifier l’opération' : 'Vérifier le ravitaillement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default NewDealerRequest
