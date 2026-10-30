import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Mic, Send, Square, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useClients } from '../../hooks/useClients'
import { useTransactions } from '../../context/transactions.jsx'
import { useSimpleNetworkData } from '../../hooks/useSimpleNetworkData'
import { runStoreTransactionCommand } from '../../services/storeTransactionCommandService'
import { generateIdempotencyKey } from '../../services/settlementService.js'
import { NETWORK_OPTIONS } from '../../utils/constants.js'
import { expediteursConnus, ravitaillementsEnCours } from '../../utils/ravitaillement.js'
import { poserQuestion } from '../../lib/ia/assistant.js'
import { analyserMarkdown } from '../../lib/ia/markdown.js'
import { lireGeste, GESTES } from '../../lib/ia/gestes.js'
import { preparerOperation } from '../../lib/ia/preparations.js'
import { demarrerDictee, dicteeDisponible } from '../../lib/ia/dictee.js'
import { CarteAConfirmer } from './CarteAConfirmer.jsx'

/**
 * Le panneau de l'assistant — chargé à la première ouverture (voir
 * components/Assistant.jsx), puis gardé monté.
 *
 * ⚠ Le rendu du balisage passe par `analyserMarkdown` puis par React, qui
 *   échappe. AUCUNE injection de HTML nulle part dans la chaîne : une note
 *   client peut contenir `<img onerror=...>`, et le modèle la répéterait.
 *
 * ⚠ `aller_a` et `proposer_l_ecran` diffèrent par le MOMENT, pas la
 *   destination. Un appel d'outil part AVANT que le modèle ait fini d'écrire :
 *   ouvrir tout de suite escamoterait la réponse. `proposer` pose donc un
 *   bouton sous le texte ; `aller` n'arrive que sur une intention explicite.
 *
 * ⚠ L'ASSISTANT PRÉPARE, LA CAISSIÈRE CONFIRME. Une préparation pose une carte
 *   (preparations.js) ; seul « Confirmer » l'exécute, par les MÊMES fonctions
 *   que les écrans (addTransaction, règlement, commande serveur, corbeille).
 *   Une carte à la fois, effacée à la question suivante : laissée en place,
 *   on confirmerait une opération dont on ne lit plus la demande.
 */

/**
 * Le réseau dont on lit les réserves d'un retour : le premier du profil, celui
 * que le serveur débite (même règle que RavitaillementPanel).
 */
const RESEAU = NETWORK_OPTIONS[0]

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

function PanneauAssistant({ ouvert, onFermer }) {
  const { currentUser, userProfile, activeStore } = useAuth()
  const navigate = useNavigate()

  const [question, setQuestion] = useState('')
  const [tours, setTours] = useState([])
  const [enCours, setEnCours] = useState(false)
  const [attente, setAttente] = useState('')
  const [proposition, setProposition] = useState(null)
  const [carte, setCarte] = useState(null)
  const historiqueRef = useRef([])
  const finRef = useRef(null)
  // Verrou synchrone : deux clics sur « Confirmer » dans le même tick ne
  // doivent pas enregistrer deux fois (même raison que RavitaillementForm).
  const verrouCarte = useRef(false)

  // La dictée : la voix remplit le CHAMP, la caissière relit puis envoie.
  const [ecoute, setEcoute] = useState(false)
  const [erreurDictee, setErreurDictee] = useState('')
  const dicteeRef = useRef(null)
  const champRef = useRef(null)
  const [dicteePossible] = useState(() => dicteeDisponible())

  const couperLeMicro = useCallback(() => {
    dicteeRef.current?.abandonner()
    dicteeRef.current = null
  }, [])

  // Le micro ne survit ni à la fermeture du panneau, ni à son démontage.
  useEffect(() => {
    if (!ouvert) couperLeMicro()
  }, [ouvert, couperLeMicro])
  useEffect(() => couperLeMicro, [couperLeMicro])

  const basculerDictee = useCallback(() => {
    if (dicteeRef.current) {
      dicteeRef.current.terminer()
      return
    }
    setErreurDictee('')
    // Ce qui est dicté s'ajoute à ce qui était déjà tapé, sans l'effacer.
    const debut = question.trim()
    const dictee = demarrerDictee({
      surTexte: (texte) => setQuestion(debut ? `${debut} ${texte}` : texte),
      surErreur: setErreurDictee,
      surFin: () => {
        dicteeRef.current = null
        setEcoute(false)
        champRef.current?.focus()
      },
    })
    if (dictee) {
      dicteeRef.current = dictee
      setEcoute(true)
    }
  }, [question])

  const { clients } = useClients()
  const {
    pendingTransactions = [],
    completedTransactions = [],
    addTransaction,
    addPaymentTranche,
    addRefundTranche,
    trashTransaction,
  } = useTransactions()
  const { validateAmount, getLiquidite, getStock, getNetworkLiquidite } = useSimpleNetworkData()

  // Ce que voient les écrans, au moment où le modèle demande une préparation.
  // Une référence plutôt qu'une dépendance : la question part avec l'état de
  // son envoi, mais la préparation doit juger sur les soldes de l'instant.
  const ravitaillements = useMemo(() => ravitaillementsEnCours(completedTransactions), [completedTransactions])
  const expediteurs = useMemo(() => expediteursConnus(completedTransactions), [completedTransactions])
  const etatRef = useRef(null)
  etatRef.current = {
    clients,
    enAttente: pendingTransactions,
    ravitaillements,
    expediteurs,
    validateAmount,
    liquidite: getLiquidite(),
    disponible: (vase) => (vase === 'stock' ? getStock(RESEAU) : getNetworkLiquidite(RESEAU)),
  }

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: 'end' })
  }, [tours, attente, carte])

  const confirmerCarte = useCallback(async () => {
    if (!carte || verrouCarte.current) return
    verrouCarte.current = true
    setCarte((c) => c && { ...c, envoi: true, erreur: '' })
    try {
      const { execution } = carte
      if (execution.genre === 'transaction') {
        await addTransaction(execution.transactionData)
      } else if (execution.genre === 'reglement') {
        const regler = execution.action === 'rembourser' ? addRefundTranche : addPaymentTranche
        // La clé est celle de la CARTE : un nouvel essai après une panne réseau
        // est reconnu par le serveur comme le même règlement.
        await regler(execution.draftId, execution.montant, execution.moyen, carte.cle, execution.codeAgent)
      } else if (execution.genre === 'commande') {
        await runStoreTransactionCommand(execution.commande)
      } else if (execution.genre === 'corbeille') {
        await trashTransaction(execution.id)
      } else {
        throw new Error(`exécution inconnue : ${execution.genre}`)
      }
      setCarte(null)
      setTours((t) => [...t, { role: 'ia', texte: carte.succes, succes: true }])
    } catch (cause) {
      console.error('[assistant] enregistrement refusé', cause)
      // Le serveur rédige des refus lisibles ; c'est lui qui connaît l'état réel.
      setCarte((c) => c && { ...c, envoi: false, erreur: cause?.message || "L'opération n'a pas pu être enregistrée." })
    } finally {
      verrouCarte.current = false
    }
  }, [carte, addTransaction, addPaymentTranche, addRefundTranche, trashTransaction])

  const envoyer = useCallback(async () => {
    const demande = question.trim()
    if (!demande || enCours) return

    // La proposition du tour précédent s'efface à l'envoi : laissée en place,
    // on lirait une nouvelle réponse avec, dessous, un bouton de l'ancienne.
    // La carte aussi, pour la même raison, et parce qu'on confirmerait alors
    // une opération dont on ne lit plus la demande.
    setProposition(null)
    setCarte(null)
    couperLeMicro()
    setErreurDictee('')
    setQuestion('')
    setEnCours(true)
    setAttente('je réfléchis')
    setTours((t) => [...t, { role: 'moi', texte: demande }, { role: 'ia', texte: '' }])

    let gesteDifferé = null
    let carteDuTour = null

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
        if (geste.geste === GESTES.FERMER) onFermer()
        else if (geste.geste === GESTES.ALLER) gesteDifferé = geste
        else setProposition(geste)
      },
      surPreparation: ({ nom, arguments: args }) => {
        // Une seule carte par tour : deux opérations empilées se confirment à
        // la chaîne sans être relues.
        if (carteDuTour) {
          return {
            erreur: true,
            message: "Une seule opération à la fois : la première carte est affichée. Elle doit être confirmée ou écartée d'abord.",
          }
        }
        const { carte: preparee, reponse } = preparerOperation(nom, args, etatRef.current)
        if (preparee) {
          carteDuTour = preparee
          setCarte({ ...preparee, cle: generateIdempotencyKey(), envoi: false, erreur: '' })
        }
        return reponse
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
  }, [question, enCours, userProfile, currentUser, activeStore, navigate, onFermer, couperLeMicro])

  // Fermé, le panneau reste MONTÉ : la conversation, la carte en attente et
  // l'historique du modèle survivent à la fermeture, comme avant.
  if (!ouvert) return null

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
          onClick={onFermer}
          aria-label="Fermer l'assistant"
          className="rounded p-1 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-white"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 text-sm text-slate-800">
        {tours.length === 0 && (
          <p className="text-slate-500">
            Demandez-moi le bilan du jour, un client, les créances, une opération passée, ou de
            préparer une opération : vous la confirmerez.
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
            ) : tour.succes ? (
              // Écrit par l'application, pas par le modèle : c'est le seul
              // endroit où « enregistré » peut se lire, et il suit l'appel réussi.
              <p role="status" className="rounded-lg bg-success-soft px-3 py-2 font-medium text-success">{tour.texte}</p>
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

        {carte && (
          <CarteAConfirmer carte={carte} onConfirmer={confirmerCarte} onEcarter={() => setCarte(null)} />
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
          ref={champRef}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          disabled={enCours}
          placeholder={ecoute ? 'Je vous écoute…' : 'Votre question…'}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50"
        />
        {dicteePossible && (
          <button
            type="button"
            onClick={basculerDictee}
            disabled={enCours}
            aria-label={ecoute ? 'Arrêter la dictée' : 'Dicter la question'}
            aria-pressed={ecoute}
            className={`rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-40 ${
              ecoute ? 'motion-safe:animate-pulse bg-danger text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {ecoute ? <Square className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}
        <button
          type="submit"
          disabled={enCours || question.trim() === ''}
          aria-label="Envoyer"
          className="rounded-lg bg-brand-600 p-2 text-white hover:bg-brand-700 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
      {erreurDictee && (
        <p role="status" className="m-0 shrink-0 px-3 pb-2 text-xs text-danger">{erreurDictee}</p>
      )}
    </section>
  )
}

export default PanneauAssistant
