import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { analyserMarkdown, texteEnCoursDEcriture } from '../../src/lib/ia/markdown.js'
import { pasDEcriture } from '../../src/components/assistant/useTexteProgressif.js'
import {
  CONVERSATIONS_MAX,
  chargerConversations,
  cleDesConversations,
  dateLisible,
  effacerConversations,
  rangerConversation,
  titreDe,
} from '../../src/lib/ia/conversations.js'

/**
 * TC-313 — Ce que l'assistant affiche, et ce qu'il garde.
 *
 * Demandes du responsable (30 octobre 2026), après le premier essai réel :
 * les « ### » s'affichaient, les réponses tombaient « en vrac », et il
 * voulait un historique des conversations.
 */

describe('TC-313 — le balisage', () => {
  it('[TX-01] un titre « ### » devient un titre, sans ses dièses', () => {
    expect(analyserMarkdown('### Répartition par type :')).toEqual([
      { type: 'titre', fragments: [{ gras: false, texte: 'Répartition par type :' }] },
    ])
    expect(analyserMarkdown('## **Bilan**')[0].fragments).toEqual([{ gras: false, texte: 'Bilan' }])
  })

  it('[TX-02] une liste numérotée reste numérotée, distincte d’une liste à puces', () => {
    const blocs = analyserMarkdown('1. ouvrir\n2. encaisser\n- puce')
    expect(blocs.map((b) => [b.type, b.ordonnee, b.elements.length])).toEqual([
      ['liste', true, 2],
      ['liste', false, 1],
    ])
  })

  it('[TX-03] pendant l’écriture, un gras pas encore fermé ne montre pas ses astérisques', () => {
    expect(texteEnCoursDEcriture('Total **15 0')).toBe('Total 15 0')
    expect(texteEnCoursDEcriture('un **gras** fini')).toBe('un **gras** fini')
    expect(texteEnCoursDEcriture('Voici\n###')).toBe('Voici\n')
  })
})

describe('TC-313 — la vitesse d’écriture', () => {
  it('[TX-04] lettre par lettre, et plus vite seulement quand la réponse prend de l’avance', () => {
    expect(pasDEcriture(0)).toBe(0)
    expect(pasDEcriture(10)).toBe(1)
    expect(pasDEcriture(100)).toBe(2)
    expect(pasDEcriture(1200)).toBe(10)
  })
})

describe('TC-313 — l’historique des conversations', () => {
  const CLE = cleDesConversations('u-1', 'b-1')
  const tours = (question) => [
    { role: 'moi', texte: question },
    { role: 'ia', texte: 'Voici le bilan.', vivant: true },
  ]

  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('[HI-01] rangé par personne et par boutique', () => {
    expect(CLE).toBe('c2egf.assistant.v1.u-1.b-1')
    expect(cleDesConversations(undefined, undefined)).toBe('c2egf.assistant.v1.anonyme.boutique')
  })

  it('[HI-02] se range et se relit, la plus récente en tête, sans ce qui ne sert qu’à l’écran', () => {
    rangerConversation(CLE, { id: 'a', tours: tours('premier') }, 1000)
    // La mémoire du modèle se range avec, réduite à ses textes (TC-323).
    const memoire = [
      { role: 'user', parts: [{ text: 'second' }] },
      { role: 'model', parts: [{ text: 'Voici le bilan.' }] },
    ]
    rangerConversation(CLE, { id: 'b', tours: tours('second'), historique: memoire }, 2000)

    const liste = chargerConversations(CLE)
    expect(liste.map((c) => c.id)).toEqual(['b', 'a'])
    expect(liste[0]).toMatchObject({ titre: 'second', misAJour: 2000, historique: memoire })
    expect(liste[0].tours[1]).toEqual({ role: 'ia', texte: 'Voici le bilan.' })
  })

  it('[HI-03] une conversation reprise remonte en tête, sans doublon', () => {
    rangerConversation(CLE, { id: 'a', tours: tours('premier') }, 1000)
    rangerConversation(CLE, { id: 'b', tours: tours('second') }, 2000)
    rangerConversation(CLE, { id: 'a', tours: [...tours('premier'), { role: 'moi', texte: 'et hier ?' }] }, 3000)
    expect(chargerConversations(CLE).map((c) => c.id)).toEqual(['a', 'b'])
  })

  it(`[HI-04] ${CONVERSATIONS_MAX} conversations au plus`, () => {
    for (let i = 0; i < CONVERSATIONS_MAX + 5; i += 1) rangerConversation(CLE, { id: `c${i}`, tours: tours(`q${i}`) }, i)
    const liste = chargerConversations(CLE)
    expect(liste).toHaveLength(CONVERSATIONS_MAX)
    expect(liste[0].id).toBe(`c${CONVERSATIONS_MAX + 4}`)
  })

  it('[HI-05] une conversation vide ne se range pas', () => {
    expect(rangerConversation(CLE, { id: 'vide', tours: [{ role: 'ia', texte: '' }] })).toEqual([])
    expect(chargerConversations(CLE)).toEqual([])
  })

  it('[HI-06] stockage plein : on jette la plus ancienne et on réessaie', () => {
    rangerConversation(CLE, { id: 'a', tours: tours('ancienne') }, 1000)
    const vrai = Storage.prototype.setItem
    let essais = 0
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (cle, valeur) {
      essais += 1
      if (essais === 1) throw new Error('QuotaExceededError')
      return vrai.call(this, cle, valeur)
    })
    const liste = rangerConversation(CLE, { id: 'b', tours: tours('nouvelle') }, 2000)
    expect(liste.map((c) => c.id)).toEqual(['b'])
  })

  it('[HI-07] un rangement illisible ne casse rien', () => {
    localStorage.setItem(CLE, '{pas du json')
    expect(chargerConversations(CLE)).toEqual([])
  })

  it('[HI-08] tout effacer', () => {
    rangerConversation(CLE, { id: 'a', tours: tours('x') })
    expect(effacerConversations(CLE)).toEqual([])
    expect(chargerConversations(CLE)).toEqual([])
  })

  it('[HI-09] le titre est la première question, coupée proprement', () => {
    expect(titreDe([{ role: 'moi', texte: '  fais   le point  ' }])).toBe('fais le point')
    expect(titreDe([{ role: 'moi', texte: 'x'.repeat(80) }])).toHaveLength(60)
    expect(titreDe([])).toBe('Conversation')
  })

  it('[HI-10] la date se lit d’un coup d’œil', () => {
    const maintenant = new Date(2026, 9, 30, 15, 0).getTime()
    expect(dateLisible(new Date(2026, 9, 30, 14, 5).getTime(), maintenant)).toBe("aujourd'hui 14:05")
    expect(dateLisible(new Date(2026, 9, 29, 9, 30).getTime(), maintenant)).toBe('hier 09:30')
    expect(dateLisible(new Date(2026, 9, 20, 9, 30).getTime(), maintenant)).toBe('20/10')
  })
})
