import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
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

/**
 * Plafond de lignes RENDUES, pas de lignes cherchables : le filtre porte
 * toujours sur l'annuaire entier. Il n'existe que pour ne pas poser mille
 * nœuds dans le DOM d'une modale.
 */
const RESULTATS_MAX = 50

/** Accents ignorés : on tape « ouedraogo » pour trouver « Ouédraogo ». */
const normaliser = (valeur) => String(valeur ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()

/** Ce que le gérant reconnaît. Jamais l'identifiant technique. */
const nomClient = (c) => [c?.nom, c?.prenom].filter(Boolean).join(' ').trim()

/** La ligne qui départage deux homonymes — et il y en a. */
const detailClient = (c) => [
  c?.orange ? `Code agent ${c.orange}` : null,
  c?.numeroPersonnel ? `Tél. ${c.numeroPersonnel}` : null,
].filter(Boolean).join(' · ')

/**
 * Le client d'une collaboration se CHOISIT ; il ne se tape pas.
 *
 * CE QUI NE MARCHAIT PAS
 * ──────────────────────
 * Le champ était un texte libre, et le serveur y attend l'identifiant du
 * document `globalClients` — une donnée qu'aucun écran n'affiche jamais.
 * Toute demande partait donc vers `CLIENT_NOT_FOUND`.
 *
 * LA LISTE NE S'OUVRE QUE QUAND ON LA DEMANDE
 * ───────────────────────────────────────────
 * Au repos, le champ est un champ : rien en dessous. C'est le geste — clic,
 * frappe, flèche — qui déroule l'annuaire.
 *
 * ⚠ La première mise au point ne compte PAS comme ce geste. `Dialog` place le
 *   focus dans le corps à l'ouverture, donc sur ce champ : sans le garde
 *   `pretAOuvrir`, la modale s'ouvrirait déjà déroulée, et le formulaire
 *   apparaîtrait enseveli sous une liste que personne n'a réclamée.
 */
function ChoixClient({ clients, choisi, onChoisir }) {
  const [recherche, setRecherche] = useState('')
  const [ouvert, setOuvert] = useState(false)
  const [surligne, setSurligne] = useState(0)
  const champ = useRef(null)
  const pretAOuvrir = useRef(false)
  const avaitChoisi = useRef(false)

  const resultats = useMemo(() => {
    const source = clients ?? []
    const terme = normaliser(recherche.trim())
    if (!terme) return source.slice(0, RESULTATS_MAX)
    return source
      .filter((c) => [c?.nom, c?.prenom, c?.orange, c?.numeroPersonnel]
        .some((valeur) => normaliser(valeur).includes(terme)))
      .slice(0, RESULTATS_MAX)
  }, [clients, recherche])

  // Le focus programmatique de `Dialog` arrive avant que ce minuteur ne rende
  // la main : il traverse sans ouvrir. Tout focus ultérieur est un vrai geste.
  useEffect(() => {
    const t = setTimeout(() => { pretAOuvrir.current = true }, 0)
    return () => clearTimeout(t)
  }, [])

  // Une frappe change la liste : le surlignage revient en tête, sinon Entrée
  // validerait la ligne d'une liste qui n'existe plus.
  useEffect(() => { setSurligne(0) }, [recherche])

  // « Changer » rend la main au champ. Sans ça le focus tombe sur le corps du
  // document et le parcours au clavier est perdu au milieu du formulaire.
  useEffect(() => {
    if (avaitChoisi.current && !choisi) champ.current?.focus()
    avaitChoisi.current = Boolean(choisi)
  }, [choisi])

  const choisir = (c) => {
    onChoisir(c)
    setRecherche('')
    setOuvert(false)
  }

  const auClavier = (e) => {
    if (e.key === 'Escape' && ouvert) {
      // Échap referme la liste AVANT d'atteindre le dialogue : sinon un Échap
      // destiné au menu emporterait tout le formulaire.
      e.stopPropagation()
      setOuvert(false)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!ouvert) { setOuvert(true); return }
      if (resultats.length === 0) return
      const pas = e.key === 'ArrowDown' ? 1 : -1
      setSurligne((i) => (i + pas + resultats.length) % resultats.length)
      return
    }
    if (e.key === 'Enter' && ouvert && resultats.length > 0) {
      e.preventDefault()
      choisir(resultats[surligne])
    }
  }

  if (choisi) {
    return (
      <div>
        <span className="mb-1 block text-sm font-medium text-ink">Client</span>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-brand-50 px-3 py-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink" data-testid="client-choisi">
              {nomClient(choisi) || choisi.id}
            </span>
            {detailClient(choisi) && (
              <span className="block truncate text-xs text-ink-muted">{detailClient(choisi)}</span>
            )}
          </span>
          <Bouton onClick={() => onChoisir(null)} data-testid="changer-client">Changer</Bouton>
        </div>
      </div>
    )
  }

  const total = (clients ?? []).length
  const tronque = resultats.length === RESULTATS_MAX

  return (
    /* ⚠ La liste est POSÉE DANS LE FLUX, jamais en `absolute`.
       Le flottement a été essayé : plus élégant, il pousse le formulaire au
       lieu de le décaler. Mais le panneau de `Dialog` est en `overflow-y-auto`,
       et un élément absolu n'ajoute rien à la hauteur de contenu de son
       parent — le menu est donc coupé au bord de la modale, sans aucun scroll
       pour aller chercher le reste. Perdre les dernières lignes de l'annuaire
       coûte plus cher que le décalage. */
    <div>
      <label htmlFor="collab-client" className="mb-1 block text-sm font-medium text-ink">
        Client
      </label>
      <input
        id="collab-client"
        ref={champ}
        type="text"
        role="combobox"
        aria-expanded={ouvert}
        aria-controls="collab-client-liste"
        aria-autocomplete="list"
        aria-activedescendant={ouvert && resultats.length > 0 ? `collab-client-option-${surligne}` : undefined}
        autoComplete="off"
        placeholder="Rechercher un client…"
        value={recherche}
        onChange={(e) => { setRecherche(e.target.value); setOuvert(true) }}
        onClick={() => setOuvert(true)}
        onFocus={() => { if (pretAOuvrir.current) setOuvert(true) }}
        // Le délai laisse passer le `mousedown` d'une ligne : sans lui, le
        // démontage du menu précède le clic et le choix se perd.
        onBlur={() => setTimeout(() => setOuvert(false), 150)}
        onKeyDown={auClavier}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      />

      {ouvert && (
        total === 0 ? (
          <p
            className="mt-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-muted"
            data-testid="clients-vides"
          >
            Aucun client enregistré. Enregistrez-le d’abord dans « Clients ».
          </p>
        ) : resultats.length === 0 ? (
          <p
            className="mt-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-muted"
            data-testid="clients-sans-resultat"
          >
            Aucun client ne correspond à « {recherche.trim()} ».
          </p>
        ) : (
          <div className="mt-1 overflow-hidden rounded-lg border border-line bg-surface">
            <ul
              id="collab-client-liste"
              role="listbox"
              aria-label="Clients"
              className="max-h-52 overflow-y-auto"
            >
              {resultats.map((c, index) => (
                <li
                  key={c.id}
                  id={`collab-client-option-${index}`}
                  role="option"
                  aria-selected={index === surligne}
                  onMouseDown={(e) => { e.preventDefault(); choisir(c) }}
                  onMouseEnter={() => setSurligne(index)}
                  className={`cursor-pointer border-b border-line px-3 py-2 last:border-b-0 ${
                    index === surligne ? 'bg-brand-50' : 'bg-surface'
                  }`}
                >
                  <span className="block truncate text-sm text-ink">{nomClient(c) || c.id}</span>
                  {detailClient(c) && (
                    <span className="block truncate text-xs text-ink-muted">{detailClient(c)}</span>
                  )}
                </li>
              ))}
            </ul>
            {tronque && (
              <p className="border-t border-line px-3 py-1.5 text-xs text-ink-muted" role="status">
                {RESULTATS_MAX} premiers sur {total} — affinez la recherche.
              </p>
            )}
          </div>
        )
      )}
    </div>
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

function CollaborationsPanel({
  storeId, clients = [], sousOnglet = 'outgoing', onChangeSousOnglet, compteurRecues = 0,
}) {
  const [lignes, setLignes] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [dialogue, setDialogue] = useState(null)
  // `null` = pas encore répondu. Distinct de `[]`, qui dit « personne ne peut
  // servir » — deux états qui ne se racontent pas avec la même phrase.
  const [fournisseurs, setFournisseurs] = useState(null)

  const [client, setClient] = useState(null)
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
    setClient(null)
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

  const ouvrirCreation = useCallback(() => {
    setErreurDialogue(null)
    setClient(null)
    setMontant('')
    setFournisseurs(null)
    setSupplierStoreId('')
    setDialogue({ type: 'creation' })
  }, [])

  /**
   * L'annuaire des consœurs sollicitables.
   *
   * POURQUOI UN CALLABLE
   * ────────────────────
   * Les règles interdisent à une boutique de lire le document d'une autre. Le
   * SDK Admin, lui, passe outre : c'est le seul chemin. Il n'est demandé qu'à
   * l'ouverture du dialogue — une liste de boutiques n'a pas à être réclamée à
   * qui vient seulement consulter ses demandes.
   *
   * POURQUOI IL SE RECHARGE
   * ───────────────────────
   * La liste DÉPEND désormais de l'opération et du montant : seules les
   * boutiques qui disposent de la ressource demandée y figurent — le stock sur
   * un dépôt, la liquidité sur un retrait. Changer l'un ou l'autre change donc
   * les réponses possibles, et une liste figée à l'ouverture proposerait des
   * consœurs incapables de servir.
   *
   * ⚠ Le délai n'est pas du confort : sans lui, chaque chiffre tapé dans le
   *   montant déclencherait un appel de fonction. On attend que la frappe se
   *   pose. Le drapeau `vivant` empêche une réponse tardive d'écraser une plus
   *   récente — la course est réelle dès qu'on annule et relance.
   */
  useEffect(() => {
    if (dialogue?.type !== 'creation') return undefined
    let vivant = true
    const minuteur = setTimeout(async () => {
      try {
        const liste = await listStoreCollaborationProviders({ operationType, amount: montant })
        if (!vivant) return
        setFournisseurs(liste)
        // On ne conserve la boutique choisie que si elle peut ENCORE servir.
        setSupplierStoreId((actuel) => (
          liste.some((f) => f.storeId === actuel) ? actuel : (liste[0]?.storeId ?? '')
        ))
      } catch (err) {
        if (!vivant) return
        setFournisseurs([])
        setErreurDialogue(err?.message ?? 'La liste des boutiques n’a pas pu être chargée.')
      }
    }, 300)
    return () => { vivant = false; clearTimeout(minuteur) }
  }, [dialogue?.type, operationType, montant])

  const montantValide = parseAmount(montant) !== null
  const motifValide = motif.trim().length >= 3 && motif.trim().length <= 500
  const creationValide = montantValide && client !== null && supplierStoreId !== ''
    && (fournisseurs ?? []).some((f) => f.storeId === supplierStoreId)

  const soumettre = () => {
    if (dialogue?.type === 'creation') {
      envoyer(() => createStoreCollaboration({
        clientId: client.id,
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
          <ChoixClient clients={clients} choisi={client} onChoisir={setClient} />

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

          {/* La liste ne contient que les consœurs capables de servir CE montant
              dans CE sens — stock sur un dépôt, liquidité sur un retrait. Elle
              se recharge donc quand l'un ou l'autre change. */}
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Boutique</span>
            <select
              value={supplierStoreId}
              onChange={(e) => setSupplierStoreId(e.target.value)}
              disabled={!fournisseurs || fournisseurs.length === 0}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {(fournisseurs ?? []).map((f) => (
                <option key={f.storeId} value={f.storeId}>{f.storeName ?? f.storeId}</option>
              ))}
            </select>
          </label>

          {/* Trois états, trois phrases. « Aucune » n'est pas « pas encore ». */}
          {fournisseurs === null ? (
            <p className="text-sm text-ink-muted" data-testid="annuaire-en-cours">
              Recherche des boutiques qui peuvent servir…
            </p>
          ) : fournisseurs.length === 0 && !erreurDialogue ? (
            <p className="text-sm text-warn" data-testid="annuaire-vide">
              {montantValide
                ? `Aucune consœur ne dispose de ${
                  operationType === 'deposit' ? 'ce stock' : 'cette liquidité'} pour le moment.`
                : 'Aucune consœur active à solliciter.'}
            </p>
          ) : null}

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
