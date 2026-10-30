import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * TC-311 — Le modèle choisi, ses réglages, et les pannes dites justes.
 *
 * Le SDK est simulé : on ne teste pas Gemini, on teste ce que NOTRE code lui
 * demande et ce qu'il dit à la caissière quand ça échoue.
 *
 * Origine (30 octobre 2026) : au premier branchement réel, l'assistant
 * répondait « pas encore activé ». Deux causes, et aucune n'était une
 * activation oubliée côté code :
 *   - `gemini-2.5-flash` est réservé aux projets qui l'employaient déjà ;
 *   - le SDK met l'adresse `firebasevertexai.googleapis.com` dans CHAQUE échec,
 *     et la traduction la prenait pour « API non activée ».
 */

vi.mock('firebase/ai', () => ({
  getAI: vi.fn(),
  getGenerativeModel: vi.fn(),
  GoogleAIBackend: class {},
  VertexAIBackend: class {},
  ThinkingLevel: { MINIMAL: 'MINIMAL', LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' },
}))
vi.mock('../../src/config/firebase.js', () => ({ default: {} }))
vi.mock('../../src/config/appCheck.js', () => ({ activerAppCheck: () => ({ actif: true }) }))

import { MODELE_PAR_DEFAUT, reglagesDuModele, traduireErreur } from '../../src/lib/ia/assistant.js'

/** Un échec HTTP tel que l'AIError du SDK le construit (index.esm.js, makeRequest). */
const echecHttp = (status, message) => ({
  name: 'FirebaseError',
  code: 'fetch-error',
  message:
    'AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/projects/c2egf/models/' +
    `gemini-2.5-flash:streamGenerateContent?alt=sse: [${status} ] ${message} (AI/fetch-error)`,
  customErrorData: { status },
})

let console_
beforeEach(() => {
  console_ = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => console_.mockRestore())

describe('TC-311 — le modèle et ses réglages', () => {
  it('[MO-01] le modèle par défaut est un Gemini encore servi aux projets neufs', () => {
    expect(MODELE_PAR_DEFAUT).toBe('gemini-3.5-flash')
  })

  it('[MO-02] Gemini 3 : température par défaut, réflexion basse', () => {
    const reglages = reglagesDuModele('gemini-3.5-flash')
    expect(reglages).toEqual({ maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: 'LOW' } })
    expect(reglages).not.toHaveProperty('temperature')
  })

  it('[MO-03] Gemini 2.x : pas de niveau de réflexion, qu’il refuserait', () => {
    expect(reglagesDuModele('gemini-2.5-flash')).toEqual({ maxOutputTokens: 4096, temperature: 0.2 })
  })
})

describe('TC-311 — les pannes, dites justes', () => {
  it('[PA-01] l’adresse du service ne fait plus croire à une API éteinte', () => {
    expect(traduireErreur(echecHttp(429, 'Resource has been exhausted (e.g. check quota).')))
      .toBe('Le service est occupé en ce moment. Réessayez dans quelques secondes.')
  })

  it('[PA-02] un modèle retiré est nommé comme tel', () => {
    expect(traduireErreur(echecHttp(404, 'models/gemini-2.5-flash is not found for API version v1beta, or is not supported for generateContent.')))
      .toMatch(/^Le modèle de l'assistant n'est plus proposé/)
  })

  it('[PA-03] l’API éteinte reste « pas encore activé »', () => {
    const eteinte = {
      code: 'api-not-enabled',
      message: "AI: The Firebase AI SDK requires the Firebase AI API ('firebasevertexai.googleapis.com') to be enabled in your Firebase project. (AI/api-not-enabled)",
      customErrorData: { status: 403 },
    }
    expect(traduireErreur(eteinte)).toBe("L'assistant n'est pas encore activé sur cette installation.")
  })

  it('[PA-04] une attestation refusée accuse l’appareil, pas l’activation', () => {
    expect(traduireErreur(echecHttp(401, 'Firebase App Check token is invalid.')))
      .toBe("L'assistant n'est pas autorisé sur cet appareil.")
  })

  it('[PA-05] la cagnotte vide garde son message', () => {
    expect(traduireErreur(echecHttp(429, 'Your prepayment credits are depleted.')))
      .toBe("Le crédit de l'assistant est épuisé. Prévenez le responsable.")
  })
})
