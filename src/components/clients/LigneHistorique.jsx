import { memo } from 'react'
import StatusBadge from '../ui/StatusBadge.jsx'
import { tonStatut } from '../../utils/helpers.js'
import { dureeDe, formaterHeure } from '../../utils/attente.js'

/**
 * Une opération d'agent, telle qu'elle se lit dans son historique.
 *
 * ⚠ LES MÊMES RÈGLES QUE `HistoriqueTable`, PAS DES RÈGLES PARALLÈLES. Ces deux
 *   écrans montrent les mêmes opérations : la même transaction doit s'y lire
 *   pareil, sinon la caissière qui passe de l'un à l'autre doit se demander
 *   lequel dit vrai. D'où les imports partagés — `dureeDe` et `formaterHeure`
 *   pour le chronomètre, `tonStatut` pour la couleur de la pastille, et le même
 *   `StatusBadge`. Ce fichier avait sa propre arithmétique de durée : elle
 *   arrondissait à la minute là où le tableau compte les secondes, et taisait
 *   tout délai inférieur à une minute que le tableau, lui, affiche.
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

/** Deux noms qui ne diffèrent que par la casse ou les espaces sont le même nom. */
const memeNom = (a, b) => {
  const plier = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  const pliee = plier(a)
  return pliee.length > 0 && pliee === plier(b)
}

const francs = (montant) => (
  typeof montant === 'number' && Number.isFinite(montant) ? montant.toLocaleString('fr-FR') : null
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

  // Le chronomètre des non terminées, arrêté — exactement celui du tableau.
  // `null` sur une ligne validée d'un geste : elle n'est jamais passée par les
  // non terminées, donc personne n'a attendu, et « 00:00:00 » ferait lire une
  // mesure là où il n'y a rien à mesurer.
  const duree = ligne.source === 'draft' ? null : dureeDe(ligne)

  // ⚠ LE COMPTE DE LA BOUTIQUE PORTE LE NOM DE LA BOUTIQUE. Quand la caissière
  //   opère sous le compte de son magasin, `operatorName` vaut exactement le nom
  //   déjà affiché par la pastille — et la ligne répétait « C2EGF 10YAAR
  //   C2EGF 10YAAR ». On ne montre l'opérateur que lorsqu'il ajoute quelque
  //   chose : un prénom, un autre compte.
  const operateur = memeNom(ligne.operatorName, ligne.storeName) ? '' : texte(ligne.operatorName)

  const montant = francs(ligne.montant)
  const code = texte(ligne.code)
  const codeReglement = texte(ligne.settlementAgentCode)

  return (
    <div className={`border-b border-line px-4 py-3 ${supprimee ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm tabular-nums text-ink-muted">{texte(ligne.date) || '—'}</span>
        <span className={`text-sm font-medium ${entrant ? 'text-inflow' : 'text-outflow'}`}>
          {texte(ligne.type) || '—'}
        </span>
        <span className={`text-base font-semibold tabular-nums ${supprimee ? 'line-through' : ''}`}>
          {montant ? `${montant} FCFA` : '—'}
        </span>
        {/* ⚠ LA COULEUR NE DOIT PAS CONTREDIRE LE TEXTE : une opération annulée
            ne s'affiche pas comme une validée. Même règle que le tableau, parce
            que c'est littéralement la même fonction (`tonStatut`). */}
        <StatusBadge status={tonStatut(ligne.statut)} label={texte(ligne.statut) || 'Validée'} />
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
        {operateur && <span className="text-xs text-ink-muted">{operateur}</span>}
      </div>

      {/* La seconde ligne porte ce que la première ne peut pas tenir : le code
          du client, la destination du règlement, et le temps que ça a pris. */}
      {(code || duree) && (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {code && (
            <span className="text-sm tabular-nums text-ink-muted">
              {code}
              {/* La DESTINATION du règlement, quand l'argent est parti sur un
                  compte agent au lieu d'être remis en main propre. Collée au
                  code du client, parce que la réponse n'a de sens qu'à côté de
                  la question. */}
              {codeReglement && (
                <span
                  className="ml-1 text-xs"
                  data-testid="code-agent-reglement"
                  title="Code agent sur lequel le règlement a été envoyé"
                >
                  → {codeReglement}
                </span>
              )}
            </span>
          )}

          {duree && (
            <span className="inline-flex items-baseline gap-2" data-testid="duree-transaction">
              <span className="font-mono text-sm font-semibold tabular-nums text-ink">{duree.texte}</span>
              <span className="text-xs tabular-nums text-ink-muted">
                {formaterHeure(duree.debut)} → {formaterHeure(duree.fin)}
              </span>
            </span>
          )}
        </div>
      )}

      {ligne.source === 'draft' && typeof ligne.reste === 'number' && (
        <p className="mt-1 text-sm text-warn">
          reste {francs(ligne.reste) ?? '—'} FCFA
          {attente && <> — en attente depuis {attente}</>}
        </p>
      )}
    </div>
  )
})

export default LigneHistorique
