import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUp, History, Mic, Plus, Sparkles, Square, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useClients } from '../../hooks/useClients'
import { useTransactions } from '../../context/transactions.jsx'
import { useSimpleNetworkData } from '../../hooks/useSimpleNetworkData'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { runStoreTransactionCommand } from '../../services/storeTransactionCommandService'
import { generateIdempotencyKey } from '../../services/settlementService.js'
import { NETWORK_OPTIONS } from '../../utils/constants.js'
import { expediteursConnus, ravitaillementsEnCours } from '../../utils/ravitaillement.js'
import { poserQuestion } from '../../lib/ia/assistant.js'
import { analyserMarkdown, texteEnCoursDEcriture } from '../../lib/ia/markdown.js'
import { lireGeste, GESTES } from '../../lib/ia/gestes.js'
import { preparerOperation } from '../../lib/ia/preparations.js'
import { lireLaCaisse, OUTILS_DU_PANNEAU } from '../../lib/ia/caisse.js'
import { demarrerDictee, dicteeDisponible } from '../../lib/ia/dictee.js'
import {
  chargerConversations,
  cleDesConversations,
  dateLisible,
  effacerConversations,
  nouvelIdentifiant,
  rangerConversation,
} from '../../lib/ia/conversations.js'
import { CarteAConfirmer } from './CarteAConfirmer.jsx'
import { useTexteProgressif } from './useTexteProgressif.js'

/**
 * Le panneau de l'assistant — chargé à la première ouverture (voir
 * components/Assistant.jsx), puis gardé monté.
 *
 * UN VOLET SUR TOUTE LA HAUTEUR, À DROITE. En tête : « Assistant », la
 * boutique servie, et trois gestes — nouvelle conversation, historique,
 * fermer. Vide, il salue et propose des questions toutes faites.
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

/**
 * Le volet glisse, il n'apparaît pas d'un coup. Assez lent pour qu'on voie
 * d'où il vient et où il repart, assez court pour ne pas faire attendre.
 */
const GLISSEMENT_MS = 300

/** Les questions toutes faites de l'accueil : ce qu'on demande le plus au comptoir. */
export const SUGGESTIONS = Object.freeze([
  'Fais le point de la journée',
  "Qui me doit encore de l'argent ?",
  'Les opérations de la semaine',
  'Comment encaisser un dépôt à distance ?',
])

function Fragments({ fragments }) {
  return fragments.map((f, i) =>
    f.gras ? <strong key={i} className="font-semibold text-slate-900">{f.texte}</strong> : <span key={i}>{f.texte}</span>,
  )
}

function Texte({ contenu }) {
  return analyserMarkdown(contenu).map((bloc, index) => {
    if (bloc.type === 'titre') {
      return (
        <p key={index} className="mb-1 mt-4 text-[15px] font-semibold text-slate-900 first:mt-0">
          <Fragments fragments={bloc.fragments} />
        </p>
      )
    }
    if (bloc.type === 'liste') {
      const Liste = bloc.ordonnee ? 'ol' : 'ul'
      return (
        <Liste key={index} className={`my-2 space-y-1 pl-5 ${bloc.ordonnee ? 'list-decimal' : 'list-disc'} marker:text-slate-400`}>
          {bloc.elements.map((fragments, rang) => (
            <li key={rang} className="pl-1">
              <Fragments fragments={fragments} />
            </li>
          ))}
        </Liste>
      )
    }
    return (
      <p key={index} className="my-2 first:mt-0 last:mb-0">
        <Fragments fragments={bloc.fragments} />
      </p>
    )
  })
}

/** Une réponse de l'assistant ; celle qu'on reçoit s'écrit lettre par lettre. */
function ReponseIA({ texte, vivante, surAvance }) {
  const { texte: visible, fini } = useTexteProgressif(texte, vivante, surAvance)
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600" aria-hidden="true">
        <Sparkles className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 text-[15px] leading-relaxed text-slate-700">
        <Texte contenu={fini ? visible : texteEnCoursDEcriture(visible)} />
      </div>
    </div>
  )
}

function Accueil({ nom, onChoisir, desactive }) {
  return (
    <div className="flex h-full flex-col justify-center pb-8">
      <p className="m-0 text-2xl font-semibold text-slate-900">Bonjour{nom ? ` ${nom}` : ''}.</p>
      <p className="m-0 mt-1 text-sm text-slate-500">
        Posez une question, ou demandez-moi de préparer une opération : vous la confirmerez.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onChoisir(suggestion)}
            disabled={desactive}
            className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-left text-sm text-slate-800 transition-colors hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  )
}

function ListeDesConversations({ conversations, courante, onOuvrir, onEffacer }) {
  const [confirmer, setConfirmer] = useState(false)
  if (conversations.length === 0) {
    return <p className="m-0 mt-2 text-sm text-slate-500">Aucune conversation pour l&apos;instant.</p>
  }
  return (
    <div>
      <p className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Conversations</p>
      <ul className="m-0 list-none space-y-1 p-0">
        {conversations.map((conversation) => (
          <li key={conversation.id}>
            <button
              type="button"
              onClick={() => onOuvrir(conversation)}
              aria-current={conversation.id === courante ? 'true' : undefined}
              className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                conversation.id === courante ? 'bg-brand-50' : 'hover:bg-slate-50'
              }`}
            >
              <span className="block truncate text-sm font-medium text-slate-900">{conversation.titre}</span>
              <span className="block text-xs text-slate-500">{dateLisible(conversation.misAJour)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-slate-200 pt-3">
        {confirmer ? (
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-600">Tout effacer sur cet appareil ?</span>
            <button type="button" onClick={onEffacer} className="rounded-md bg-danger px-3 py-1 font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
              Effacer
            </button>
            <button type="button" onClick={() => setConfirmer(false)} className="rounded-md border border-slate-300 px-3 py-1 text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
              Garder
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmer(true)} className="text-sm text-slate-500 underline-offset-2 hover:text-danger hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            Effacer l&apos;historique
          </button>
        )}
      </div>
    </div>
  )
}

const BOUTON_TETE =
  'flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400'

function PanneauAssistant({ ouvert, onFermer }) {
  const { currentUser, userProfile, activeStore } = useAuth()
  const navigate = useNavigate()

  const nomAffiche =
    userProfile?.name || userProfile?.displayName || currentUser?.displayName || currentUser?.email?.split('@')[0] || ''
  const boutique = activeStore?.name || userProfile?.storeName || ''

  const [question, setQuestion] = useState('')
  const [tours, setTours] = useState([])
  const [enCours, setEnCours] = useState(false)
  const [attente, setAttente] = useState('')
  const [proposition, setProposition] = useState(null)
  const [carte, setCarte] = useState(null)
  const historiqueRef = useRef([])
  const zoneRef = useRef(null)
  // Verrou synchrone : deux clics sur « Confirmer » dans le même tick ne
  // doivent pas enregistrer deux fois (même raison que RavitaillementForm).
  const verrouCarte = useRef(false)

  // L'historique des conversations, rangé par personne et par boutique.
  const cleRangement = cleDesConversations(currentUser?.uid, activeStore?.id || userProfile?.storeId)
  const [vue, setVue] = useState('conversation')
  const [conversationId, setConversationId] = useState(nouvelIdentifiant)
  const [conversations, setConversations] = useState(() => chargerConversations(cleRangement))

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

  /**
   * LE VOLET GLISSE, À L'ALLER COMME AU RETOUR.
   *
   * `present` : il est dans la page. `deploye` : il est à l'écran. Entre les
   * deux, il glisse. Rendre `null` dès la fermeture le faisait disparaître
   * d'un coup — « brusque », a dit la caissière ; il reste donc dans la page
   * le temps de sortir, puis s'en va.
   *
   * ⚠ À l'ouverture, il faut que le navigateur ait VU le volet hors de l'écran
   *   avant de l'y faire entrer : sinon les deux états tombent dans la même
   *   image et rien ne glisse. La lecture de sa position l'y oblige.
   *
   * « Mouvement réduit » : ni glissement (`motion-reduce:`), ni attente.
   */
  const mouvementReduit = useReducedMotion()
  const voletRef = useRef(null)
  const [present, setPresent] = useState(ouvert)
  const [deploye, setDeploye] = useState(false)

  useLayoutEffect(() => {
    if (ouvert) {
      setPresent(true)
      return
    }
    setDeploye(false)
    if (mouvementReduit) setPresent(false)
  }, [ouvert, mouvementReduit])

  useLayoutEffect(() => {
    if (!present || !ouvert || deploye) return
    voletRef.current?.getBoundingClientRect()
    setDeploye(true)
  }, [present, ouvert, deploye])

  useEffect(() => {
    if (ouvert || !present || mouvementReduit) return undefined
    const sortie = setTimeout(() => setPresent(false), GLISSEMENT_MS)
    return () => clearTimeout(sortie)
  }, [ouvert, present, mouvementReduit])

  // À l'ouverture, on peut taper tout de suite — dès que le volet est rendu
  // (`present`) : à la réouverture, il ne l'est qu'au rendu suivant.
  // `preventScroll` : il entre par la droite, la page n'a pas à le suivre.
  useEffect(() => {
    if (ouvert && present) champRef.current?.focus({ preventScroll: true })
  }, [ouvert, present])

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
  const { networkData = {}, validateAmount, getLiquidite, getStock, getNetworkLiquidite } = useSimpleNetworkData()

  // Les soldes PAR RÉSEAU, tels que le serveur les jugera : les réseaux du
  // profil et ceux du document. ⚠ Sans la carte « Liquidite » que
  // `networkData` ajoute : elle est déjà la somme des autres, et la recompter
  // doublerait les espèces.
  const soldes = Object.fromEntries(
    [...new Set([...NETWORK_OPTIONS, ...Object.keys(networkData).filter((reseau) => reseau !== 'Liquidite')])]
      .map((reseau) => [reseau, { stock: getStock(reseau), liquidite: getNetworkLiquidite(reseau) }]),
  )

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
    soldes,
  }

  /**
   * Suivre le bas pendant que le texte s'écrit — mais SEULEMENT si on y est
   * déjà. Quelqu'un qui remonte relire un chiffre ne doit pas être ramené de
   * force à chaque lettre.
   */
  const suivreLeBas = useCallback((force = false) => {
    const zone = zoneRef.current
    if (!zone) return
    const presDuBas = zone.scrollHeight - zone.scrollTop - zone.clientHeight < 120
    if (force || presDuBas) zone.scrollTop = zone.scrollHeight
  }, [])

  useEffect(() => {
    suivreLeBas(true)
  }, [tours.length, attente, carte, proposition, suivreLeBas])

  // Chaque échange terminé se range ; une réponse en cours, jamais.
  useEffect(() => {
    if (enCours || tours.length === 0) return
    setConversations(rangerConversation(cleRangement, {
      id: conversationId,
      tours,
      historique: historiqueRef.current,
    }))
  }, [tours, enCours, conversationId, cleRangement])

  const confirmerCarte = useCallback(async () => {
    if (!carte || verrouCarte.current) return

    // La caisse a pu bouger entre la carte et le clic — un retrait payé à
    // l'autre poste, des espèces sorties. On rejuge donc la MÊME demande sur
    // l'état de l'instant : un refus se lit sur la carte, avec sa raison,
    // au lieu de partir au serveur pour revenir en « la transaction a échoué ».
    if (carte.demande) {
      const encore = preparerOperation(carte.demande.nom, carte.demande.arguments, etatRef.current)
      const inchangee = encore.carte && JSON.stringify(encore.carte.execution) === JSON.stringify(carte.execution)
      if (!inchangee) {
        const raison = encore.reponse?.erreur
          ? encore.reponse.message
          : "L'opération a changé depuis la préparation : redemandez-la pour la relire."
        setCarte((c) => c && { ...c, envoi: false, erreur: raison })
        return
      }
    }

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

  const envoyer = useCallback(async (texteImpose) => {
    const demande = (typeof texteImpose === 'string' ? texteImpose : question).trim()
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
    setVue('conversation')
    setEnCours(true)
    setAttente('je réfléchis')
    setTours((t) => [...t, { role: 'moi', texte: demande }, { role: 'ia', texte: '', vivant: true }])

    let gesteDifferé = null
    let carteDuTour = null

    const resultat = await poserQuestion({
      question: demande,
      historique: historiqueRef.current,
      contexte: {
        nom: nomAffiche,
        boutique,
        role: userProfile?.role,
      },
      surTexte: (morceau) => {
        setAttente('')
        setTours((t) => {
          const copie = [...t]
          const dernier = copie[copie.length - 1]
          copie[copie.length - 1] = { ...dernier, texte: (dernier?.texte ?? '') + morceau }
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
          setCarte({ ...preparee, demande: { nom, arguments: args }, cle: generateIdempotencyKey(), envoi: false, erreur: '' })
        }
        return reponse
      },
      surLecture: ({ nom }) => (OUTILS_DU_PANNEAU.includes(nom)
        ? lireLaCaisse(etatRef.current)
        : { erreur: true, message: `Je ne sais pas lire « ${nom} ».` }),
    })

    if (resultat.ok) historiqueRef.current = resultat.historique ?? []
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

    // Même `aller_a` attend la fin du texte : l'écran ne change pas pendant
    // qu'on lit.
    if (gesteDifferé) navigate(gesteDifferé.chemin)
  }, [question, enCours, nomAffiche, boutique, userProfile, navigate, onFermer, couperLeMicro])

  /** Repartir d'une page blanche ; la conversation quittée est déjà rangée. */
  const nouvelleConversation = useCallback(() => {
    if (enCours) return
    couperLeMicro()
    setTours([])
    historiqueRef.current = []
    setCarte(null)
    setProposition(null)
    setQuestion('')
    setErreurDictee('')
    setConversationId(nouvelIdentifiant())
    setVue('conversation')
    champRef.current?.focus()
  }, [enCours, couperLeMicro])

  const ouvrirConversation = useCallback((conversation) => {
    if (enCours) return
    couperLeMicro()
    setTours(conversation.tours)
    historiqueRef.current = conversation.historique ?? []
    setCarte(null)
    setProposition(null)
    setConversationId(conversation.id)
    setVue('conversation')
  }, [enCours, couperLeMicro])

  const effacerHistorique = useCallback(() => {
    setConversations(effacerConversations(cleRangement))
    nouvelleConversation()
  }, [cleRangement, nouvelleConversation])

  // Fermé, le panneau reste MONTÉ : la conversation, la carte en attente et
  // l'historique du modèle survivent à la fermeture. Seul son rendu s'en va,
  // une fois sorti de l'écran.
  if (!present) return null

  return (
    <>
      {/* Le fond s'assombrit : on est dans l'assistant. Un clic dehors le ferme. */}
      <div
        aria-hidden="true"
        onClick={onFermer}
        className={`fixed inset-0 z-[59] bg-slate-900/40 transition-opacity duration-300 motion-reduce:transition-none ${
          deploye ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* En sortie, il est encore là mais plus à soi : `inert` lui retire le
          clavier et la lecture d'écran, pour qu'on ne tape pas dans un volet
          qui s'en va. */}
      <section
        ref={voletRef}
        aria-label="Assistant"
        inert={!ouvert}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onFermer()
        }}
        className={`fixed inset-y-0 right-0 z-[60] flex w-full flex-col bg-white shadow-2xl transition-transform duration-300 motion-reduce:transition-none sm:w-[30rem] lg:w-[36rem] ${
          deploye ? 'translate-x-0 ease-out' : 'translate-x-full ease-in'
        }`}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="m-0 flex items-center gap-2 text-lg font-semibold text-slate-900">
              <Sparkles className="h-5 w-5 text-brand-600" aria-hidden="true" />
              Assistant
            </p>
            {boutique && <p className="m-0 mt-0.5 truncate text-sm text-slate-500">{boutique}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={nouvelleConversation} disabled={enCours} aria-label="Nouvelle conversation" title="Nouvelle conversation" className={BOUTON_TETE}>
              <Plus className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setVue((v) => (v === 'historique' ? 'conversation' : 'historique'))}
              disabled={enCours}
              aria-label="Historique des conversations"
              aria-pressed={vue === 'historique'}
              title="Historique des conversations"
              className={`${BOUTON_TETE} ${vue === 'historique' ? 'bg-slate-100 text-slate-900' : ''}`}
            >
              <History className="h-5 w-5" aria-hidden="true" />
            </button>
            <button type="button" onClick={onFermer} aria-label="Fermer l'assistant" title="Fermer" className={BOUTON_TETE}>
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div ref={zoneRef} className="flex-1 overflow-y-auto px-5 py-5">
          {vue === 'historique' ? (
            <ListeDesConversations
              conversations={conversations}
              courante={conversationId}
              onOuvrir={ouvrirConversation}
              onEffacer={effacerHistorique}
            />
          ) : tours.length === 0 ? (
            <Accueil nom={nomAffiche} onChoisir={envoyer} desactive={enCours} />
          ) : (
            <div className="space-y-5">
              {tours.map((tour, index) => {
                if (tour.role === 'moi') {
                  return (
                    <div key={index} className="flex justify-end">
                      <p className="m-0 max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-slate-100 px-4 py-2.5 text-[15px] text-slate-900">
                        {tour.texte}
                      </p>
                    </div>
                  )
                }
                if (tour.panne) {
                  return (
                    <p key={index} className="m-0 rounded-xl bg-amber-50 px-4 py-3 text-[15px] text-amber-900">{tour.texte}</p>
                  )
                }
                if (tour.succes) {
                  // Écrit par l'application, pas par le modèle : c'est le seul
                  // endroit où « enregistré » peut se lire, et il suit l'appel réussi.
                  return (
                    <p key={index} role="status" className="m-0 rounded-xl bg-success-soft px-4 py-3 text-[15px] font-medium text-success">
                      {tour.texte}
                    </p>
                  )
                }
                if (!tour.texte) return null
                return (
                  <ReponseIA
                    key={index}
                    texte={tour.texte}
                    vivante={Boolean(tour.vivant) && index === tours.length - 1}
                    surAvance={suivreLeBas}
                  />
                )
              })}

              {attente && (
                <p aria-live="polite" className="m-0 flex items-center gap-3 text-sm text-slate-500">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-brand-600" aria-hidden="true">
                    <Sparkles className="h-4 w-4 motion-safe:animate-pulse" />
                  </span>
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
                  className="ml-10 rounded-full border border-brand-300 px-4 py-1.5 text-sm text-brand-700 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  Voir {proposition.libelle}
                </button>
              )}

              {carte && (
                <div className="ml-10">
                  <CarteAConfirmer carte={carte} onConfirmer={confirmerCarte} onEcarter={() => setCarte(null)} />
                </div>
              )}
            </div>
          )}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            envoyer()
          }}
          className="shrink-0 px-4 pb-4 pt-2"
        >
          <div className="flex items-center gap-1 rounded-2xl border border-slate-300 bg-white py-1.5 pl-2 pr-1.5 shadow-sm focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500">
            {dicteePossible && (
              <button
                type="button"
                onClick={basculerDictee}
                disabled={enCours}
                aria-label={ecoute ? 'Arrêter la dictée' : 'Dicter la question'}
                aria-pressed={ecoute}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-40 ${
                  ecoute ? 'motion-safe:animate-pulse bg-danger text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {ecoute ? <Square className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-5 w-5" aria-hidden="true" />}
              </button>
            )}
            <label htmlFor="assistant-question" className="sr-only">
              Votre question
            </label>
            <input
              id="assistant-question"
              ref={champRef}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              disabled={enCours}
              placeholder={ecoute ? 'Je vous écoute…' : 'Posez votre question…'}
              autoComplete="off"
              className="min-w-0 flex-1 border-0 bg-transparent px-2 py-2 text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:text-slate-400"
            />
            <button
              type="submit"
              disabled={enCours || question.trim() === ''}
              aria-label="Envoyer"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <ArrowUp className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          {erreurDictee && (
            <p role="status" className="m-0 mt-2 px-1 text-xs text-danger">{erreurDictee}</p>
          )}
        </form>
      </section>
    </>
  )
}

export default PanneauAssistant
