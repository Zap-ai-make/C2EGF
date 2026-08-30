import { useState, useEffect, useCallback } from 'react'
import {
  subscribeOutgoingCollaborations,
  subscribeIncomingCollaborations,
  listStoreCollaborationProviders,
  createStoreCollaboration,
  confirmStoreCollaboration,
  rejectStoreCollaboration,
} from '../../services/collaborationService'
import { parseAmount } from '../../utils/parseAmount'
import {
  COLLAB_OPERATION_TYPE_LABELS,
  COLLAB_STATUS_LABELS,
} from '../../constants/collaborationConstants'
import { formatCurrency } from '../../utils/formatCurrency'
import { formatFirestoreDate } from '../../utils/formatFirestoreDate'
import StatusBadge from '../ui/StatusBadge'
import Dialog from '../ui/Dialog'

/**
 * Collaborations — le troisième mode de l'écran Transactions.
 *
 * POURQUOI ICI, ET PAS DANS SON PROPRE ÉCRAN
 * ──────────────────────────────────────────
 * Une collaboration est un ÉVÉNEMENT — « j'ai fait une opération pour une
 * consœur », ou « je demande qu'on la fasse pour moi ». Elle vit donc là où
 * l'on saisit les opérations. La DETTE qui en naît, elle, est un état permanent
 * qu'on surveille : c'est pour ça qu'elle a sa propre destination.
 *
 * LE MÊME AXE QUE LE FLÉAU
 * ────────────────────────
 * « Mes demandes » à gauche, « Reçues » à droite, séparées par le même filet et
 * teintées des mêmes couleurs : à gauche ce qui me fera devoir, à droite ce qui
 * me fera être due. Ce n'est pas un rappel décoratif — un gérant qui a compris
 * la page des dettes lit celle-ci sans rien réapprendre.
 *
 * LE STATUT EST DANS LA REQUÊTE
 * ─────────────────────────────
 * Jamais de filtrage après coup : `limit()` s'exécute côté serveur AVANT tout
 * filtrage client, et filtrer ensuite ferait disparaître des lignes qui n'ont
 * jamais été chargées. Le service porte ce contrat ; ce composant se contente
 * de ne pas le contourner.
 */

/**
 * ⚠ Les classes de teinte sont ÉCRITES EN ENTIER, jamais composées.
 *   Tailwind lit les sources en texte : `border-${teinte}` ne produit aucune
 *   règle, et l'onglet actif serait sans couleur en production alors qu'il
 *   passerait tous les tests — jsdom ne charge pas la feuille de style. Le
 *   dépôt met déjà en garde contre ce piège dans `StatCard`.
 */
const SOUS_ONGLETS = [
  { cle: 'outgoing', libelle: 'Mes demandes', actif: 'border-outflow text-outflow' },
  { cle: 'incoming', libelle: 'Reçues', actif: 'border-inflow text-inflow' },
]

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

function LigneCollaboration({ collab, sens, onConfirmer, onRejeter }) {
  const enAttente = collab.status === 'pending'
  const autreBoutique = sens === 'outgoing'
    ? (collab.supplierStoreName ?? collab.supplierStoreId)
    : (collab.requestingStoreName ?? collab.requestingStoreId)

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3 last:border-b-0">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="truncate text-sm font-medium text-ink">{autreBoutique}</span>
        <span className="text-sm text-ink-muted">
          {COLLAB_OPERATION_TYPE_LABELS[collab.operationType] ?? collab.operationType}
        </span>
        <span className="text-sm font-semibold tabular-nums text-ink">
          {formatCurrency(collab.amount)}
        </span>
        <span className="text-xs text-ink-muted">{formatFirestoreDate(collab.createdAt)}</span>
      </span>

      <span className="flex items-center gap-2">
        <StatusBadge
          status={collab.status === 'confirmed' ? 'confirmed' : collab.status === 'rejected' ? 'rejected' : 'pending'}
          label={COLLAB_STATUS_LABELS[collab.status] ?? collab.status}
        />
        {/* On n'exécute que ce qu'on nous demande : le sens décide, pas le statut
            seul. Une demande que J'AI émise n'est pas la mienne à confirmer. */}
        {enAttente && sens === 'incoming' && (
          <>
            <Bouton variante="primaire" onClick={() => onConfirmer(collab)}>Exécuter</Bouton>
            <Bouton variante="danger" onClick={() => onRejeter(collab)}>Refuser</Bouton>
          </>
        )}
      </span>
    </li>
  )
}

function CollaborationsPanel({ storeId, sousOnglet = 'outgoing', onChangeSousOnglet, compteurRecues = 0 }) {
  const [lignes, setLignes] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [dialogue, setDialogue] = useState(null)
  const [fournisseurs, setFournisseurs] = useState([])

  const [clientId, setClientId] = useState('')
  const [operationType, setOperationType] = useState('deposit')
  const [montant, setMontant] = useState('')
  const [supplierStoreId, setSupplierStoreId] = useState('')
  const [motif, setMotif] = useState('')
  const [erreurDialogue, setErreurDialogue] = useState(null)
  const [envoi, setEnvoi] = useState(false)

  useEffect(() => {
    setLignes(null)
    setErreur(null)
    if (!storeId) return undefined
    const abonner = sousOnglet === 'incoming'
      ? subscribeIncomingCollaborations
      : subscribeOutgoingCollaborations
    return abonner({
      storeId,
      onUpdate: (rows) => { setLignes(rows); setErreur(null) },
      onError: setErreur,
    })
  }, [storeId, sousOnglet])

  const fermer = useCallback(() => {
    setDialogue(null)
    setClientId('')
    setMontant('')
    setMotif('')
    setErreurDialogue(null)
    setEnvoi(false)
  }, [])

  const envoyer = useCallback(async (action) => {
    setEnvoi(true)
    setErreurDialogue(null)
    try {
      await action()
      fermer()
    } catch (err) {
      setErreurDialogue(err?.message ?? 'L’opération n’a pas abouti.')
      setEnvoi(false)
    }
  }, [fermer])

  /**
   * L'annuaire passe par un CALLABLE et non par une lecture Firestore : les
   * règles interdisent à une boutique de lire le document d'une autre. Il est
   * chargé à l'ouverture du dialogue, pas au montage — une liste de boutiques
   * n'a pas à être demandée à qui vient seulement consulter ses demandes.
   */
  const ouvrirCreation = useCallback(async () => {
    setErreurDialogue(null)
    setClientId('')
    setMontant('')
    setDialogue({ type: 'creation' })
    try {
      const liste = await listStoreCollaborationProviders()
      setFournisseurs(liste)
      setSupplierStoreId(liste[0]?.storeId ?? '')
    } catch (err) {
      setErreurDialogue(err?.message ?? 'La liste des boutiques n’a pas pu être chargée.')
    }
  }, [])

  const montantValide = parseAmount(montant) !== null
  const motifValide = motif.trim().length >= 3 && motif.trim().length <= 500
  const creationValide = montantValide && clientId.trim() !== '' && supplierStoreId !== ''

  const soumettre = () => {
    if (dialogue?.type === 'creation') {
      envoyer(() => createStoreCollaboration({
        clientId: clientId.trim(),
        operationType,
        amount: montant,
        supplierStoreId,
      }))
    } else if (dialogue?.type === 'confirmation') {
      envoyer(() => confirmStoreCollaboration({ collaborationId: dialogue.collab.id }))
    } else if (dialogue?.type === 'refus') {
      envoyer(() => rejectStoreCollaboration({
        collaborationId: dialogue.collab.id,
        rejectionReason: motif,
      }))
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* Le même axe que le fléau : à gauche ce qui me fera devoir, à droite
            ce qui me fera être due. Le filet est le même repère. */}
        <div className="flex items-stretch" role="tablist" aria-label="Sens des collaborations">
          {SOUS_ONGLETS.map((onglet, index) => (
            <div key={onglet.cle} className="flex items-stretch">
              {index > 0 && <span className="mx-1 w-px self-stretch bg-line" aria-hidden="true" />}
              <button
                type="button"
                role="tab"
                aria-selected={sousOnglet === onglet.cle}
                onClick={() => onChangeSousOnglet?.(onglet.cle)}
                data-testid={`sous-onglet-${onglet.cle}`}
                className={`inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                  sousOnglet === onglet.cle
                    ? onglet.actif
                    : 'border-transparent text-ink-muted hover:text-ink'
                }`}
              >
                {onglet.libelle}
                {onglet.cle === 'incoming' && compteurRecues > 0 && (
                  <span
                    className="inline-flex min-w-[1.2rem] items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                    aria-label={`${compteurRecues} collaboration${compteurRecues > 1 ? 's' : ''} reçue${compteurRecues > 1 ? 's' : ''} en attente`}
                    data-testid="badge-recues"
                  >
                    {compteurRecues > 99 ? '99+' : compteurRecues}
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>

        <Bouton variante="primaire" onClick={ouvrirCreation} data-testid="ouvrir-creation">
          Demander à une consœur
        </Bouton>
      </div>

      {erreur && (
        <p
          className="mb-3 rounded-lg border border-warn/40 bg-warn-soft px-4 py-2 text-sm text-warn"
          role={erreur.permanent ? 'alert' : 'status'}
        >
          {erreur.message}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        {lignes === null ? (
          <ul aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="border-b border-line px-4 py-4 last:border-b-0">
                <span className="block h-4 w-2/3 rounded bg-gray-200 motion-safe:animate-pulse" />
              </li>
            ))}
          </ul>
        ) : lignes.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-base font-medium text-ink">
              {sousOnglet === 'incoming'
                ? 'Aucune demande reçue'
                : 'Aucune demande envoyée'}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
              {sousOnglet === 'incoming'
                ? 'Quand une consœur vous demandera d’exécuter une opération, elle apparaîtra ici.'
                : 'À court de stock ? Demandez à une consœur d’exécuter l’opération à votre place.'}
            </p>
          </div>
        ) : (
          <ul aria-label={sousOnglet === 'incoming' ? 'Demandes reçues' : 'Mes demandes'}>
            {lignes.map((collab) => (
              <LigneCollaboration
                key={collab.id}
                collab={collab}
                sens={sousOnglet}
                onConfirmer={(c) => { setMotif(''); setErreurDialogue(null); setDialogue({ type: 'confirmation', collab: c }) }}
                onRejeter={(c) => { setMotif(''); setErreurDialogue(null); setDialogue({ type: 'refus', collab: c }) }}
              />
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={dialogue?.type === 'creation'}
        onClose={fermer}
        testId="dialogue-creation"
        title="Demander à une consœur"
        description="Elle exécutera l’opération sur son stock ; vous lui devrez le montant."
        footer={
          <>
            <Bouton onClick={fermer}>Annuler</Bouton>
            <Bouton variante="primaire" disabled={!creationValide || envoi} onClick={soumettre}>
              {envoi ? 'Envoi…' : 'Envoyer la demande'}
            </Bouton>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Client</span>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Opération</span>
            <select
              value={operationType}
              onChange={(e) => setOperationType(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              {Object.entries(COLLAB_OPERATION_TYPE_LABELS).map(([valeur, libelle]) => (
                <option key={valeur} value={valeur}>{libelle}</option>
              ))}
            </select>
          </label>

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

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Boutique</span>
            <select
              value={supplierStoreId}
              onChange={(e) => setSupplierStoreId(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              {fournisseurs.map((f) => (
                <option key={f.storeId} value={f.storeId}>{f.storeName ?? f.storeId}</option>
              ))}
            </select>
          </label>

          {montant !== '' && !montantValide && (
            <p className="text-sm text-danger">Entrez un montant entier, supérieur à zéro.</p>
          )}
          {erreurDialogue && <p className="text-sm text-danger" role="alert">{erreurDialogue}</p>}
        </div>
      </Dialog>

      <Dialog
        open={dialogue?.type === 'confirmation'}
        onClose={fermer}
        testId="dialogue-execution"
        title="Exécuter cette opération"
        description={`${formatCurrency(dialogue?.collab?.amount)} · ${COLLAB_OPERATION_TYPE_LABELS[dialogue?.collab?.operationType] ?? ''}`}
        footer={
          <>
            <Bouton onClick={fermer}>Annuler</Bouton>
            <Bouton variante="primaire" disabled={envoi} onClick={soumettre}>
              {envoi ? 'Envoi…' : 'Exécuter'}
            </Bouton>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          Votre stock sera débité ou crédité en conséquence, et une dette naîtra entre
          vos deux boutiques. C’est définitif.
        </p>
        {erreurDialogue && <p className="mt-2 text-sm text-danger" role="alert">{erreurDialogue}</p>}
      </Dialog>

      <Dialog
        open={dialogue?.type === 'refus'}
        onClose={fermer}
        testId="dialogue-refus"
        title="Refuser cette demande"
        description={formatCurrency(dialogue?.collab?.amount)}
        footer={
          <>
            <Bouton onClick={fermer}>Annuler</Bouton>
            <Bouton variante="danger" disabled={!motifValide || envoi} onClick={soumettre}>
              {envoi ? 'Envoi…' : 'Refuser'}
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
        <p className="mt-1 text-xs text-ink-muted">La boutique demandeuse lira ce motif.</p>
        {erreurDialogue && <p className="mt-2 text-sm text-danger" role="alert">{erreurDialogue}</p>}
      </Dialog>
    </div>
  )
}

export default CollaborationsPanel
