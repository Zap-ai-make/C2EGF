import { useEffect, useId, useState } from 'react'
import ActionButton from '../ui/ActionButton'
import { genererCodeLiaison } from '../../services/liaisonOxygenService.js'
import { useEnLigne } from '../../hooks/useEnLigne.js'

/**
 * Le code que la caissière dicte à l'agent pour relier son app Oxygen.
 *
 * Contrat : C:\dev\oxygen\docs\contrats\liaison-agent.md, version 3.
 *
 * ⚠ LA CONSIGNE EST LÀ AVANT LE CODE (règle 10). La caissière est la seule
 *   barrière entre une SIM et le compte qui va lire son activité : elle doit
 *   l'avoir sous les yeux au moment de cliquer, pas après.
 *
 * ⚠ HORS CONNEXION, LE BOUTON EST GRISÉ, ET IL LE DIT. Le code doit exister sur
 *   le serveur avant que l'agent le tape : il ne peut pas attendre dans la file
 *   d'envoi comme une opération.
 *
 * ⚠ LE COMPTE À REBOURS SUIT L'HORLOGE DU POSTE, DEPUIS LA RÉCEPTION. Une
 *   machine éteinte chaque soir peut avoir des minutes d'écart avec le serveur :
 *   comparer `expireLe` à son heure afficherait un temps faux. Le serveur rend
 *   donc aussi la durée (`valableMs`).
 */

const deuxChiffres = (n) => String(n).padStart(2, '0')

/** « 15:00 » ; arrondi à la seconde supérieure pour ne jamais afficher 0:00 d'un code vivant. */
const minutesSecondes = (ms) => {
  const secondes = Math.max(0, Math.ceil(ms / 1000))
  return `${deuxChiffres(Math.floor(secondes / 60))}:${deuxChiffres(secondes % 60)}`
}

/** « 042 517 » : deux groupes de trois, qu'on dicte sans se perdre. */
const enDeuxGroupes = (code) => `${code.slice(0, 3)} ${code.slice(3)}`

function CodeLiaisonOxygen({ clientId, aIdentifiant }) {
  const enLigne = useEnLigne()
  const titreId = useId()
  const [etat, setEtat] = useState('repos') // repos · chargement · code · erreur
  const [code, setCode] = useState(null)
  const [finLocale, setFinLocale] = useState(0)
  const [maintenant, setMaintenant] = useState(() => Date.now())
  const [erreur, setErreur] = useState('')

  const restant = finLocale - maintenant
  const vivant = etat === 'code' && restant > 0

  useEffect(() => {
    if (!vivant) return undefined
    const minuteur = setInterval(() => setMaintenant(Date.now()), 1000)
    return () => clearInterval(minuteur)
  }, [vivant])

  const demander = async () => {
    setEtat('chargement')
    setErreur('')
    try {
      const reponse = await genererCodeLiaison(clientId)
      const recu = Date.now()
      setCode(reponse.code)
      setFinLocale(recu + reponse.valableMs)
      setMaintenant(recu)
      setEtat('code')
    } catch (err) {
      setCode(null)
      setErreur(err?.message || 'Code non obtenu. Réessayez.')
      setEtat('erreur')
    }
  }

  const libelle = etat === 'chargement'
    ? 'Code en cours…'
    : etat === 'code' ? 'Nouveau code' : 'Code de liaison Oxygen'

  return (
    <section aria-labelledby={titreId} className="mb-4 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id={titreId} className="text-sm font-semibold text-ink">App Oxygen de l’agent</h3>
          <p className="text-sm text-ink-muted">Vérifiez la SIM agent avant de donner le code.</p>
        </div>
        <ActionButton
          variante="primaire"
          className="min-h-11"
          onClick={demander}
          disabled={!enLigne || !aIdentifiant || etat === 'chargement'}
        >
          {libelle}
        </ActionButton>
      </div>

      {!enLigne && <p className="mt-2 text-sm text-ink-muted">Connexion nécessaire.</p>}

      {!aIdentifiant && (
        <p className="mt-2 text-sm text-ink-muted">Ajoutez d’abord un code ou un numéro agent à la fiche.</p>
      )}

      {vivant && (
        <div className="mt-3">
          {/* Annoncé une fois, à son arrivée. Le compte à rebours reste HORS de
              cette zone : il changerait chaque seconde et serait relu sans fin. */}
          <p role="status" className="font-mono text-3xl font-semibold tabular-nums tracking-widest text-ink">
            {enDeuxGroupes(code)}
          </p>
          <p className="mt-1 text-sm text-ink-muted tabular-nums">Valable {minutesSecondes(restant)}</p>
        </div>
      )}

      {etat === 'code' && !vivant && (
        <p className="mt-2 text-sm text-warn">Code expiré. Demandez un nouveau code.</p>
      )}

      {etat === 'erreur' && (
        <p role="alert" className="mt-2 text-sm text-danger">{erreur}</p>
      )}
    </section>
  )
}

export default CodeLiaisonOxygen
