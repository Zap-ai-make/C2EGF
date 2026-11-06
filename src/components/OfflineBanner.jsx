import { useState, useEffect } from 'react'
import { useEnvois } from '../context/envoisContexte.js'
import EnvoisListe from './EnvoisListe.jsx'

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`

/**
 * Le bandeau du bas : hors ligne, et ce qui attend le réseau.
 *
 * ⚠ `navigator.onLine` MENT SUR UN WIFI SANS INTERNET : il reste vrai. La file
 *   d'envoi (lot G3c), elle, sait qu'une opération n'est pas partie. Le
 *   bandeau s'affiche dès qu'une opération attend, même quand le navigateur se
 *   croit en ligne : c'est le seul signal qui ne trompe pas la caissière.
 */
export default function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [listeOuverte, setListeOuverte] = useState(false)
  const envois = useEnvois()
  const enAttente = envois?.enAttente?.length ?? 0
  const refusees = envois?.refusees?.length ?? 0

  useEffect(() => {
    const goOnline  = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online',  goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online',  goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  const vide = enAttente === 0 && refusees === 0
  if (isOnline && vide && !listeOuverte) return null

  const phrases = []
  if (!isOnline) phrases.push('Hors ligne — les données affichées proviennent du cache local')
  if (enAttente > 0) phrases.push(`${pluriel(enAttente, 'opération')} en attente d’envoi : ${enAttente > 1 ? 'elles partiront' : 'elle partira'} dès le retour de la connexion`)
  if (refusees > 0) phrases.push(`${pluriel(refusees, 'opération')} ${refusees > 1 ? 'refusées' : 'refusée'} par le serveur`)

  return (
    <>
      {phrases.length > 0 && (
        // L'orange est le jeton d'identité de l'opérateur, réservé aux DONNÉES
        // (pastilles, séries de graphique). Être hors ligne n'est pas une
        // information Orange, c'est un avertissement — donc `warn`.
        <div
          role="status"
          aria-live="polite"
          data-testid="bandeau-hors-ligne"
          className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-warn px-4 py-2.5 text-sm font-medium text-white shadow-lg"
        >
          <svg aria-hidden="true" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.56 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01" />
          </svg>
          <span>{phrases.join(' · ')}</span>
          {!vide && (
            <button
              type="button"
              onClick={() => setListeOuverte(true)}
              data-testid="voir-envois"
              className="shrink-0 rounded border border-white/60 px-2 py-0.5 text-xs font-semibold text-white transition-colors hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Voir
            </button>
          )}
        </div>
      )}
      {listeOuverte && (
        <EnvoisListe
          open
          onClose={() => setListeOuverte(false)}
          operations={envois?.operations ?? []}
          onRetirer={(id) => envois?.retirer(id)}
        />
      )}
    </>
  )
}
