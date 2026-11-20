import { describe, it, expect, vi } from 'vitest'
import { DELAI_SIGNAL_MS, URL_SIGNAL, signalerDemandeFermee } from '../../functions/src/oxygen/signal.js'

/**
 * TC-401 — Le signal à Oxygen, hors de Firestore : quand une demande se ferme,
 * le CRM prévient le serveur Oxygen, qui réveille le téléphone de l'agent.
 * Spec : docs/superpowers/specs/2026-11-20-signal-oxygen-design.md.
 *
 * Contrat v9 §10.1 : un seul appel, 3 s au plus, un corps sans rien d'autre que
 * l'identifiant, et un jeton d'identité Google dont l'audience est l'URL même.
 */

const PROJET = 'c2egf-b0b5a'
const METADONNEES = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity'
const reponse = (status, corps = '') => ({ ok: status >= 200 && status < 300, status, text: async () => corps })

describe('TC-401 — le signal à Oxygen', () => {
  it('[TC-401-01] prend le jeton au serveur de métadonnées, puis envoie le seul identifiant', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(reponse(200, 'jeton-id'))
      .mockResolvedValueOnce(reponse(200, '{"ok":true}'))

    await signalerDemandeFermee('d1', { fetch, projet: PROJET })

    expect(URL_SIGNAL).toBe('https://flwbscqezuhmshjnrakr.supabase.co/functions/v1/liaison')
    expect(DELAI_SIGNAL_MS).toBe(3000)
    expect(fetch).toHaveBeenCalledTimes(2)
    const [urlJeton, optionsJeton] = fetch.mock.calls[0]
    expect(urlJeton).toBe(`${METADONNEES}?format=full&audience=${encodeURIComponent(URL_SIGNAL)}`)
    expect(optionsJeton.headers).toEqual({ 'Metadata-Flavor': 'Google' })
    const [url, options] = fetch.mock.calls[1]
    expect(url).toBe(URL_SIGNAL)
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ Authorization: 'Bearer jeton-id', 'Content-Type': 'application/json' })
    expect(options.body).toBe('{"action":"signal","demande":"d1"}')
  })

  it('[TC-401-02] une réponse refusée lève avec son statut ; un jeton refusé n’envoie rien', async () => {
    const refuse = vi.fn()
      .mockResolvedValueOnce(reponse(200, 'jeton-id'))
      .mockResolvedValueOnce(reponse(401, '{"ok":false,"raison":"identite"}'))
    await expect(signalerDemandeFermee('d1', { fetch: refuse, projet: PROJET })).rejects.toMatchObject({ statut: 401 })

    const sansJeton = vi.fn().mockResolvedValueOnce(reponse(500, 'panne'))
    await expect(signalerDemandeFermee('d1', { fetch: sansJeton, projet: PROJET })).rejects.toMatchObject({ statut: 500 })
    expect(sansJeton).toHaveBeenCalledTimes(1)
  })

  it('[TC-401-03] un serveur qui ne répond pas : abandon une fois le délai passé', async () => {
    const signaux = []
    const muet = vi.fn((_url, { signal }) => {
      signaux.push(signal)
      if (signaux.length === 1) return Promise.resolve(reponse(200, 'jeton-id'))
      return new Promise((_ok, echec) => signal.addEventListener('abort', () => echec(signal.reason)))
    })

    await expect(signalerDemandeFermee('d1', { fetch: muet, projet: PROJET, delaiMs: 50 })).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(signaux).toHaveLength(2)
    expect(signaux.every((s) => s instanceof AbortSignal)).toBe(true)
  })

  it('[TC-401-04] sur un projet demo (émulateurs, tests), rien ne part', async () => {
    const fetch = vi.fn()
    await signalerDemandeFermee('d1', { fetch, projet: 'demo-akayis-test' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
