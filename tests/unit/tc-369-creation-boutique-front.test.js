/**
 * TC-369 — ce que le front de « Nouvelle boutique » ajoute au serveur :
 *   le mot de passe généré, et les messages tirés des codes métier.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ appel: vi.fn() }))

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn((_functions, nom) => (data) => mocks.appel(nom, data)),
}))
vi.mock('../../src/config/firebase', () => ({ functions: {} }))

const { creerBoutique, ECHEC_CREATION } = await import('../../src/services/boutiquesService.js')
const { genererMotDePasse, LONGUEUR_MOT_DE_PASSE } = await import('../../src/utils/motDePasse.js')

beforeEach(() => { mocks.appel.mockReset() })

describe('TC-369 — le mot de passe généré', () => {
  it('[CBF-01] 10 caractères, ni 0/O ni 1/l/i', () => {
    for (let i = 0; i < 50; i += 1) {
      const mdp = genererMotDePasse()
      expect(mdp).toHaveLength(LONGUEUR_MOT_DE_PASSE)
      expect(mdp).toMatch(/^[a-hjkmnp-z2-9]+$/)
    }
  })

  it('[CBF-02] les octets au-delà du dernier multiple de 31 sont écartés, pas repliés', () => {
    // 248 à 255 replieraient sur les 8 premières lettres et les rendraient plus
    // fréquentes : ils doivent être sautés.
    const octets = [255, 248, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    const aleatoire = (tableau) => { tableau.set(octets.slice(0, tableau.length)); return tableau }
    expect(genererMotDePasse(aleatoire)).toBe('abcdefghjk')
  })
})

describe('TC-369 — l’appel et ses messages', () => {
  it('[CBF-03] appelle `creerBoutique` avec les trois champs, et rend la boutique sans `success`', async () => {
    mocks.appel.mockResolvedValue({ data: { success: true, storeId: 's1', uid: 'u1', nom: 'N', email: 'e@x.test', dejaCreee: false } })

    await expect(creerBoutique({ nom: 'N', email: 'e@x.test', motDePasse: 'mot-de-passe-1' }))
      .resolves.toEqual({ storeId: 's1', uid: 'u1', nom: 'N', email: 'e@x.test', dejaCreee: false })
    expect(mocks.appel).toHaveBeenCalledWith('creerBoutique', { nom: 'N', email: 'e@x.test', motDePasse: 'mot-de-passe-1' })
  })

  it.each([
    ['EMAIL_ALREADY_USED', 'Cet e-mail sert déjà à un autre compte.'],
    ['STORE_NAME_TAKEN', 'Une boutique active porte déjà ce nom.'],
    ['ROLE_FORBIDDEN', 'Réservé au compte du patron.'],
  ])('[CBF-04] le code %s donne son message', async (code, message) => {
    mocks.appel.mockImplementation(async () => { throw Object.assign(new Error('brut'), { code: 'functions/already-exists', details: { code } }) })
    await expect(creerBoutique({})).rejects.toMatchObject({ message, code })
  })

  it('[CBF-05] une panne réseau ou une function absente dit qu’on peut réessayer, jamais le message brut', async () => {
    mocks.appel.mockImplementation(async () => { throw Object.assign(new Error('internal: détail confidentiel'), { code: 'functions/internal' }) })
    const err = await creerBoutique({}).catch((e) => e)
    expect(err.message).toBe(ECHEC_CREATION)
    expect(err.message).not.toContain('confidentiel')
  })
})
