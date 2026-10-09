import { useCallback, useMemo, useState } from 'react'
import { useTransactions } from '../../context/transactions.jsx'
import { useTheme } from '../../context/ThemeContext.jsx'
import { getClientName, formatTransactionDateTime } from '../../utils/helpers.js'
import { useWindowedRows } from '../../hooks/useWindowedRows.js'
import EmptyState from '../ui/EmptyState.jsx'
import { History } from 'lucide-react'
import StatusBadge from '../ui/StatusBadge.jsx'
import Dialog from '../ui/Dialog.jsx'
import ModificationsDialog from './ModificationsDialog.jsx'
import { STORE_HISTORY_CONFIG } from '../../constants/storeWorkspace.js'
import { TYPE_RAVITAILLEMENT, TYPE_RETOUR } from '../../utils/ravitaillement.js'
import { regrouperParClientEtType } from '../../utils/regroupement.js'
import { dureeDe, formaterHeure } from '../../utils/attente.js'
import { ChevronRight } from 'lucide-react'

/**
 * LES DEUX LIGNES QUI NE VIENNENT PAS D'UN CLIENT.
 *
 * Un ravitaillement et un retour partagent ce tableau avec les dépôts et les
 * retraits, et c'est voulu : le gérant relit sa journée d'un seul tenant, pas
 * dans deux écrans qu'il faudrait recoller. Mais ils n'ont pas de client, pas
 * de code réseau, et ne se corrigent pas de la même manière — leur emprunter
 * l'habillage d'une transaction client faisait afficher « Client inconnu » sous
 * une ligne dont on connaît parfaitement l'expéditeur, et proposait deux
 * boutons que le serveur refuse toujours (storeTransactionCommand.js,
 * `refuserSiIntouchable`).
 *
 * Mêmes colonnes, donc, mais trois cellules qui disent autre chose.
 */
const estLigneDealer = (type) => type === TYPE_RAVITAILLEMENT || type === TYPE_RETOUR

/** La réserve touchée, dite comme le formulaire la dit. */
const libelleReserve = (cle) => (cle === 'liquidite' ? 'espèce' : cle === 'stock' ? 'stock' : '')

/**
 * Le sens du mouvement, porté par le signe.
 *
 * Un ravitaillement remplit une réserve, un retour la vide — et les deux
 * s'affichaient avec le même montant nu, impossible à distinguer sans relire la
 * colonne Type. Le signe met la différence là où l'œil regarde déjà.
 */
const signeMouvement = (type) => {
  if (type === TYPE_RAVITAILLEMENT) return '+ '
  if (type === TYPE_RETOUR) return '− '
  return ''
}

/**
 * Les deux colonnes d'opérateur, affichées seulement si le profil le demande.
 *
 * Chez C2EGF toute la boutique opère sous un compte unique : « C2EGF SIEGE »
 * et son adresse se répétaient à l'identique sur chaque ligne, occupant deux
 * colonnes pleine largeur qui repoussaient les actions hors de l'écran.
 *
 * Rien n'est effacé pour autant : `operatorId`, `operatorName` et
 * `operatorEmail` restent écrits sur chaque transaction, l'export XLSM
 * continue de porter la colonne « Email utilisateur », et l'audit serveur
 * garde l'uid de l'auteur de chaque mouvement. Seul l'AFFICHAGE recule. Le
 * jour où chaque caissière aura son compte, `operatorColumns: true` les
 * rallume sans migration.
 */
const COLONNES_OPERATEUR = STORE_HISTORY_CONFIG.operatorColumns !== false

// Au-delà de ce nombre de lignes, on active le fenêtrage (virtualisation).
// En dessous, le rendu est strictement identique à l'historique (aucune régression).
const VIRTUALIZE_THRESHOLD = 60
// Hauteur de repli d'une ligne (px) tant que la mesure réelle n'est pas disponible.
const DEFAULT_ROW_HEIGHT = 49

/**
 * Le ton d'un statut. La pastille était `bg-success-soft` en dur : une opération
 * ANNULÉE s'affichait en vert, tout comme une opération validée. La couleur
 * affirmait le contraire du texte qu'elle entourait.
 */
const tonStatut = (statut) => {
  const s = String(statut || 'Validée').toLowerCase()
  if (s.includes('annul') || s.includes('rejet') || s.includes('échou') || s.includes('echou')) return 'rejected'
  if (s.includes('valid') || s.includes('termin')) return 'confirmed'
  return 'pending'
}

/**
 * Un règlement inachevé : des tranches encaissées, un reste à payer.
 * Ni supprimable ni réouvrable — les tranches déjà passées resteraient
 * orphelines, et rien ne sait les recoller.
 */
const reglementInacheve = (transaction) =>
  transaction?.settlementStatus === 'partial' || (Number(transaction?.remainingAmount) || 0) > 0

const RAISON_PARTIEL = 'Transaction partiellement réglée : corrigez-la par un remboursement.'

/**
 * Pourquoi un bouton est barré — ou `null` s'il ne l'est pas.
 *
 * Le serveur refuse déjà ces lignes ; on duplique la règle ici pour que le
 * refus se lise AVANT le clic, avec sa raison, plutôt qu'après sous forme de
 * message d'erreur. Une seule fonction sert l'attribut `disabled` ET
 * l'infobulle : les voir diverger est trop facile quand ils sont écrits à deux
 * endroits.
 *
 * Les deux boutons partagent aujourd'hui le même refus — mais pas la même
 * fonction, et c'est délibéré. L'absence de mode de règlement a bloqué la
 * réouverture le temps que la revalidation apprenne à rejouer les deux jambes
 * d'une validation directe ; d'autres asymétries viendront. Les garder
 * distinctes évite d'avoir à les redécoudre.
 */
const raisonNonSupprimable = (transaction) =>
  reglementInacheve(transaction) ? RAISON_PARTIEL : null

const raisonNonModifiable = (transaction) =>
  reglementInacheve(transaction) ? RAISON_PARTIEL : null

/**
 * `onReopen` est une PROP, alors que la suppression passe par le contexte.
 * L'asymétrie est voulue : rouvrir a une conséquence de navigation — le
 * formulaire vit sur /transactions, pas ici —, et ce tableau n'a pas à
 * connaître les routes de l'application. `Historique.jsx` est déjà couplé au
 * routeur par `useSearchParams` ; lui confier le déplacement n'ajoute rien à sa
 * charge, là où `useNavigate()` ici rendrait le tableau immontable sans
 * routeur. TC-091 le monte précisément comme une unité nue.
 */
function HistoriqueTable({ transactions = [], onReopen }) {
  const { getTransactionStyles, trashTransaction } = useTransactions()
  const { themeClasses } = useTheme()
  const [aSupprimer, setASupprimer] = useState(null)
  const [journalOuvert, setJournalOuvert] = useState(null)
  const [enCours, setEnCours] = useState(false)
  // LE MESSAGE DU SERVEUR, MOT POUR MOT.
  //
  // Ces deux gestes sont refusés pour une dizaine de raisons distinctes — un
  // règlement partiel, une liquidité déjà vidée, un historique incomplet, un
  // retrait d'avant la répartition de liquidité — et chacune se corrige
  // autrement. Les avaler toutes dans un échec muet, c'est transformer dix
  // diagnostics en un seul « ça ne marche pas », qu'on ne peut ni comprendre
  // ni rapporter. Le serveur rédige déjà des messages lisibles : on les montre.
  const [echec, setEchec] = useState(null)
  // Les groupes ouverts, par clé. Replié par défaut : c'est tout l'objet du
  // regroupement — on ouvre celui qu'on veut détailler, pas les six autres.
  const [deplies, setDeplies] = useState(() => new Set())
  const allTransactions = transactions

  const basculer = useCallback((cle) => {
    setDeplies((precedent) => {
      const suivant = new Set(precedent)
      if (suivant.has(cle)) suivant.delete(cle)
      else suivant.add(cle)
      return suivant
    })
  }, [])

  /**
   * Les rangées réellement rendues, à plat : en-tête de groupe, ses lignes si
   * le groupe est ouvert, et les transactions seules.
   *
   * ⚠ C'EST CETTE LISTE QUE LE FENÊTRAGE COMPTE, et pas `transactions`.
   *   Virtualiser sur le nombre de transactions alors que l'écran rend des
   *   groupes ferait calculer une hauteur pour des rangées qui n'existent pas :
   *   le tableau réserverait du vide et sauterait au défilement.
   */
  const rangees = useMemo(() => regrouperParClientEtType(allTransactions), [allTransactions])

  const lignesAffichees = useMemo(() => {
    const sortie = []
    for (const rangee of rangees) {
      if (rangee.seule) { sortie.push({ seule: rangee.seule }); continue }
      sortie.push({ entete: rangee.groupe })
      if (deplies.has(rangee.groupe.cle)) {
        for (const ligne of rangee.groupe.lignes) sortie.push({ seule: ligne, enfant: true })
      }
    }
    return sortie
  }, [rangees, deplies])

  const rouvrir = useCallback(async (transaction) => {
    if (!onReopen) return
    setEnCours(true)
    setEchec(null)
    try {
      await onReopen(transaction)
    } catch (error) {
      setEchec(error?.message || 'La réouverture a échoué.')
    } finally {
      setEnCours(false)
    }
  }, [onReopen])

  const confirmerSuppression = useCallback(async () => {
    if (!aSupprimer) return
    setEnCours(true)
    setEchec(null)
    try {
      await trashTransaction(aSupprimer.id)
      setASupprimer(null)
    } catch (error) {
      // On garde le modal ouvert : il porte le message, et le gérant voit que
      // son geste n'a pas abouti.
      setEchec(error?.message || 'La suppression a échoué.')
    } finally {
      setEnCours(false)
    }
  }, [aSupprimer, trashTransaction])

  const fermerSuppression = useCallback(() => {
    setASupprimer(null)
    setEchec(null)
  }, [])

  const headers = [
    'Date & heure',
    'Client',
    'Type',
    // « Réseau » retiré : une seule valeur possible, répétée sur chaque ligne.
    'Code',
    'Montant',
    'Statut',
    // Le chronomètre des non terminées, arrêté. Voir `dureeDe`.
    'Durée',
    ...(COLONNES_OPERATEUR ? ['Utilisateur', 'Email utilisateur'] : []),
    'Actions'
  ]

  const borderClass = themeClasses.tableBorder
  const isVirtualized = lignesAffichees.length > VIRTUALIZE_THRESHOLD

  const { containerRef, rowRef, onScroll, startIndex, endIndex, topPad, bottomPad } =
    useWindowedRows({ itemCount: lignesAffichees.length, defaultRowHeight: DEFAULT_ROW_HEIGHT })

  /**
   * L'en-tête d'un groupe : le client, le type, et le TOTAL — la réponse à la
   * question qu'on se posait en additionnant six montants de tête.
   *
   * Aucun bouton d'action ici : « Modifier » et « Supprimer » agissent sur UNE
   * transaction, et un groupe n'en est pas une. Ils vivent dans les lignes qui
   * se déplient en dessous.
   */
  const renderGroupe = (groupe, ref) => {
    const styles = getTransactionStyles(groupe.type)
    const ouvert = deplies.has(groupe.cle)
    const nombre = groupe.lignes.length

    return (
      <tr
        ref={ref}
        key={`groupe-${groupe.cle}`}
        className="border-b border-line/60 bg-surface-2/60 transition-colors hover:bg-brand-50/60"
        data-testid={`groupe-${groupe.cle}`}
      >
        <td className="whitespace-nowrap px-4 py-3 text-base">
          {formatTransactionDateTime(groupe.lignes[0])}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-base font-semibold">
          {getClientName(groupe.client)}
        </td>
        <td className={`whitespace-nowrap px-4 py-3 text-base font-medium ${styles.textColor}`}>
          {groupe.type || '-'}
          <span className="ml-1 text-xs font-normal text-ink-muted">× {nombre}</span>
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-base text-ink-muted">—</td>
        <td className={`whitespace-nowrap px-4 py-3 text-right text-base font-bold tabular-nums ${styles.textColor}`}>
          {groupe.total.toLocaleString('fr-FR')} FCFA
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-muted">
          {nombre} opérations
        </td>
        {/* Pas de durée pour un groupe : les lignes qu'il replie ont chacune la
            sienne, et une moyenne ne répondrait à la question de personne. */}
        <td className="whitespace-nowrap px-4 py-3 text-base text-ink-muted">—</td>
        {COLONNES_OPERATEUR && (
          <>
            <td className="whitespace-nowrap px-4 py-3 text-base text-ink-muted">—</td>
            <td className="whitespace-nowrap px-4 py-3 text-base text-ink-muted">—</td>
          </>
        )}
        <td className="whitespace-nowrap px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => basculer(groupe.cle)}
              aria-expanded={ouvert}
              data-testid={`basculer-${groupe.cle}`}
              className="inline-flex items-center gap-1 rounded border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
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

  // Une seule définition du markup de ligne, partagée par les deux branches.
  const renderRow = (transaction, index, ref, enfant = false) => {
    const styles = getTransactionStyles(transaction.type)
    const duree = dureeDe(transaction)
    return (
      <tr
        ref={ref}
        key={transaction.id || `${transaction.clientId || 'transaction'}-${transaction.date || index}-${index}`}
        className={`border-b border-line/60 transition-colors hover:bg-brand-50/60 ${
          enfant ? 'bg-brand-50/30' : ''
        }`}
        data-testid={enfant ? 'ligne-de-groupe' : undefined}
      >
        <td className={`whitespace-nowrap px-4 py-3 text-base ${enfant ? 'border-l-4 border-l-brand-300 pl-6' : ''}`}>
          {formatTransactionDateTime(transaction)}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-base">
          {estLigneDealer(transaction.type) ? (
            <span className="flex flex-col leading-tight" data-testid="expediteur-ligne">
              <span>{transaction.expediteur || 'Sans expéditeur'}</span>
              <span className="text-xs text-ink-muted">dealer</span>
            </span>
          ) : getClientName(transaction.client)}
        </td>
        <td className={`whitespace-nowrap px-4 py-3 text-base font-medium ${styles.textColor}`}>
          {transaction.type || '-'}
          {estLigneDealer(transaction.type) && libelleReserve(transaction.balanceType) && (
            <span className="ml-1 text-xs font-normal text-ink-muted">
              · {libelleReserve(transaction.balanceType)}
            </span>
          )}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-base">
          {transaction.code || '-'}
          {/* La DESTINATION du règlement, quand l'argent est parti sur un
              compte agent au lieu d'être remis en main propre. Deux lignes
              plutôt qu'une colonne de plus : la question « où est parti
              l'argent » ne se pose que sur quelques lignes, et la réponse n'a
              de sens que collée au code du client. */}
          {transaction.settlementAgentCode && (
            <span
              className="mt-0.5 block text-xs text-ink-muted"
              data-testid="code-agent-reglement"
              title="Code agent sur lequel le règlement a été envoyé"
            >
              → {transaction.settlementAgentCode}
            </span>
          )}
        </td>
        <td className={`whitespace-nowrap px-4 py-3 text-right text-base font-medium tabular-nums ${styles.textColor}`}>
          {transaction.montant ? `${signeMouvement(transaction.type)}${(Number(transaction.montant) || 0).toLocaleString('fr-FR')} FCFA` :
           transaction.amount ? `${transaction.amount} FCFA` : '-'}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-base">
          <StatusBadge status={tonStatut(transaction.statut)} label={transaction.statut || 'Validée'} />
        </td>
        {/* Combien de temps le client a attendu. Vide sur une ligne validée
            d'un geste : elle n'est jamais passée par les non terminées, donc
            aucun chronomètre n'a tourné — et un « 00:00:00 » ferait lire une
            mesure là où il n'y a rien à mesurer. */}
        <td className="whitespace-nowrap px-4 py-3 text-base">
          {duree ? (
            <span className="flex flex-col leading-tight" data-testid="duree-transaction">
              <span className="font-mono text-sm font-semibold tabular-nums text-ink">{duree.texte}</span>
              <span className="text-xs text-ink-muted tabular-nums">
                {formaterHeure(duree.debut)} → {formaterHeure(duree.fin)}
              </span>
            </span>
          ) : (
            <span className="text-ink-muted">—</span>
          )}
        </td>
        {COLONNES_OPERATEUR && (
          <>
            <td className="whitespace-nowrap px-4 py-3 text-base">
              {transaction.operatorName || transaction.userName || '-'}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-base">
              {transaction.operatorEmail || transaction.userEmail || '-'}
            </td>
          </>
        )}
        <td className="whitespace-nowrap px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            {/* Un ravitaillement NE SE DÉFAIT PAS d'ici, et ce n'est pas une
                restriction de confort : le défaire laisserait ses retours
                orphelins, rattachés à une livraison disparue. Il se défait en
                rendant — c'est l'opération inverse, et elle a son écran. */}
            {transaction.type === TYPE_RAVITAILLEMENT && (
              <span className="text-xs text-ink-muted" data-testid="ravitaillement-sans-action">
                Se défait par un retour
              </span>
            )}

            {/* Un retour, lui, se défait — par la commande qui recrédite la
                réserve ET fait remonter le reste dû. Pas de « Modifier » : il
                n'a ni client ni code à corriger, et le serveur le refuse. */}
            {transaction.type === TYPE_RETOUR && (
              <button
                type="button"
                onClick={() => setASupprimer(transaction)}
                disabled={enCours}
                data-testid="supprimer-retour"
                className="rounded border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:border-danger hover:text-danger disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                Annuler
              </button>
            )}

            {!estLigneDealer(transaction.type) && (
              <>
        {/* « Modification » n'apparaît que si le journal n'est pas vide :
            un bouton présent sur chaque ligne obligerait à cliquer pour
            découvrir qu'il n'y a rien à voir. */}
        {Array.isArray(transaction.modifications) && transaction.modifications.length > 0 && (
          <button
            type="button"
            onClick={() => setJournalOuvert(transaction)}
            data-testid="ouvrir-modifications"
            className="rounded border border-brand-300 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            Modification
            <span className="ml-1 tabular-nums">({transaction.modifications.length})</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => rouvrir(transaction)}
          disabled={enCours || Boolean(raisonNonModifiable(transaction))}
          title={raisonNonModifiable(transaction) || undefined}
          data-testid="modifier-historique"
          className="rounded border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          Modifier
        </button>

        <button
          type="button"
          onClick={() => setASupprimer(transaction)}
          disabled={enCours || Boolean(raisonNonSupprimable(transaction))}
          title={raisonNonSupprimable(transaction) || undefined}
          data-testid="supprimer-historique"
          className="rounded border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:border-danger hover:text-danger disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          Annuler
        </button>
              </>
            )}
          </div>
        </td>
      </tr>
    )
  }

  // Lignes à rendre : toute la liste (court) ou la seule fenêtre visible (long).
  const visibleRows = isVirtualized
    ? lignesAffichees.slice(startIndex, endIndex)
    : lignesAffichees

  if (allTransactions.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState
          icon={History}
          title="Aucune transaction dans l'historique"
          message="Aucune opération ne correspond à la période et aux filtres choisis."
        />
      </div>
    )
  }

  return (
    <div className="mt-6">
      <div
        ref={containerRef}
        onScroll={isVirtualized ? onScroll : undefined}
        className={`overflow-x-auto ${isVirtualized ? 'overflow-y-auto max-h-[70vh]' : ''} rounded-lg border ${borderClass}`}
      >
        <table className="w-full border-collapse min-w-max">
          <thead className={isVirtualized ? 'sticky top-0 z-10' : ''}>
            <tr className={themeClasses.tableHeader}>
              {headers.map((header, index) => (
                <th
                  key={index}
                  // Une colonne de montants s'aligne à droite, en-tête compris :
                  // sinon le titre flotte au-dessus de chiffres qui, eux, se
                  // comparent bord à bord.
                  className={`whitespace-nowrap px-4 py-3 text-base font-medium ${themeClasses.text} ${
                    header === 'Montant' || header === 'Actions' ? 'text-right' : 'text-left'
                  }`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(
              <>
                {isVirtualized && topPad > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={headers.length} style={{ height: topPad, padding: 0, border: 'none' }} />
                  </tr>
                )}
                {visibleRows.map((item, i) => {
                  const ref = isVirtualized && i === 0 ? rowRef : undefined
                  return item.entete
                    ? renderGroupe(item.entete, ref)
                    : renderRow(item.seule, startIndex + i, ref, item.enfant)
                })}
                {isVirtualized && bottomPad > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={headers.length} style={{ height: bottomPad, padding: 0, border: 'none' }} />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* La suppression rend un montant aux soldes et sort la ligne de
          l'historique : elle mérite une confirmation qui dit ce qu'elle fait,
          pas un « Êtes-vous sûr ? » qui n'informe personne. */}
      <Dialog
        open={Boolean(aSupprimer)}
        onClose={fermerSuppression}
        title={aSupprimer?.type === TYPE_RETOUR ? 'Annuler ce retour ?' : 'Annuler cette transaction ?'}
        testId="confirmer-suppression-historique"
        footer={(
          <div className="flex justify-end gap-3">
            {/* « Garder », et non « Fermer » ni « Annuler » : la croix du dialogue
                porte déjà « Fermer », et « Annuler » est maintenant le nom du
                geste qui AGIT. Un bouton se nomme par ce qu'il fait — celui-ci
                garde la ligne. */}
            <button
              type="button"
              onClick={fermerSuppression}
              className="rounded border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              Garder
            </button>
            <button
              type="button"
              onClick={confirmerSuppression}
              disabled={enCours}
              data-testid="confirmer-supprimer"
              className="rounded bg-danger px-4 py-2 text-sm font-semibold text-white transition-colors hover:brightness-110 disabled:cursor-wait disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              {enCours ? 'Annulation…' : (aSupprimer?.type === TYPE_RETOUR ? 'Annuler le retour' : 'Annuler la transaction')}
            </button>
          </div>
        )}
      >
        {aSupprimer && (
          <div className="space-y-3 text-sm text-ink">
            <p>
              <span className="font-medium">
                {estLigneDealer(aSupprimer.type)
                  ? (aSupprimer.expediteur || 'Sans expéditeur')
                  : getClientName(aSupprimer.client)}
              </span>
              {' · '}{aSupprimer.type}
              {' · '}
              <span className="font-mono tabular-nums">
                {(Number(aSupprimer.montant) || 0).toLocaleString('fr-FR')} FCFA
              </span>
            </p>
            {/* La conséquence d'un retour défait n'est pas celle d'une
                transaction défaite : la livraison REDEVIENT DUE, et c'est la
                moitié qu'on oublie si on ne la dit pas. */}
            {aSupprimer.type === TYPE_RETOUR ? (
              <p className="text-ink-muted">
                Le montant reviendra dans la réserve {libelleReserve(aSupprimer.balanceType) || 'concernée'},
                et la livraison de {aSupprimer.expediteur || 'cet expéditeur'} redeviendra due d'autant.
              </p>
            ) : (
              <p className="text-ink-muted">
                Le montant sera rendu aux soldes et la ligne ira dans la corbeille,
                où elle restera lisible. Elle ne pourra pas être restaurée.
              </p>
            )}
            {echec && (
              <p
                role="alert"
                data-testid="echec-suppression-historique"
                className="rounded border border-danger/30 bg-danger-soft px-3 py-2 text-danger"
              >
                {echec}
              </p>
            )}
          </div>
        )}
      </Dialog>

      {/* La réouverture n'a pas de dialogue de confirmation — elle est
          réversible, on peut toujours revalider. Son échec, lui, doit se lire :
          sans cela le clic ne produit rien du tout, et le gérant conclut que
          le bouton est cassé. */}
      <Dialog
        open={Boolean(echec) && !aSupprimer}
        onClose={() => setEchec(null)}
        title="Action impossible"
        testId="echec-action-historique"
        footer={(
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setEchec(null)}
              className="rounded border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              Fermer
            </button>
          </div>
        )}
      >
        <p role="alert" className="text-sm text-ink">{echec}</p>
      </Dialog>

      <ModificationsDialog
        transaction={journalOuvert}
        open={Boolean(journalOuvert)}
        onClose={() => setJournalOuvert(null)}
      />
    </div>
  )
}

export default HistoriqueTable
