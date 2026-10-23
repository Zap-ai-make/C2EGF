import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Send, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { poserQuestion } from '../lib/ia/assistant.js'
import { analyserMarkdown } from '../lib/ia/markdown.js'
import { lireGeste, GESTES } from '../lib/ia/gestes.js'

/**
 * Le panneau de l'assistant — espace BOUTIQUE uniquement.
 *
 * ⚠ Le rendu du balisage passe par `analyserMarkdown` puis par React, qui
 *   échappe. AUCUNE injection de HTML nulle part dans la chaîne : une note
 *   client peut contenir `<img onerror=...>`, et le modèle la répéterait.
 *
 * ⚠ `aller_a` et `proposer_l_ecran` diffèrent par le MOMENT, pas la
 *   destination. Un appel d'outil part AVANT que le modèle ait fini d'écrire :
 *   ouvrir tout de suite escamoterait la réponse. `proposer` pose donc un
 *   bouton sous le texte ; `aller` n'arrive que sur une intention explicite.
 */

function Texte({ contenu }) {
  const blocs = analyserMarkdown(contenu)
  return (
    <>
      {blocs.map((bloc, index) =>
        bloc.type === 'liste' ? (
          <ul key={index} className="my-1 list-disc space-y-0.5 pl-5">
            {bloc.elements.map((fragments, rang) => (
              <li key={rang}>
                {fragments.map((f, i) =>
                  f.gras ? <strong key={i}>{f.texte}</strong> : <span key={i}>{f.texte}</span>,
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p key={index} className="my-1">
            {bloc.fragments.map((f, i) =>
              f.gras ? <strong key={i}>{f.texte}</strong> : <span key={i}>{f.texte}</span>,
            )}
          </p>
        ),
      )}
    </>
  )
}

function Assistant() {
  const { currentUser, userProfile, activeStore, isStoreAdmin } = useAuth()
  const navigate = useNavigate()

  const [ouvert, setOuvert] = useState(false)
  const [question, setQuestion] = useState('')
  const [tours, setTours] = useState([])
  const [enCours, setEnCours] = useState(false)
  const [attente, setAttente] = useState('')
  const [proposition, setProposition] = useState(null)
  const historiqueRef = useRef([])
  const finRef = useRef(null)

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: 'end' })
  }, [tours, attente])

  const envoyer = useCallback(async () => {
    const demande = question.trim()
    if (!demande || enCours) return

    // La proposition du tour précédent s'efface à l'envoi : laissée en place,
    // on lirait une nouvelle réponse avec, dessous, un bouton de l'ancienne.
    setProposition(null)
    setQuestion('')
    setEnCours(true)
    setAttente('je réfléchis')
    setTours((t) => [...t, { role: 'moi', texte: demande }, { role: 'ia', texte: '' }])

    let gesteDifferé = null

    const resultat = await poserQuestion({
      question: demande,
      historique: historiqueRef.current,
      contexte: {
        nom: userProfile?.displayName || currentUser?.email?.split('@')[0],
        boutique: activeStore?.name,
        role: userProfile?.role,
      },
      surTexte: (morceau) => {
        setAttente('')
        setTours((t) => {
          const copie = [...t]
          copie[copie.length - 1] = {
            role: 'ia',
            texte: (copie[copie.length - 1]?.texte ?? '') + morceau,
          }
          return copie
        })
      },
      surOutil: (libelle) => setAttente(libelle),
      surGeste: ({ nom, arguments: args }) => {
        const geste = lireGeste(nom, args)
        if (!geste.ok) {
          console.warn('[assistant] geste refusé —', geste.raison)
          return
        }
        if (geste.geste === GESTES.FERMER) setOuvert(false)
        else if (geste.geste === GESTES.ALLER) gesteDifferé = geste
        else setProposition(geste)
      },
    })

    setAttente('')
    setEnCours(false)

    if (!resultat.ok) {
      setTours((t) => {
        const copie = [...t]
        copie[copie.length - 1] = { role: 'ia', texte: resultat.message, panne: true }
        return copie
      })
      return
    }

    historiqueRef.current = resultat.historique ?? []
    // Même `aller_a` attend la fin du texte : l'écran ne change pas pendant
    // qu'on lit.
    if (gesteDifferé) navigate(gesteDifferé.chemin)
  }, [question, enCours, userProfile, currentUser, activeStore, navigate])

  // Espace boutique seulement. Le gérant et le dealer n'ont pas d'assistant.
  if (!isStoreAdmin && userProfile?.role !== 'member') return null

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        aria-label="Ouvrir l'assistant"
        className="fixed bottom-5 right-5 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2"
      >
        <Bot className="h-6 w-6" aria-hidden="true" />
      </button>
    )
  }

  return (
    <section
      aria-label="Assistant"
      className="fixed bottom-0 right-0 z-[60] flex h-[min(34rem,85vh)] w-full flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:bottom-5 sm:right-5 sm:w-[24rem] sm:rounded-2xl"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 rounded-t-2xl bg-brand-600 px-4 py-3 text-white">
        <span className="flex items-center gap-2 font-semibold">
          <Bot className="h-5 w-5" aria-hidden="true" />
          Assistant
        </span>
        <button
          type="button"
          onClick={() => setOuvert(false)}
          aria-label="Fermer l'assistant"
          className="rounded p-1 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-white"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 text-sm text-slate-800">
        {tours.length === 0 && (
          <p className="text-slate-500">
            Demandez-moi le bilan du jour, un client, les créances, ou une opération passée.
          </p>
        )}

        {tours.map((tour, index) => (
          <div
            key={index}
            className={
              tour.role === 'moi'
                ? 'my-2 ml-auto max-w-[85%] rounded-2xl bg-brand-50 px-3 py-2'
                : 'my-2 max-w-[92%]'
            }
          >
            {tour.role === 'ia' && tour.panne ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">{tour.texte}</p>
            ) : (
              <Texte contenu={tour.texte} />
            )}
          </div>
        ))}

        {attente && (
          <p aria-live="polite" className="my-2 italic text-slate-500">
            {attente}…
          </p>
        )}

        {proposition && (
          <button
            type="button"
            onClick={() => {
              navigate(proposition.chemin)
              setProposition(null)
            }}
            className="my-2 rounded-lg border border-brand-300 px-3 py-1.5 text-brand-700 hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-400"
          >
            Voir {proposition.libelle}
          </button>
        )}

        <div ref={finRef} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          envoyer()
        }}
        className="flex shrink-0 items-center gap-2 border-t border-slate-200 px-3 py-2"
      >
        <label htmlFor="assistant-question" className="sr-only">
          Votre question
        </label>
        <input
          id="assistant-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          disabled={enCours}
          placeholder="Votre question…"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={enCours || question.trim() === ''}
          aria-label="Envoyer"
          className="rounded-lg bg-brand-600 p-2 text-white hover:bg-brand-700 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
    </section>
  )
}

export default Assistant
