import { memo } from 'react'

/**
 * Une opération d'agent, telle qu'elle se lit dans son historique.
 *
 * ⚠ MÉMOÏSÉE PARCE QUE LA LISTE EST VIRTUALISÉE. Le conteneur rerend à chaque
 *   défilement ; sans `memo`, chaque ligne visible se reconstruirait à chaque
 *   pixel parcouru.
 *
 * ⚠ `maintenant` EST UNE PROP, PAS UN `Date.now()` INTERNE. Un minuteur par
 *   ligne ferait tourner soixante horloges pour un seul chiffre — le panneau
 *   n'en tient qu'un, comme `TransactionTable` le fait déjà.
 */

const MINUTE = 60000
const HEURE = 60 * MINUTE
const JOUR = 24 * HEURE

/** « 6 h », « 4 j », « 12 min ». Vide si l'instant est inconnu. */
export function depuisQuand(instant, maintenant) {
  if (!instant || !maintenant || maintenant <= instant) return ''
  const ecart = maintenant - instant
  if (ecart >= JOUR) return `${Math.floor(ecart / JOUR)} j`
  if (ecart >= HEURE) return `${Math.floor(ecart / HEURE)} h`
  return `${Math.max(1, Math.floor(ecart / MINUTE))} min`
}

const francs = (montant) => (
  typeof montant === 'number' && Number.isFinite(montant) ? montant.toLocaleString('fr-FR') : '—'
)

/**
 * Ce qui s'affiche d'un champ venu de Firestore, et JAMAIS un objet.
 *
 * ⚠ REACT JETTE SUR UN OBJET COMME ENFANT, et l'unique ErrorBoundary enveloppe
 *   `AppContent` entier : un seul champ mal typé remplaçait l'application par
 *   une carte d'erreur. Le serveur normalise déjà `date`
 *   (`functions/src/clients/historiqueClient.js`) ; cette garde est la seconde
 *   serrure, parce que ces valeurs traversent une frontière réseau et qu'un
 *   écran ne doit pas tomber pour une donnée inattendue.
 */
const texte = (valeur) => (
  valeur === null || valeur === undefined || typeof valeur === 'object' ? '' : String(valeur)
)

const LigneHistorique = memo(function LigneHistorique({ ligne, maintenant }) {
  const supprimee = Boolean(ligne.deletedAt)
  const entrant = ligne.typePlie === 'depot'
  const attente = ligne.source === 'draft' ? depuisQuand(ligne.createdAt, maintenant) : ''

  return (
    <div className={`border-b border-line px-4 py-3 ${supprimee ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm tabular-nums text-ink-muted">{texte(ligne.date) || '—'}</span>
        <span className={`text-sm font-medium ${entrant ? 'text-inflow' : 'text-outflow'}`}>
          {texte(ligne.type) || '—'}
        </span>
        <span className={`text-base font-semibold tabular-nums ${supprimee ? 'line-through' : ''}`}>
          {francs(ligne.montant)}
        </span>
        <span className="text-sm text-ink-muted">{texte(ligne.statut) || '—'}</span>
        {/*
          ⚠ LA BOUTIQUE EST LA RAISON D'ÊTRE DE CET ÉCRAN. Sans elle, on ne sait
            pas si l'opération est la nôtre — d'où la pastille, toujours visible,
            jamais reléguée derrière un clic.
          `gray-*` et non `slate-*` : c'est la rampe neutre que index.css redéfinit
          pour ce dépôt (teintée vers le bleu de marque) ; `slate` n'y est pas un
          jeton du projet.
        */}
        <span className="ml-auto inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
          {texte(ligne.storeName) || '—'}
        </span>
        {texte(ligne.operatorName) && <span className="text-xs text-ink-muted">{texte(ligne.operatorName)}</span>}
      </div>

      {ligne.source === 'draft' && typeof ligne.reste === 'number' && (
        <p className="mt-1 text-sm text-warn">
          reste {francs(ligne.reste)}
          {attente && <> — en attente depuis {attente}</>}
        </p>
      )}
    </div>
  )
})

export default LigneHistorique
