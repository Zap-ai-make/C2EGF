import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { demarrerDictee, dicteeDisponible, messageDErreurDictee } from '../../src/lib/ia/dictee.js'

/**
 * TC-310 — La dictée : la voix va dans le champ, et le micro se coupe.
 *
 * Le moteur du navigateur est simulé : on vérifie ce que NOTRE code en fait —
 * le réglage demandé, le texte rendu, les erreurs dites, et surtout que le
 * micro se coupe et que rien n'est écrit après un abandon.
 */

let instance
class MoteurSimule {
  constructor() {
    instance = this
    this.start = vi.fn()
    this.stop = vi.fn()
    this.abort = vi.fn()
  }
}

const fenetre = { webkitSpeechRecognition: MoteurSimule }
const resultats = (...phrases) => ({ results: phrases.map((p) => [{ transcript: p }]) })

let console_
beforeEach(() => {
  instance = null
  console_ = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => console_.mockRestore())

describe('TC-310 — la dictée', () => {
  it('[DI-01] indisponible : ni bouton ni dictée', () => {
    expect(dicteeDisponible({})).toBe(false)
    expect(demarrerDictee({ fenetre: {} })).toBeNull()
    expect(dicteeDisponible(fenetre)).toBe(true)
  })

  it('[DI-02] écoute une phrase en français, et montre ce qu’elle entend en cours', () => {
    demarrerDictee({ fenetre })
    expect(instance.lang).toBe('fr-FR')
    expect(instance.interimResults).toBe(true)
    expect(instance.continuous).toBe(false)
    expect(instance.start).toHaveBeenCalledTimes(1)
  })

  it('[DI-03] rend tout ce qui a été compris, d’un seul tenant', () => {
    const surTexte = vi.fn()
    demarrerDictee({ fenetre, surTexte })
    instance.onresult(resultats('dépôt à distance ', ' de 50 000  pour Salif'))
    expect(surTexte).toHaveBeenLastCalledWith('dépôt à distance de 50 000 pour Salif')
  })

  it('[DI-04] « terminer » laisse arriver la dernière phrase, puis finit une fois', () => {
    const surTexte = vi.fn()
    const surFin = vi.fn()
    const dictee = demarrerDictee({ fenetre, surTexte, surFin })
    dictee.terminer()
    expect(instance.stop).toHaveBeenCalled()
    instance.onresult(resultats('retrait de 20 000'))
    instance.onend()
    instance.onend()
    expect(surTexte).toHaveBeenLastCalledWith('retrait de 20 000')
    expect(surFin).toHaveBeenCalledTimes(1)
  })

  it('[DI-05] « abandonner » coupe tout de suite et n’écrit plus rien', () => {
    const surTexte = vi.fn()
    const surFin = vi.fn()
    const dictee = demarrerDictee({ fenetre, surTexte, surFin })
    dictee.abandonner()
    instance.onresult(resultats('trop tard'))
    expect(instance.abort).toHaveBeenCalled()
    expect(surFin).toHaveBeenCalledTimes(1)
    expect(surTexte).not.toHaveBeenCalled()
  })

  it('[DI-06] une erreur est dite dans les mots de la caisse ; l’abandon n’en est pas une', () => {
    const surErreur = vi.fn()
    demarrerDictee({ fenetre, surErreur })
    instance.onerror({ error: 'aborted' })
    expect(surErreur).not.toHaveBeenCalled()
    instance.onerror({ error: 'not-allowed' })
    expect(surErreur).toHaveBeenCalledWith(messageDErreurDictee('not-allowed'))
    expect(messageDErreurDictee('not-allowed')).toMatch(/Autorisez-le/)
    expect(messageDErreurDictee('inconnue')).toMatch(/tapez la question/)
  })

  it('[DI-07] un démarrage refusé par le navigateur finit proprement', () => {
    class MoteurQuiRefuse extends MoteurSimule {
      constructor() {
        super()
        this.start = vi.fn(() => { throw new Error('déjà en cours') })
      }
    }
    const surFin = vi.fn()
    const surErreur = vi.fn()
    expect(demarrerDictee({ fenetre: { SpeechRecognition: MoteurQuiRefuse }, surFin, surErreur })).toBeNull()
    expect(surErreur).toHaveBeenCalled()
    expect(surFin).toHaveBeenCalledTimes(1)
  })
})
