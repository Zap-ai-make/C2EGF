/*
 * « ANNULER » À L'ÉCRAN, « Supprimée » DANS LES DONNÉES — ET C'EST VOULU.
 *
 * La boutique dit « annuler » : c'est son mot pour ce geste, et c'est celui
 * que porte l'interface. Le registre, lui, continue d'écrire deux statuts
 * distincts — « Supprimée » pour une saisie fausse qu'on corrige, « Annulée »
 * pour une décision métier assumée. Les confondre en base effacerait une
 * information que personne ne pourrait reconstituer ensuite ; les distinguer
 * à l'écran n'apportait rien à qui veut seulement défaire sa ligne.
 */

import { useState, useRef, useEffect, useMemo, memo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTransactions } from '../../context/transactions.jsx'
import { useTheme } from '../../context/ThemeContext.jsx'
import { PAYMENT_METHODS } from '../../utils/constants.js'
import { getClientName, formatTransactionDateTime } from '../../utils/helpers.js'
import { SkeletonRow } from '../ui/SkeletonList.jsx'
import EmptyState from '../ui/EmptyState.jsx'
import Dialog from '../ui/Dialog.jsx'
import { ChevronLeft } from 'lucide-react'
import { ClipboardCheck } from 'lucide-react'
import OptimisticToast from '../ui/OptimisticToast.jsx'
import logger from '../../utils/logger.js'
import { generateIdempotencyKey } from '../../services/settlementService.js'
import { prefereMouvementReduit } from '../../hooks/useReducedMotion.js'
import { sommesEnAttente } from '../../utils/caisse.js'
import { attenteDe } from '../../utils/attente.js'
import { regrouperParClientEtType } from '../../utils/regroupement.js'
import { ChevronRight } from 'lucide-react'

const TransactionTable = memo(function TransactionTable() {
  const { pendingTransactions, getActionButtons, getTransactionStyles, addPaymentTranche, addRefundTranche, startEditTransaction, trashTransaction, loading } = useTransactions()
  const { themeClasses } = useTheme()
  // La ligne que le gérant s'apprête à supprimer, le temps qu'il confirme.
  const [aSupprimer, setASupprimer] = useState(null)
  const [suppressionEnCours, setSuppressionEnCours] = useState(false)

  // Déduplicateur pour éviter les erreurs de clés React
  const uniquePendingTransactions = useMemo(() => {
    const seen = new Set()
    return (pendingTransactions || []).filter(transaction => {
      if (seen.has(transaction.id)) {
        return false
      }
      seen.add(transaction.id)
      return true
    })
  }, [pendingTransactions])

  /**
   * UN SEUL MINUTEUR POUR TOUT LE TABLEAU.
   *
   * Chaque ligne affiche depuis combien de temps elle attend, mais toutes
   * affichent la MÊME seconde : un `setInterval` par ligne ferait tourner
   * soixante horloges pour un seul chiffre. Et il ne tourne pas du tout quand
   * il n'y a rien à compter — l'écran des non terminées est souvent vide.
   */
  const [maintenant, setMaintenant] = useState(() => Date.now())
  const riendACompter = uniquePendingTransactions.length === 0

  useEffect(() => {
    if (riendACompter) return undefined
    setMaintenant(Date.now())
    const minuteur = setInterval(() => setMaintenant(Date.now()), 1000)
    return () => clearInterval(minuteur)
  }, [riendACompter])
  /**
   * Ce qui reste a encaisser et a payer, par type.
   *
   * Le calcul vit dans `utils/caisse.js` : la barre des soldes affiche le meme
   * agregat, et deux normalisations de « Depot » finiraient par diverger.
   */
  const totauxEnAttente = useMemo(
    () => sommesEnAttente(uniquePendingTransactions),
    [uniquePendingTransactions],
  )

  const [activeDropdown, setActiveDropdown] = useState(null)
  // Le code agent SUR LEQUEL l'argent part, quand il ne passe pas de la main a
  // la main. Facultatif de bout en bout : vide, il n'est pas transmis.
  const [codeAgentReglement, setCodeAgentReglement] = useState('')

  /**
   * Un client qui depose six fois occupait six rangees. Une seule desormais,
   * avec le total — et les six en dessous quand on la deplie.
   *
   * Le depliage plutot qu'une modale : les actions de reglement ouvrent un menu
   * positionne en PORTAIL, avec son propre z-index. Les enfermer dans un
   * dialogue les ferait se battre avec son piege a focus, alors qu'ici toute la
   * mecanique existante continue de fonctionner sans y toucher.
   */
  const [groupesDeplies, setGroupesDeplies] = useState(() => new Set())

  const basculerGroupe = useCallback((cle) => {
    setGroupesDeplies((precedent) => {
      const suivant = new Set(precedent)
      if (suivant.has(cle)) suivant.delete(cle)
      else suivant.add(cle)
      return suivant
    })
  }, [])

  const rangees = useMemo(
    () => regrouperParClientEtType(uniquePendingTransactions),
    [uniquePendingTransactions],
  )

  const lignesAffichees = useMemo(() => {
    const sortie = []
    for (const rangee of rangees) {
      if (rangee.seule) { sortie.push({ seule: rangee.seule }); continue }
      sortie.push({ entete: rangee.groupe })
      if (groupesDeplies.has(rangee.groupe.cle)) {
        for (const ligne of rangee.groupe.lignes) sortie.push({ seule: ligne, enfant: true })
      }
    }
    return sortie
  }, [rangees, groupesDeplies])
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })
  const [currentActionType, setCurrentActionType] = useState(null)
  const [processingActions, setProcessingActions] = useState(new Set())
  const [rollbackToast, setRollbackToast] = useState({ show: false, message: '', type: 'info' })
  const [dropdownStep, setDropdownStep] = useState(1)
  const [selectedMethod, setSelectedMethod] = useState(null)
  const [settlementAmount, setSettlementAmount] = useState('')
  const [amountError, setAmountError] = useState('')
  const _buttonRefs = useRef({})
  // Clés d'idempotence stables par action utilisateur.
  // Format de la clé ref : `${draftId}-${actionType}-${method}-${amount}`
  // La clé est générée au moment du premier Confirmer et réutilisée pour les retries.
  // Elle est supprimée après succès confirmé ou recréée si le payload change.
  const pendingKeyRef = useRef({})


  const handleActionClick = useCallback((transactionId, actionType, event) => {
    if ([...processingActions].some(key => key.startsWith(`${transactionId}-`))) {
      return
    }

    if (actionType === 'modifier') {
      const transaction = pendingTransactions.find(t => t.id === transactionId)
      if (transaction) {
        startEditTransaction(transaction)
        // Remonte au formulaire, que l'on vient de garnir.
        //
        // C'est le SEUL mouvement de l'application qui échappe à `motion-safe:`
        // — il est déclenché en JavaScript, aucune media query ne l'atteint —
        // et c'est aussi le plus ample : la page entière défile. Exactement le
        // cas que `prefers-reduced-motion` existe pour arrêter (DESIGN.md §9).
        // Sans mouvement, on arrive au même endroit, tout de suite.
        window.scrollTo({
          top: 0,
          behavior: prefereMouvementReduit() ? 'auto' : 'smooth',
        })
      }
    } else if (actionType === 'payerPar' || actionType === 'rembourser' || actionType === 'encaisser') {
      if (activeDropdown === transactionId) {
        setActiveDropdown(null)
        setCurrentActionType(null)
        setDropdownStep(1)
        setSelectedMethod(null)
        setSettlementAmount('')
        setAmountError('')
        // Le code agent aussi : un code saisi puis abandonne sur la
        // transaction d'un client partirait sinon comme destination du
        // reglement du suivant, dans son historique et dans l'export.
        setCodeAgentReglement('')
      } else {
        const button = event.currentTarget
        const rect = button.getBoundingClientRect()
        const position = {
          top: rect.bottom + window.scrollY + 8,
          left: rect.left + window.scrollX - 50
        }
        setDropdownPosition(position)
        setActiveDropdown(transactionId)
        setCurrentActionType(actionType)
        setDropdownStep(1)
        setSelectedMethod(null)
        setSettlementAmount('')
        setAmountError('')
        // Le code agent aussi : un code saisi puis abandonne sur la
        // transaction d'un client partirait sinon comme destination du
        // reglement du suivant, dans son historique et dans l'export.
        setCodeAgentReglement('')
      }
    }
  }, [pendingTransactions, startEditTransaction, activeDropdown, setActiveDropdown, setCurrentActionType, setDropdownPosition, processingActions])

  const handlePaymentMethodSelect = useCallback(async (transactionId, method, actionType, amount, idempotencyKey, agentCode) => {
    const actionKey = `${transactionId}-${actionType}-${method}`
    if (processingActions.has(actionKey)) return

    setProcessingActions(prev => new Set(prev).add(actionKey))

    try {
      const transaction = pendingTransactions.find(t => t.id === transactionId)
      if (!transaction) return

      setActiveDropdown(null)
      setCurrentActionType(null)
      setDropdownStep(1)
      setSelectedMethod(null)
      setSettlementAmount('')
      setAmountError('')
      setCodeAgentReglement('')

      if (actionType === 'rembourser') {
        await addRefundTranche(transactionId, amount, method, idempotencyKey, agentCode)
      } else {
        await addPaymentTranche(transactionId, amount, method, idempotencyKey, agentCode)
      }

      // Succès : supprimer la clé (la prochaine action génèrera une nouvelle clé)
      const fingerprint = `${transactionId}-${actionType}-${method}-${amount}-${agentCode ?? ''}`
      delete pendingKeyRef.current[fingerprint]
    } catch (error) {
      logger.user.error('Settlement error', error)

      setRollbackToast({
        show: true,
        message: error?.message || 'Erreur de synchronisation — opération non enregistrée',
        type: 'rollback'
      })

      setTimeout(() => {
        setRollbackToast({ show: false, message: '', type: 'info' })
      }, 4000)
      // En cas d'erreur réseau incertaine, la clé est conservée dans pendingKeyRef
      // pour qu'un retry utilise exactement la même clé (idempotence client).
    } finally {
      setProcessingActions(prev => {
        const newSet = new Set(prev)
        newSet.delete(actionKey)
        return newSet
      })
    }
  }, [processingActions, pendingTransactions, addPaymentTranche, addRefundTranche, setActiveDropdown, setCurrentActionType])


  const handleMethodChosen = useCallback((method) => {
    const transaction = pendingTransactions.find(t => t.id === activeDropdown)
    const defaultAmount = transaction
      ? String(transaction.remainingAmount ?? transaction.montant)
      : ''
    setSelectedMethod(method)
    setSettlementAmount(defaultAmount)
    setAmountError('')
    setDropdownStep(2)
  }, [pendingTransactions, activeDropdown])

  const handleConfirmPayment = useCallback(async () => {
    const amount = parseInt(settlementAmount, 10)
    if (!amount || amount < 500) {
      setAmountError('Montant invalide (minimum 500 FCFA, entier)')
      return
    }
    const transaction = pendingTransactions.find(t => t.id === activeDropdown)

    // Validation du maximum selon le type d'action
    if (currentActionType !== 'rembourser') {
      // Paiement : max = remainingAmount (ou montant pour ancien draft)
      const maxPayment = transaction ? (transaction.remainingAmount ?? transaction.montant) : Infinity
      if (amount > maxPayment) {
        setAmountError(`Maximum : ${maxPayment.toLocaleString('fr-FR')} FCFA (reste dû)`)
        return
      }
    } else {
      // Remboursement : max = paidAmount - refundedAmount (net payé)
      if (transaction && transaction.paidAmount != null) {
        const netPaid = (transaction.paidAmount ?? 0) - (transaction.refundedAmount ?? 0)
        if (amount > netPaid) {
          setAmountError(`Maximum remboursable : ${netPaid.toLocaleString('fr-FR')} FCFA`)
          return
        }
        if (netPaid <= 0) {
          setAmountError('Aucun montant remboursable (net payé = 0)')
          return
        }
      }
    }

    // Clé d'idempotence stable : générée une fois par (draftId, actionType,
    // method, amount, codeAgent) et réutilisée pour les retries de CETTE action.
    //
    // ⚠ LE CODE AGENT EN FAIT PARTIE, et ce n'est pas optionnel. Sans lui,
    //   corriger un code mal tapé puis reconfirmer réutiliserait la même clé :
    //   le serveur reconnaîtrait un rejeu, renverrait le règlement déjà
    //   enregistré, et le code corrigé ne serait jamais écrit — en silence.
    const codeAgent = codeAgentReglement.trim()
    const fingerprint = `${activeDropdown}-${currentActionType}-${selectedMethod}-${amount}-${codeAgent}`
    if (!pendingKeyRef.current[fingerprint]) {
      pendingKeyRef.current[fingerprint] = generateIdempotencyKey()
    }
    const idempotencyKey = pendingKeyRef.current[fingerprint]

    await handlePaymentMethodSelect(activeDropdown, selectedMethod, currentActionType, amount, idempotencyKey, codeAgent || undefined)
  }, [settlementAmount, selectedMethod, activeDropdown, currentActionType, codeAgentReglement, pendingTransactions, handlePaymentMethodSelect])

  // Fermer le dropdown quand on clique ailleurs
  useEffect(() => {
    if (!activeDropdown) return
    
    const handleClickOutside = (event) => {
      // Ne pas fermer si on clique sur un bouton qui ouvre le dropdown
      if (event.target.closest('.dropdown-trigger')) return
      
      if (!event.target.closest('.dropdown-container')) {
        setActiveDropdown(null)
        setCurrentActionType(null)
        setDropdownStep(1)
        setSelectedMethod(null)
        setSettlementAmount('')
        setAmountError('')
        // Le code agent aussi : un code saisi puis abandonne sur la
        // transaction d'un client partirait sinon comme destination du
        // reglement du suivant, dans son historique et dans l'export.
        setCodeAgentReglement('')
      }
    }
    
    // Délai pour éviter la fermeture immédiate
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 100)
    
    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [activeDropdown])

  /**
   * L'en-tete d'un groupe : le client, le type, le TOTAL.
   *
   * Aucun bouton de reglement ici, et ce n'est pas un oubli : « Encaisser »
   * porte un montant et une methode, qui ne valent que pour UNE transaction.
   * Encaisser un groupe d'un seul geste voudrait dire choisir la meme methode
   * pour six operations que la caissiere n'a pas encore regardees.
   *
   * Le compteur d'attente, lui, montre la PLUS LONGUE du groupe : c'est elle
   * qui decide si la rangee doit s'allumer.
   */
  const renderEnteteGroupe = (groupe) => {
    const styles = getTransactionStyles(groupe.type)
    const ouvert = groupesDeplies.has(groupe.cle)
    const nombre = groupe.lignes.length
    const attentes = groupe.lignes.map((ligne) => attenteDe(ligne, maintenant)).filter(Boolean)
    const plusLongue = attentes.length
      ? attentes.reduce((pire, courante) => (courante.ms > pire.ms ? courante : pire))
      : null

    return (
      <tr
        key={`groupe-${groupe.cle}`}
        className={`border-b border-line/60 transition-colors hover:bg-brand-50/60 ${
          plusLongue?.enRetard ? 'bg-warn-soft' : 'bg-surface-2/60'
        }`}
        data-testid={`groupe-${groupe.cle}`}
      >
        <td className="relative px-4 pb-3 pt-7 text-base">
          {plusLongue && (
            <span
              className={`absolute left-3 top-1 z-10 inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11px] font-bold leading-none tabular-nums shadow-sm ${
                plusLongue.enRetard
                  ? 'border-warn bg-warn text-white'
                  : 'border-line bg-surface text-ink-muted'
              }`}
              data-testid={`attente-groupe-${groupe.cle}`}
            >
              {plusLongue.texte}
            </span>
          )}
          {formatTransactionDateTime(groupe.lignes[0])}
        </td>
        <td className="px-4 py-3 text-base font-semibold">
          {getClientName(groupe.client)}
        </td>
        <td className={`px-4 py-3 text-base font-medium ${styles.textColor}`}>
          {groupe.type}
          <span className="ml-1 text-xs font-normal text-ink-muted">× {nombre}</span>
        </td>
        <td className="px-4 py-3 text-base text-ink-muted">—</td>
        <td className={`px-4 py-3 text-right text-base font-bold tabular-nums ${styles.textColor}`}>
          {groupe.total.toLocaleString('fr-FR')} FCFA
        </td>
        <td className="px-4 py-3 text-base">
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => basculerGroupe(groupe.cle)}
              aria-expanded={ouvert}
              data-testid={`basculer-${groupe.cle}`}
              className="inline-flex items-center gap-1 rounded border border-line bg-surface px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <ChevronRight
                className={`h-3.5 w-3.5 transition-transform ${ouvert ? 'rotate-90' : ''}`}
                aria-hidden="true"
              />
              {ouvert ? 'Masquer' : `Voir les ${nombre}`}
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <div className="mt-8">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className={`text-xl font-bold ${themeClasses.text}`}>
          Non Terminées
        </h2>

        {/* Deux totaux, pas un tableau de bord.
            Ce qu'ils répondent tient en une question que la caissière se pose
            dix fois par jour : « combien reste-t-il à encaisser, combien à
            payer ? ». Volontairement petits et posés à côté du titre plutôt
            qu'en bandeau : ils informent sans prendre la place des lignes,
            qui sont ce qu'on vient lire.

            La couleur reprend celle des types dans le tableau — vert pour ce
            qui entre, rouge pour ce qui sort —, mais elle ne porte jamais le
            sens seule : chaque case est étiquetée.

            Le COMPTE coiffe son total. Il vivait dans un sous-titre qui
            récitait « 3 transactions non terminées · 2 dépôts, 1 retrait »,
            à l'autre bout de l'écran des montants qu'il dénombrait : il
            fallait lire une phrase pour apprendre ce qu'un chiffre posé au
            bon endroit dit d'un coup d'œil. */}
        <span className="inline-flex flex-col items-center gap-0.5" data-testid="case-depots-non-terminees">
          <span className="font-mono text-xs font-bold leading-none tabular-nums text-inflow" data-testid="nombre-depots-non-terminees">
            {totauxEnAttente.nbDepots}
          </span>
          <span
            className="inline-flex items-baseline gap-1.5 rounded-md border border-inflow/30 bg-inflow-soft px-2.5 py-1"
            data-testid="total-depots-non-terminees"
          >
            <span className="text-xs font-medium text-inflow">Dépôts</span>
            <span className="font-mono text-sm font-semibold tabular-nums text-inflow">
              {totauxEnAttente.depots.toLocaleString('fr-FR')}
            </span>
          </span>
        </span>

        <span className="inline-flex flex-col items-center gap-0.5" data-testid="case-retraits-non-terminees">
          <span className="font-mono text-xs font-bold leading-none tabular-nums text-danger" data-testid="nombre-retraits-non-terminees">
            {totauxEnAttente.nbRetraits}
          </span>
          <span
            className="inline-flex items-baseline gap-1.5 rounded-md border border-danger/30 bg-danger-soft px-2.5 py-1"
            data-testid="total-retraits-non-terminees"
          >
            <span className="text-xs font-medium text-danger">Retraits</span>
            <span className="font-mono text-sm font-semibold tabular-nums text-danger">
              {totauxEnAttente.retraits.toLocaleString('fr-FR')}
            </span>
          </span>
        </span>
      </div>

      <div className={`bg-white rounded-lg border ${themeClasses.tableBorder}`}>
        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full border-collapse">
            <thead>
              <tr className={`${themeClasses.tableHeader} border-b`}>
                <th className={`px-4 py-3 text-left text-base font-medium ${themeClasses.text}`}>
                  Date & heure
                </th>
                <th className={`px-4 py-3 text-left text-base font-medium ${themeClasses.text}`}>
                  Client
                </th>
                <th className={`px-4 py-3 text-left text-base font-medium ${themeClasses.text}`}>
                  Type
                </th>
                {/* Le réseau a quitté cette colonne : la boutique n'en opère
                    qu'un, et le répéter sur chaque ligne n'apprenait rien. Le
                    code agent, lui, sert à retrouver une transaction. */}
                <th className={`px-4 py-3 text-left text-base font-medium ${themeClasses.text}`}>
                  Code
                </th>
                <th className={`px-4 py-3 text-right text-base font-medium ${themeClasses.text}`}>
                  Montant
                </th>
                <th className={`px-4 py-3 text-center text-base font-medium ${themeClasses.text}`}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                // Afficher des squelettes pendant le chargement
                Array.from({ length: 3 }).map((_, index) => (
                  <SkeletonRow key={`skeleton-${index}`} cols={6} />
                ))
              ) : uniquePendingTransactions.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-4">
                    <EmptyState
                      icon={ClipboardCheck}
                      title="Aucune transaction en attente"
                      message="Les opérations enregistrées comme non terminées apparaîtront ici."
                    />
                  </td>
                </tr>
              ) : (
                lignesAffichees.map((item) => {
                  if (item.entete) return renderEnteteGroupe(item.entete)

                  const transaction = item.seule
                  const enfant = item.enfant === true
                  const actions = getActionButtons(transaction)
                  const styles = getTransactionStyles(transaction.type)
                  const isProcessingTransaction = [...processingActions].some(key => key.startsWith(`${transaction.id}-`))
                  const attente = attenteDe(transaction, maintenant)

                  return (
                    <tr
                      key={transaction.id}
                      // La teinte n'est pas décorative : passé une demi-heure,
                      // la ligne se signale d'elle-même au lieu d'attendre
                      // qu'on relise six horodatages pour trouver le plus vieux.
                      className={`border-b border-line/60 transition-colors hover:bg-brand-50/60 ${
                        attente?.enRetard ? 'bg-warn-soft' : ''
                      }`}
                      data-testid={enfant ? 'ligne-de-groupe' : undefined}
                    >
                      <td className={`relative px-4 pb-3 pt-7 text-base ${
                        enfant ? 'border-l-4 border-l-brand-300 pl-6' : ''
                      }`}>
                        {/* LE COMPTEUR EST UNE PASTILLE, PAS UNE COLONNE.
                            Il ne décrit pas la transaction — il décrit ce qui
                            lui arrive pendant qu'on la regarde. Une septième
                            colonne l'aurait rangé avec le montant et le code,
                            des valeurs figées ; posé en relief sur le bord de
                            la rangée, il se lit comme une étiquette collée
                            dessus, et c'est ce qu'il est. */}
                        {attente && (
                          <span
                            className={`absolute left-3 top-1 z-10 inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11px] font-bold leading-none tabular-nums shadow-sm ${
                              attente.enRetard
                                ? 'border-warn bg-warn text-white'
                                : 'border-line bg-surface text-ink-muted'
                            }`}
                            data-testid={`attente-${transaction.id}`}
                          >
                            {attente.texte}
                          </span>
                        )}
                        {formatTransactionDateTime(transaction)}
                      </td>
                      <td className="px-4 py-3 text-base font-medium">
                        {getClientName(transaction.client)}
                      </td>
                      <td className={`px-4 py-3 text-base font-medium ${styles.textColor}`}>
                        {transaction.type}
                      </td>
                      <td className="px-4 py-3 text-base">
                        {transaction.code || '-'}
                      </td>
                      <td className={`px-4 py-3 text-right text-base font-medium tabular-nums ${styles.textColor}`}>
                        <span>{(Number(transaction.montant) || 0).toLocaleString('fr-FR')} FCFA</span>
                        {transaction.settlementStatus === 'partial' && transaction.remainingAmount != null && (
                          <div className="mt-0.5 text-xs font-normal tabular-nums text-warn">
                            Reste : {Number(transaction.remainingAmount).toLocaleString('fr-FR')} FCFA
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-base">
                        <div className="flex gap-2 justify-center">
                          {actions.modifier && (
                            <button
                              onClick={(e) => handleActionClick(transaction.id, 'modifier', e)}
                              disabled={isProcessingTransaction}
                              className="rounded border border-line bg-surface px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                            >
                              Modifier
                            </button>
                          )}

                          {actions.encaisser && (
                            <button
                              onClick={(e) => handleActionClick(transaction.id, 'encaisser', e)}
                              disabled={isProcessingTransaction}
                              className="rounded border border-line bg-surface px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dropdown-trigger"
                            >
                              Encaisser
                            </button>
                          )}

                          {actions.payerPar && (
                            <button
                              onClick={(e) => handleActionClick(transaction.id, 'payerPar', e)}
                              disabled={isProcessingTransaction}
                              className="rounded border border-line bg-surface px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dropdown-trigger"
                            >
                              Payer par
                            </button>
                          )}

                          {actions.rembourser && (
                            <button
                              onClick={(e) => handleActionClick(transaction.id, 'rembourser', e)}
                              disabled={isProcessingTransaction}
                              className="rounded border border-line bg-surface px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dropdown-trigger"
                            >
                              Rembourser
                            </button>
                          )}

                          {/* « Annuler » ferme la rangée, après les gestes
                              qui font avancer la transaction : la défaire
                              n'est pas une étape du flux normal. */}
                          <button
                            type="button"
                            onClick={() => setASupprimer(transaction)}
                            disabled={isProcessingTransaction}
                            data-testid="supprimer-non-terminee"
                            className="rounded border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-muted transition-colors hover:border-danger hover:text-danger disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                          >
                            Annuler
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>


      {/* Dropdown modal — 2 étapes */}
      {activeDropdown && createPortal(
        <div
          className="fixed bg-white border border-gray-300 rounded-lg shadow-lg dropdown-container"
          onClick={(e) => e.stopPropagation()}
          style={{
            top: Math.max(10, Math.min(dropdownPosition.top, window.innerHeight - 300)),
            left: Math.max(10, Math.min(dropdownPosition.left, window.innerWidth - 240)),
            zIndex: 9999,
            minWidth: '220px'
          }}
        >
          {dropdownStep === 1 ? (
            <>
              {/* Étape 1 : sélection de la méthode */}
              <div className="bg-gray-100 px-4 py-2 rounded-t-lg border-b border-gray-200">
                <p className="text-sm font-medium text-gray-700">Sélectionner méthode</p>
              </div>
              <div className="py-1">
                {PAYMENT_METHODS.map((method) => (
                  <button
                    key={method}
                    onClick={() => handleMethodChosen(method)}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    {method}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              {/* Étape 2 : saisie du montant */}
              {(() => {
                const t = pendingTransactions.find(tx => tx.id === activeDropdown)
                return (
                  <>
                    <div className="bg-gray-100 px-4 py-2 rounded-t-lg border-b border-gray-200 flex items-center gap-2">
                      <button
                        onClick={() => { setDropdownStep(1); setAmountError('') }}
                        className="rounded text-ink-muted transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                        aria-label="Retour"
                      >
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <p className="text-sm font-medium text-gray-700">{selectedMethod}</p>
                    </div>
                    {t && (
                      <div className="px-4 pt-2 pb-1 border-b border-gray-100 space-y-0.5">
                        <p className="text-xs text-gray-700 font-medium truncate">{getClientName(t.client)}</p>
                        <p className="text-[11px] text-gray-400">{t.type}{t.reseau ? ` · ${t.reseau}` : ''}</p>
                        {/* Résumé financier */}
                        <div className="pt-1 space-y-0.5">
                          <p className="text-[11px] text-gray-500">
                            Total : {(Number(t.montant) || 0).toLocaleString('fr-FR')} FCFA
                          </p>
                          {t.settlementStatus === 'partial' && t.paidAmount != null && (
                            <>
                              <p className="text-[11px] tabular-nums text-inflow">
                                Payé : {Number(t.paidAmount).toLocaleString('fr-FR')} FCFA
                              </p>
                              {(t.refundedAmount ?? 0) > 0 && (
                                <p className="text-[11px] tabular-nums text-outflow">
                                  Remboursé : {Number(t.refundedAmount).toLocaleString('fr-FR')} FCFA
                                </p>
                              )}
                              {currentActionType !== 'rembourser' ? (
                                <p className="text-[11px] font-medium tabular-nums text-warn">
                                  Reste dû : {Number(t.remainingAmount).toLocaleString('fr-FR')} FCFA
                                </p>
                              ) : (
                                <p className="text-[11px] font-medium tabular-nums text-inflow">
                                  Remboursable : {Math.max(0, (t.paidAmount ?? 0) - (t.refundedAmount ?? 0)).toLocaleString('fr-FR')} FCFA
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}

              <div className="px-4 py-3">
                <p className="text-xs text-gray-500 mb-2">Montant (FCFA)</p>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const current = parseInt(settlementAmount, 10) || 0
                      const next = Math.max(500, current - 500)
                      setSettlementAmount(String(next))
                      setAmountError('')
                    }}
                    className="w-9 h-9 flex items-center justify-center rounded border border-gray-300 text-gray-700 hover:bg-gray-100 text-lg font-bold select-none"
                  >
                    −
                  </button>

                  <input
                    type="number"
                    min="500"
                    step="500"
                    value={settlementAmount}
                    onChange={(e) => {
                      setSettlementAmount(e.target.value)
                      setAmountError('')
                    }}
                    className="min-w-0 flex-1 rounded border border-line px-2 py-1 text-center text-sm tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  />

                  <button
                    onClick={() => {
                      const current = parseInt(settlementAmount, 10) || 0
                      setSettlementAmount(String(current + 500))
                      setAmountError('')
                    }}
                    className="w-9 h-9 flex items-center justify-center rounded border border-gray-300 text-gray-700 hover:bg-gray-100 text-lg font-bold select-none"
                  >
                    +
                  </button>
                </div>

                {amountError && (
                  <p className="mt-1 text-xs text-danger">{amountError}</p>
                )}

                {/* FACULTATIF, ET DIT COMME TEL. Ce champ ne sert que lorsque
                    l'argent part sur un compte agent au lieu d'être remis en
                    main propre ; l'immense majorité des règlements le laissent
                    vide, et rien ne doit donner l'impression qu'il bloque. */}
                <label htmlFor="reglement-code-agent" className="mt-3 block text-xs text-gray-500">
                  Envoyé sur le code agent <span className="text-gray-400">(facultatif)</span>
                </label>
                <input
                  id="reglement-code-agent"
                  type="text"
                  value={codeAgentReglement}
                  maxLength={32}
                  placeholder="Laisser vide si remis en espèces"
                  onChange={(e) => setCodeAgentReglement(e.target.value)}
                  data-testid="reglement-code-agent"
                  className="mt-1 w-full rounded border border-line px-2 py-1 text-sm tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                />

                <button
                  onClick={handleConfirmPayment}
                  disabled={[...processingActions].some(k => k.startsWith(`${activeDropdown}-`))}
                  className="mt-3 w-full rounded bg-brand-500 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:bg-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  {[...processingActions].some(k => k.startsWith(`${activeDropdown}-`)) ? 'Traitement...' : 'Confirmer'}
                </button>
              </div>
            </>
          )}
        </div>,
        document.body
      )}

      {/* Toast pour les rollbacks */}
      <OptimisticToast
        message={rollbackToast.message}
        type={rollbackToast.type}
        isVisible={rollbackToast.show}
        onClose={() => setRollbackToast({ show: false, message: '', type: 'info' })}
        autoClose={true}
      />

      <Dialog
        open={Boolean(aSupprimer)}
        onClose={() => setASupprimer(null)}
        title="Annuler cette transaction ?"
        testId="confirmer-suppression-non-terminee"
        footer={(
          <div className="flex justify-end gap-3">
            {/* « Garder », et non « Fermer » ni « Annuler » : la croix du dialogue
                porte déjà « Fermer », et « Annuler » est maintenant le nom du
                geste qui AGIT. Un bouton se nomme par ce qu'il fait — celui-ci
                garde la ligne. */}
            <button
              type="button"
              onClick={() => setASupprimer(null)}
              className="rounded border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              Garder
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!aSupprimer) return
                setSuppressionEnCours(true)
                try {
                  await trashTransaction(aSupprimer.id)
                  setASupprimer(null)
                } catch (error) {
                  // On garde le modal ouvert : disparaître sans rien dire
                  // laisserait croire que l'annulation a eu lieu.
                  setRollbackToast({ show: true, message: error?.message || 'Annulation impossible', type: 'error' })
                } finally {
                  setSuppressionEnCours(false)
                }
              }}
              disabled={suppressionEnCours}
              data-testid="confirmer-supprimer-non-terminee"
              className="rounded bg-danger px-4 py-2 text-sm font-semibold text-white transition-colors hover:brightness-110 disabled:cursor-wait disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              {suppressionEnCours ? 'Annulation…' : 'Annuler la transaction'}
            </button>
          </div>
        )}
      >
        {aSupprimer && (
          <div className="space-y-3 text-sm text-ink">
            <p>
              <span className="font-medium">{getClientName(aSupprimer.client)}</span>
              {' · '}{aSupprimer.type}
              {' · '}
              <span className="font-mono tabular-nums">
                {(Number(aSupprimer.montant) || 0).toLocaleString('fr-FR')} FCFA
              </span>
            </p>
            <p className="text-ink-muted">
              Le stock engagé sera rendu et la ligne ira dans la corbeille, où
              elle restera lisible. Elle ne pourra pas être restaurée.
            </p>
          </div>
        )}
      </Dialog>
    </div>
  )
})

export default TransactionTable
