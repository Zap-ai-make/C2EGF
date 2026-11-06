import { REFUSEE } from '../../services/fileEnvoi.js'
import { useEnvois } from '../../context/envoisContexte.js'

/**
 * Où en est une opération faite sans réseau (lot G3c, docs/rester-dans-le-
 * quota-gratuit.md §G3). Rien pour une ligne que le serveur a déjà : c'est le
 * cas de presque toutes.
 *
 * Une refusée se retire d'un geste. Elle n'existe que sur cet appareil : la
 * garder indéfiniment ferait croire à une opération encore possible.
 */
export default function EtatEnvoi({ envoi, id }) {
  const envois = useEnvois()
  if (!envoi) return null
  if (envoi.etat === REFUSEE) {
    return (
      <div className="mt-1 text-xs font-medium text-danger" data-testid="envoi-refuse">
        Refusée : {envoi.erreur?.message || 'le serveur n’a pas accepté cette opération.'}
        {id && envois && (
          <>
            {' '}
            <button type="button" onClick={() => envois.retirer(id)} className="underline" data-testid="retirer-envoi-lien">
              Retirer
            </button>
          </>
        )}
      </div>
    )
  }
  // Partie dans la seconde, réseau présent : rien à dire (lot H).
  if (envois?.signalerAttente === false) return null
  return (
    <div className="mt-1 text-xs font-medium text-warn" data-testid="envoi-en-attente">
      En attente d’envoi
    </div>
  )
}
