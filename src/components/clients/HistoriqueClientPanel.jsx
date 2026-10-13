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
      {totaux && (
        <div className="border-b border-line pb-3">
          <p className="text-sm text-ink">{francs(totaux.operations)} opérations enregistrées</p>
          {totaux.parBoutique?.length > 0 && (
            <p className="mt-1 text-sm text-ink-muted">
              {totaux.parBoutique.map((b) => `${b.storeName} ${francs(b.operations)}`).join(' · ')}
            </p>
          )}
          {totaux.nonDatees > 0 && (
            <p className="mt-1 text-sm text-warn">
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

      {etat !== 'chargement' && etat !== 'erreur' && lignes.length === 0 && (
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

          {encore
            ? <LoadMoreButton loading={etat === 'chargementPage'} onClick={chargerPlus} />
            : (
              <p className="mt-3 text-center text-sm text-ink-muted">
                {francs(totaux?.operations ?? lignes.length)} opérations, c’est tout.
              </p>
            )}
        </>
      )}
    </Dialog>
  )
}

export default HistoriqueClientPanel
