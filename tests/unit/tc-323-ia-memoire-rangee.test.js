import { describe, it, expect, beforeEach } from 'vitest'
import { initializeApp } from 'firebase/app'
import { AgentPlatformBackend, getAI, getGenerativeModel } from 'firebase/ai'
import {
  chargerConversations,
  cleDesConversations,
  memoireSansDonnees,
  rangerConversation,
} from '../../src/lib/ia/conversations.js'

/**
 * TC-323 — Le navigateur garde le texte des conversations, pas les données
 * que les outils ont lues.
 *
 * Décision du responsable, 2 novembre 2026 (audit SEC-13, lot C) : la mémoire
 * rangée avec une conversation était l'historique brut du SDK, résultats
 * d'outils compris — jusqu'à cinquante fiches par recherche, numéros
 * personnels inclus. Elle ne garde plus que les questions et les réponses
 * affichées. Une conversation se reprend toujours ; le modèle reconsulte,
 * comme le prompt le lui impose déjà.
 */

const NUMERO_PERSONNEL = '76965827'
const NUMERO_AGENT = '70112233'

const FICHE_BRUTE = Object.freeze({
  nom: 'Souleymane OUEDRAOGO',
  codeAgent: '1234567',
  numeroAgent: NUMERO_AGENT,
  numeroPersonnel: NUMERO_PERSONNEL,
  registeredStoreName: 'Pissy',
})

/** Un échange tel que `getHistory()` le rend : la question, l'appel, le résultat, la réponse. */
function echangeAvecOutil(question, reponse) {
  return [
    { role: 'user', parts: [{ text: question }] },
    {
      role: 'model',
      parts: [
        { text: 'Je regarde. ' },
        { functionCall: { name: 'chercher_client', args: { recherche: 'ouedraogo' } }, thoughtSignature: 'sig-1' },
      ],
    },
    // Le SDK range les résultats d'outils sous le rôle « user ».
    { role: 'user', parts: [{ functionResponse: { name: 'chercher_client', response: { trouves: 1, clients: [FICHE_BRUTE] } } }] },
    { role: 'model', parts: [{ text: reponse }] },
  ]
}

const TOURS = Object.freeze([
  { role: 'moi', texte: 'retrouve ouedraogo' },
  { role: 'ia', texte: 'Souleymane OUEDRAOGO, code 1234567.' },
])

/**
 * Le contrôle même du SDK, celui que passe `startChat` à la reprise.
 *
 * Par l'API publique : firebase 13 n'exporte plus la classe `ChatSession`,
 * seulement son interface. Aucun appel ne part : `startChat` contrôle la
 * mémoire sans joindre le modèle. [MR-08] vérifie que ce contrôle refuse
 * encore une mémoire mal formée, sans quoi les « acceptée » ne prouveraient rien.
 */
const MODELE = getGenerativeModel(
  getAI(initializeApp({ apiKey: 'cle-de-test', projectId: 'demo-tc-323', appId: '1:1:web:1' }, 'tc-323'), {
    backend: new AgentPlatformBackend(),
  }),
  { model: 'gemini-3.5-flash' },
)
const repriseAcceptee = (historique) => () => MODELE.startChat({ history: historique })

describe('TC-323 — la mémoire rangée avec une conversation', () => {
  const CLE = cleDesConversations('u-1', 'b-1')

  beforeEach(() => localStorage.clear())

  it('[MR-01] rangée, elle ne garde ni appel ni résultat d’outil, seulement le texte échangé', () => {
    rangerConversation(CLE, {
      id: 'a',
      tours: TOURS,
      historique: echangeAvecOutil('retrouve ouedraogo', 'Souleymane OUEDRAOGO, code 1234567.'),
    })

    const brut = localStorage.getItem(CLE)
    expect(brut).not.toContain(NUMERO_PERSONNEL)
    expect(brut).not.toContain(NUMERO_AGENT)
    expect(brut).not.toContain('Pissy')
    expect(brut).not.toContain('functionCall')
    expect(brut).not.toContain('functionResponse')
    expect(brut).not.toContain('sig-1')

    expect(chargerConversations(CLE)[0].historique).toEqual([
      { role: 'user', parts: [{ text: 'retrouve ouedraogo' }] },
      { role: 'model', parts: [{ text: 'Je regarde. ' }, { text: 'Souleymane OUEDRAOGO, code 1234567.' }] },
    ])
  })

  it('[MR-02] le SDK accepte la mémoire relue : la conversation se reprend', () => {
    const historique = [
      ...echangeAvecOutil('retrouve ouedraogo', 'Trouvé.'),
      { role: 'user', parts: [{ text: 'et son code ?' }] },
      { role: 'model', parts: [{ text: '1234567.' }] },
    ]
    rangerConversation(CLE, { id: 'a', tours: TOURS, historique })

    const relue = chargerConversations(CLE)[0].historique
    expect(relue.map((c) => c.role)).toEqual(['user', 'model', 'user', 'model'])
    expect(repriseAcceptee(relue)).not.toThrow()
  })

  it('[MR-03] coupée à ses derniers échanges, elle commence par une question et finit par une réponse', () => {
    const longue = Array.from({ length: 30 }, (_, i) => echangeAvecOutil(`question ${i}`, `réponse ${i}`)).flat()
    const memoire = memoireSansDonnees(longue)

    expect(memoire.length).toBeLessThanOrEqual(40)
    expect(memoire[0]).toEqual({ role: 'user', parts: [{ text: expect.stringMatching(/^question \d+$/) }] })
    expect(memoire.at(-1).parts.at(-1)).toEqual({ text: 'réponse 29' })
    expect(repriseAcceptee(memoire)).not.toThrow()
  })

  it('[MR-04] un échange sans réponse écrite (un geste seul) ne laisse ni deux questions de suite ni une question en dernier', () => {
    const fermer = [
      { role: 'user', parts: [{ text: 'ferme' }] },
      { role: 'model', parts: [{ functionCall: { name: 'fermer_l_assistant', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'fermer_l_assistant', response: { fait: true } } }] },
    ]
    const memoire = memoireSansDonnees([...echangeAvecOutil('bilan', 'Voici.'), ...fermer, ...fermer])

    expect(memoire.map((c) => c.role)).toEqual(['user', 'model'])
    expect(repriseAcceptee(memoire)).not.toThrow()
    expect(memoireSansDonnees(fermer)).toEqual([])
  })

  it('[MR-05] la réflexion du modèle ne se range pas', () => {
    const memoire = memoireSansDonnees([
      { role: 'user', parts: [{ text: 'bilan' }] },
      { role: 'model', parts: [{ text: 'je réfléchis au calcul', thought: true }, { text: 'Voici.' }] },
    ])
    expect(memoire).toEqual([
      { role: 'user', parts: [{ text: 'bilan' }] },
      { role: 'model', parts: [{ text: 'Voici.' }] },
    ])
  })

  it('[MR-06] un rangement d’avant la décision est purgé dès sa relecture', () => {
    localStorage.setItem(CLE, JSON.stringify([{
      id: 'ancienne',
      titre: 'retrouve ouedraogo',
      misAJour: 1000,
      tours: TOURS,
      historique: echangeAvecOutil('retrouve ouedraogo', 'Trouvé.'),
    }]))

    const liste = chargerConversations(CLE)
    expect(liste[0].historique.map((c) => c.role)).toEqual(['user', 'model'])
    expect(liste[0].tours).toEqual(TOURS)
    expect(localStorage.getItem(CLE)).not.toContain(NUMERO_PERSONNEL)
    expect(localStorage.getItem(CLE)).not.toContain('functionResponse')
  })

  it('[MR-07] une mémoire illisible devient une mémoire vide, pas une panne', () => {
    expect(memoireSansDonnees(undefined)).toEqual([])
    expect(memoireSansDonnees([null, { role: 'user' }, { role: 'model', parts: 'x' }])).toEqual([])
  })

  it('[MR-08] le contrôle du SDK refuse encore une mémoire mal formée', () => {
    expect(repriseAcceptee([{ role: 'model', parts: [{ text: 'réponse' }] }])).toThrow(/role 'user'/)
    expect(repriseAcceptee([
      { role: 'user', parts: [{ text: 'q1' }] },
      { role: 'user', parts: [{ text: 'q2' }] },
    ])).toThrow(/can't follow/)
  })

  it('[MR-09] l’historique typé de firebase 13 se range de même, et se reprend', () => {
    // Depuis firebase 13, `getHistory()` rend des parts discriminées par `type`.
    const typee = [
      { role: 'user', parts: [{ type: 'text', text: 'retrouve ouedraogo' }] },
      {
        role: 'model',
        parts: [
          { type: 'text', text: 'je cherche dans la base', thought: true },
          { type: 'text', text: 'Je regarde. ' },
          { type: 'functionCall', functionCall: { name: 'chercher_client', args: { recherche: 'ouedraogo' } }, thoughtSignature: 'sig-1' },
        ],
      },
      { role: 'user', parts: [{ type: 'functionResponse', functionResponse: { name: 'chercher_client', response: { clients: [FICHE_BRUTE] } } }] },
      { role: 'model', parts: [{ type: 'text', text: 'Trouvé.' }] },
    ]
    rangerConversation(CLE, { id: 'a', tours: TOURS, historique: typee })

    const brut = localStorage.getItem(CLE)
    expect(brut).not.toContain(NUMERO_PERSONNEL)
    expect(brut).not.toContain('je cherche dans la base')
    const relue = chargerConversations(CLE)[0].historique
    expect(relue).toEqual([
      { role: 'user', parts: [{ text: 'retrouve ouedraogo' }] },
      { role: 'model', parts: [{ text: 'Je regarde. ' }, { text: 'Trouvé.' }] },
    ])
    expect(repriseAcceptee(relue)).not.toThrow()
  })
})
