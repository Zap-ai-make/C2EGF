import { useEffect, useMemo, useState } from 'react'
import Dialog from '../ui/Dialog'
import ErrorState from '../ui/ErrorState'
import EmptyState from '../ui/EmptyState'
import SkeletonList from '../ui/SkeletonList'
import LoadMoreButton from '../ui/LoadMoreButton'
import LigneHistorique from './LigneHistorique'
import { useHistoriqueClient } from '../../hooks/useHistoriqueClient.js'
import { useWindowedRows } from '../../hooks/useWindowedRows.js'
import { champsAgent } from '../../utils/agentFields.js'

/**
 * Tout ce qu'un agent a fait, quelle que soit la boutique.
 *
 * ⚠ LES NON TERMINÉES SONT ÉPINGLÉES, PAS INTERCALÉES. Chargées en entier dès le
 *   premier appel, elles répondent à « où en est son remboursement ». Mêlées à
 *   la liste paginée, une non terminée de trois mois s'afficherait dès la
 *   première page puis se ferait dépasser à chaque « charger plus ».
 *
 * ⚠ UN SEUL MINUTEUR POUR TOUT LE PANNEAU. Chaque non terminée affiche depuis
 *   combien de temps elle attend ; un `setInterval` par ligne ferait tourner
 *   autant d'horloges pour un seul chiffre.
 *
 * ⚠ `totaux` NE PORTE PLUS AUCUNE SOMME D'ARGENT. Sa forme, rendue par le
 *   serveur, est `{ operations, nonDatees, resteAEncaisser, resteAPayer,
 *   nbEnAttente, parBoutique }` — pas de `depots` ni de `retraits`. Une ligne
 *   annulée garde son montant alors que l'argent est déjà revenu aux soldes :
 *   les sommer aurait fait annoncer au panneau de l'argent qui n'existe pas.
 */

const HAUTEUR_LIGNE = 64

const francs = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('fr-FR') : '—')

function HistoriqueClientPanel({ client, onClose }) {
  const clientId = client?.id ?? null
  const { enCours, lignes, totaux, etat, erreur, encore, chargerPlus, reessayer } = useHistoriqueClient(clientId)

  const [maintenant, setMaintenant] = useState(() => Date.now())
  const riendACompter = enCours.length === 0
  useEffect(() => {
    if (riendACompter) return undefined
    setMaintenant(Date.now())
    const minuteur = setInterval(() => setMaintenant(Date.now()), 30000)
    return () => clearInterval(minuteur)
  }, [riendACompter])

  const fenetre = useWindowedRows({ itemCount: lignes.length, defaultRowHeight: HAUTEUR_LIGNE })
  const visibles = useMemo(
    () => lignes.slice(fenetre.startIndex, fenetre.endIndex),
    [lignes, fenetre.startIndex, fenetre.endIndex],
  )

  if (!client) return null

  const agent = champsAgent(client)
  const identite = [
    agent.codeAgent && `Code ${agent.codeAgent}`,
    agent.numeroAgent && `N° ${agent.numeroAgent}`,
    client.localite,
  ].filter(Boolean).join(' · ')

  return (
    <Dialog
      open
      cote
      onClose={onClose}
      title={`${client.nom ?? ''} ${client.prenom ?? ''}`.trim() || 'Fiche sans nom'}
      description={identite}
      largeur="max-w-2xl"
      testId="historique-client-panel"
    >
      {/*
        ⚠ CE RÉSUMÉ ÉTAIT DEUX PHRASES EMPILÉES, DE MÊME TAILLE ET DE MÊME TON.
          « 3 opérations enregistrées » puis « C2EGF SIEGE — 2 op. · C2EGF
          SANKARIARE — 1 op. » : rien ne disait lequel des deux était le total et
          lequel le détail, et les nombres se lisaient au milieu des mots.
          Maintenant le total est un CHIFFRE, gros, avec son libellé en dessous ;
          la répartition est une liste de valeurs étiquetées, chaque compte aligné
          sous le nom de sa boutique. On lit les chiffres en diagonale, les noms
          seulement si on cherche lequel.
      */}
      {totaux && (
        <div className="border-b border-line pb-4">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            {/* ⚠ `operations: null` SIGNIFIE « JE NE SAIS PAS », pas « aucune ».
                Le serveur le pose quand une agrégation échoue : les lignes
                restent lisibles, seul le total manque. Afficher « — » comme un
                compte serait pire que ne rien annoncer. */}
            {typeof totaux.operations === 'number' && (
              <div>
                <p className="text-2xl font-semibold leading-none tabular-nums text-ink">
                  {francs(totaux.operations)}
                </p>
                <p className="mt-1 text-xs uppercase tracking-wide text-ink-muted">
                  {totaux.operations > 1 ? 'opérations enregistrées' : 'opération enregistrée'}
                </p>
              </div>
            )}

            {/* ⚠ LE NOMBRE NE SE COLLE PAS AU NOM. « C2EGF 10YAAR 3 » se lisait
                comme une boutique appelée « 10YAAR 3 » : les noms d'ici finissent
                par des chiffres, donc la juxtaposition ne peut pas marcher. En
                colonne, le compte est au-dessus de son libellé — il n'y a plus
                de juxtaposition du tout. */}
            {totaux.parBoutique?.map((b) => (
              <div key={b.storeId ?? b.storeName}>
                <p className="text-lg font-semibold leading-none tabular-nums text-ink">
                  {francs(b.operations)}
                </p>
                <p className="mt-1 text-xs uppercase tracking-wide text-ink-muted">{b.storeName}</p>
              </div>
            ))}
          </div>

          {totaux.nonDatees > 0 && (
            <p className="mt-3 text-sm text-warn">
              {francs(totaux.nonDatees)} opération(s) sans date ne peuvent pas être listées.
            </p>
          )}
        </div>
      )}

      {enCours.length > 0 && (
        <section className="mt-3 rounded-lg border border-warn/40 bg-warn-soft">
          <h3 className="px-4 pt-3 text-sm font-semibold uppercase tracking-wide text-warn">En cours</h3>
          {enCours.map((ligne) => (
            <LigneHistorique key={ligne.id} ligne={ligne} maintenant={maintenant} />
          ))}
          <p className="px-4 py-2 text-sm font-medium text-ink">
            {francs(totaux?.resteAEncaisser ?? 0)} à encaisser · {francs(totaux?.resteAPayer ?? 0)} à payer
          </p>
        </section>
      )}

      {etat === 'chargement' && <div className="mt-3"><SkeletonList /></div>}

      {etat === 'erreur' && (
        <div className="mt-3">
          <ErrorState message={erreur} onRetry={reessayer} />
        </div>
      )}

      {/* ⚠ SEULEMENT SUR « PRÊT ». Le hook démarre à « inactif » et l'effet qui
          lance le chargement ne part qu'après le premier rendu : toute condition
          formulée en négatif (« ni chargement ni erreur ») affiche donc le vide
          une frame à chaque ouverture, et annonce « aucune opération » sur un
          agent qui en a. Un écran ne dit pas qu'il n'y a rien tant qu'il n'a pas
          demandé. */}
      {/* ⚠ ET SEULEMENT SI « EN COURS » EST VIDE AUSSI. Un agent dont la toute
          première opération n'est pas encore terminée n'a RIEN dans `history` —
          un brouillon n'y rejoint qu'à la validation. Sans cette condition, le
          panneau affichait l'encart « En cours » avec l'opération, puis juste
          en dessous « Rien n'a encore été enregistré sous ce code ». */}
      {etat === 'pret' && lignes.length === 0 && enCours.length === 0 && (
        <div className="mt-3">
          <EmptyState
            title="Aucune opération pour cet agent"
            message="Rien n’a encore été enregistré sous ce code, dans aucune boutique."
          />
        </div>
      )}

      {lignes.length > 0 && (
        <>
          <div
            ref={fenetre.containerRef}
            onScroll={fenetre.onScroll}
            className="mt-3 max-h-[60vh] overflow-y-auto"
          >
            <div style={{ height: fenetre.topPad }} />
            {visibles.map((ligne, index) => (
              <div key={ligne.id} ref={index === 0 ? fenetre.rowRef : undefined}>
                <LigneHistorique ligne={ligne} maintenant={maintenant} />
              </div>
            ))}
            <div style={{ height: fenetre.bottomPad }} />
          </div>

          {/* ⚠ ON COMPTE CE QUI EST AFFICHÉ, pas `totaux.operations`. Ce total
              porte sur TOUT l'historique, non datées comprises, alors que la
              liste ne peut pas montrer les lignes sans `createdAt` — Firestore
              exclut d'une requête triée les documents qui ne portent pas le
              champ trié. Annoncer « 437 opérations, c'est tout » au bas d'une
              liste de 434 faisait se contredire deux nombres du même panneau.

              ⚠ ET PAS DE BOUTON QUAND LE CHARGEMENT A ÉCHOUÉ : `ErrorState`
              porte déjà son Réessayer, deux relances pour une seule panne. */}
          {encore && etat !== 'erreur' && (
            <LoadMoreButton loading={etat === 'chargementPage'} onClick={chargerPlus} />
          )}
          {!encore && (
            <p className="mt-3 text-center text-sm text-ink-muted">
              {francs(lignes.length)} opérations affichées, c’est tout.
            </p>
          )}
        </>
      )}
    </Dialog>
  )
}

export default HistoriqueClientPanel
