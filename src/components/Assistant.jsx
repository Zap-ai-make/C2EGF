import { lazy, Suspense, useState } from 'react'
import { Bot } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

/**
 * Le lanceur de l'assistant — espace BOUTIQUE uniquement.
 *
 * ⚠ LE PANNEAU SE CHARGE À LA PREMIÈRE OUVERTURE, ET PAS AVANT.
 *   Le shell monte ce composant sur chaque écran de la boutique. Le panneau,
 *   lui, emporte le modèle (`firebase/ai`), l'attestation App Check, les
 *   contextes clients et transactions et les services d'écriture : importé
 *   ici, il pesait sur le premier affichage de tous, pour un bouton que
 *   beaucoup n'ouvrent pas. Il arrive donc par `lazy`, au premier clic.
 *
 *   Une fois ouvert, il reste MONTÉ — il rend `null` quand on le ferme — pour
 *   que la conversation et une carte en attente survivent à la fermeture.
 */
const PanneauAssistant = lazy(() => import('./assistant/PanneauAssistant.jsx'))

/** Le premier chargement se VOIT : sur un réseau lent, un clic sans effet se redouble. */
function Chargement() {
  return (
    <p
      role="status"
      className="fixed bottom-5 right-5 z-[60] m-0 rounded-full bg-brand-600 px-4 py-3 text-sm font-medium text-white shadow-lg"
    >
      Ouverture de l&apos;assistant…
    </p>
  )
}

function Assistant() {
  const { userProfile, isStoreAdmin } = useAuth()
  const [ouvert, setOuvert] = useState(false)
  const [monte, setMonte] = useState(false)

  // Espace boutique seulement. Le gérant et le dealer n'ont pas d'assistant.
  if (!isStoreAdmin && userProfile?.role !== 'member') return null

  return (
    <>
      {!ouvert && (
        <button
          type="button"
          onClick={() => {
            setMonte(true)
            setOuvert(true)
          }}
          aria-label="Ouvrir l'assistant"
          className="fixed bottom-5 right-5 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2"
        >
          <Bot className="h-6 w-6" aria-hidden="true" />
        </button>
      )}
      {monte && (
        <Suspense fallback={<Chargement />}>
          <PanneauAssistant ouvert={ouvert} onFermer={() => setOuvert(false)} />
        </Suspense>
      )}
    </>
  )
}

export default Assistant
