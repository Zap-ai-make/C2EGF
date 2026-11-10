import { useEffect, useId, useState } from 'react'
import { Plus } from 'lucide-react'
import Dialog from '../ui/Dialog.jsx'
import { creerBoutique } from '../../services/boutiquesService.js'
import { attendreBoutiqueActive } from '../../services/boutiquesActives.js'
import { genererMotDePasse } from '../../utils/motDePasse.js'

/**
 * « Nouvelle boutique » — le compte de connexion, la fiche et le profil en un
 * geste, depuis l'écran Boutiques du patron, au lieu de la console Firebase.
 *
 * ⚠ C'EST LA SEULE ÉCRITURE DE L'ESPACE DU PATRON (décision du 2026-11-10) ; le
 *   serveur la réserve au patron (`functions/src/boutiques/creerBoutique.js`).
 *
 * ⚠ LE MOT DE PASSE EST AFFICHÉ EN CLAIR, EXPRÈS. Le patron le choisit pour le
 *   transmettre à la boutique : il doit pouvoir le relire, et le copier. Il n'est
 *   gardé que le temps de l'écran de confirmation, puis effacé.
 *
 * ⚠ SANS CONNEXION, LE BOUTON EST GRISÉ. Une création attend la réponse du
 *   serveur : elle ne passe pas par la file d'envoi des caisses.
 */

const VIDE = Object.freeze({ nom: '', email: '', motDePasse: '' })
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Les mêmes bornes que le serveur, pour répondre avant l'appel. Le serveur
// reste le juge : il refait chaque contrôle.
function probleme({ nom, email, motDePasse }) {
  if (nom.trim().length < 2) return 'Nom : 2 caractères au moins.'
  if (!EMAIL.test(email.trim())) return 'E-mail invalide.'
  if (motDePasse.length < 8 || motDePasse !== motDePasse.trim()) {
    return 'Mot de passe : 8 caractères au moins, sans espace au début ni à la fin.'
  }
  return null
}

function useEnLigne() {
  const [enLigne, setEnLigne] = useState(() => navigator.onLine)
  useEffect(() => {
    const allume = () => setEnLigne(true)
    const eteint = () => setEnLigne(false)
    window.addEventListener('online', allume)
    window.addEventListener('offline', eteint)
    return () => {
      window.removeEventListener('online', allume)
      window.removeEventListener('offline', eteint)
    }
  }, [])
  return enLigne
}

const CHAMP = 'min-h-11 w-full rounded-xl border border-brand-200 bg-surface px-3 text-sm text-ink'
const ETIQUETTE = 'mb-1 block text-sm font-medium text-ink'
const BOUTON = 'min-h-11 rounded-xl border px-4 text-sm font-semibold disabled:opacity-50'
const BOUTON_PRINCIPAL = `${BOUTON} border-brand-500 bg-brand-500 text-white`
const BOUTON_SECONDAIRE = `${BOUTON} border-brand-200 bg-surface text-ink`

function NouvelleBoutique({ onCreee }) {
  const enLigne = useEnLigne()
  const formulaireId = useId()
  const [ouvert, setOuvert] = useState(false)
  const [champs, setChamps] = useState(VIDE)
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')
  const [creee, setCreee] = useState(null)
  const [copie, setCopie] = useState(false)

  const recommencer = () => {
    setCreee(null)
    setChamps(VIDE)
    setCopie(false)
    setErreur('')
  }

  // Fermer pendant l'envoi ne perd rien : la réponse arrive quand même, et
  // l'écran de confirmation attend la réouverture. Fermer APRÈS la confirmation
  // efface le mot de passe.
  const fermer = () => {
    setOuvert(false)
    if (creee) recommencer()
  }

  const changer = (champ) => (ev) => setChamps((c) => ({ ...c, [champ]: ev.target.value }))

  const soumettre = async (ev) => {
    ev.preventDefault()
    if (envoi) return
    const refus = probleme(champs)
    if (refus) {
      setErreur(refus)
      return
    }
    setErreur('')
    setEnvoi(true)
    try {
      const boutique = await creerBoutique(champs)
      // Une boutique reprise après un premier essai garde le mot de passe de cet
      // essai-là : afficher celui du formulaire pourrait être faux.
      setCreee({ ...boutique, motDePasse: boutique.dejaCreee ? null : champs.motDePasse })
      attendreBoutiqueActive(boutique.storeId).then(() => onCreee?.(boutique))
    } catch (err) {
      setErreur(err.message)
    } finally {
      setEnvoi(false)
    }
  }

  // Sans presse-papiers (page non sécurisée, navigateur ancien), les
  // identifiants restent affichés : on les recopie à la main.
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(`Boutique : ${creee.nom}\nE-mail : ${creee.email}\nMot de passe : ${creee.motDePasse}`)
      setCopie(true)
    } catch {
      setCopie(false)
    }
  }

  const pied = creee ? (
    <>
      {creee.motDePasse && (
        <button type="button" onClick={copier} className={BOUTON_SECONDAIRE}>
          {copie ? 'Copié' : 'Copier les identifiants'}
        </button>
      )}
      <button type="button" onClick={recommencer} className={BOUTON_SECONDAIRE}>Créer une autre</button>
      <button type="button" onClick={fermer} className={BOUTON_PRINCIPAL}>Fermer</button>
    </>
  ) : (
    <>
      <button type="button" onClick={fermer} className={BOUTON_SECONDAIRE}>Annuler</button>
      <button type="submit" form={formulaireId} disabled={envoi || !enLigne} className={BOUTON_PRINCIPAL}>
        {envoi ? 'Création…' : 'Créer la boutique'}
      </button>
    </>
  )

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        {!enLigne && <span className="text-xs text-ink-muted">Connexion requise</span>}
        <button
          type="button"
          onClick={() => setOuvert(true)}
          disabled={!enLigne}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-brand-200 bg-surface px-3 text-sm font-semibold text-brand-500 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
          Nouvelle boutique
        </button>
      </div>

      <Dialog
        open={ouvert}
        onClose={fermer}
        title="Nouvelle boutique"
        description="Elle pourra se connecter tout de suite."
        footer={pied}
        testId="nouvelle-boutique"
        cote
      >
        {creee ? (
          <div role="status">
            <p className="text-base font-semibold text-ink">
              {creee.dejaCreee ? 'Cette boutique existait déjà' : 'Boutique créée'}
            </p>
            {creee.dejaCreee && (
              <p className="mt-1 text-sm text-ink-muted">
                Ton premier essai l’avait créée : son mot de passe est celui saisi à ce moment-là.
              </p>
            )}
            <dl className="mt-3 space-y-2 rounded-xl border border-brand-200 bg-canvas px-3 py-2.5 text-sm">
              <div>
                <dt className="text-xs text-ink-muted">Boutique</dt>
                <dd className="font-semibold text-ink">{creee.nom}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">E-mail</dt>
                <dd className="font-semibold text-ink">{creee.email}</dd>
              </div>
              {creee.motDePasse && (
                <div>
                  <dt className="text-xs text-ink-muted">Mot de passe</dt>
                  <dd className="font-mono font-semibold text-ink">{creee.motDePasse}</dd>
                </div>
              )}
            </dl>
            {creee.motDePasse && (
              <p className="mt-3 text-sm text-ink-muted">Note le mot de passe : il ne sera plus affiché.</p>
            )}
          </div>
        ) : (
          <form id={formulaireId} onSubmit={soumettre} noValidate className="space-y-4">
            <div>
              <label htmlFor={`${formulaireId}-nom`} className={ETIQUETTE}>Nom de la boutique</label>
              <input
                id={`${formulaireId}-nom`}
                value={champs.nom}
                onChange={changer('nom')}
                maxLength={80}
                autoComplete="off"
                className={CHAMP}
              />
            </div>
            <div>
              <label htmlFor={`${formulaireId}-email`} className={ETIQUETTE}>E-mail de connexion</label>
              <input
                id={`${formulaireId}-email`}
                type="email"
                inputMode="email"
                value={champs.email}
                onChange={changer('email')}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                className={CHAMP}
              />
            </div>
            <div>
              <label htmlFor={`${formulaireId}-mdp`} className={ETIQUETTE}>Mot de passe</label>
              <div className="flex gap-2">
                <input
                  id={`${formulaireId}-mdp`}
                  value={champs.motDePasse}
                  onChange={changer('motDePasse')}
                  maxLength={128}
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className={`${CHAMP} min-w-0 flex-1 font-mono`}
                />
                <button
                  type="button"
                  onClick={() => setChamps((c) => ({ ...c, motDePasse: genererMotDePasse() }))}
                  className={BOUTON_SECONDAIRE}
                >
                  Générer
                </button>
              </div>
              <p className="mt-1 text-xs text-ink-muted">8 caractères au moins.</p>
            </div>
            {!enLigne && <p className="text-sm text-ink-muted">Connexion requise.</p>}
            {erreur && <p role="alert" className="text-sm font-medium text-danger">{erreur}</p>}
          </form>
        )}
      </Dialog>
    </>
  )
}

export default NouvelleBoutique
