/**
 * TC-092 — branding.js : le nom du produit dérive du profil client actif.
 *
 * Caractérisation : sous le profil réel des tests (C2EGF, VITE_CLIENT_ID=c2egf_burkina),
 * la marque est « C2EGF » et le thème de marque « c2egf » (bleu marine #173863).
 * Puis on prouve la dérivation : un profil avec un autre `branding` change les constantes ;
 * un profil sans `branding` retombe sur les défauts historiques du produit (AKAYIS).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('../../src/config/activeClientProfile.js')
})

// Recharge branding.js avec un profil actif mocké (module évalué à l'import).
async function loadBrandingWith(profile) {
  vi.resetModules()
  vi.doMock('../../src/config/activeClientProfile.js', () => ({ activeProfile: profile }))
  return import('../../src/constants/branding.js')
}

describe('TC-092 — branding dérivé du profil', () => {
  it('caractérisation C2EGF (profil réel) → C2EGF / C2EGF / c2egf', async () => {
    vi.resetModules()
    const b = await import('../../src/constants/branding.js')
    expect(b.APP_NAME).toBe('C2EGF')
    expect(b.APP_FULL_NAME).toBe('C2EGF')
    expect(b.BRAND_THEME).toBe('c2egf')
  })

  it('reflète le branding d’un autre client', async () => {
    const b = await loadBrandingWith({
      branding: { appName: 'ZEDCOM', pwaName: 'ZEDCOM CRM', theme: 'blue' },
    })
    expect(b.APP_NAME).toBe('ZEDCOM')
    expect(b.APP_FULL_NAME).toBe('ZEDCOM CRM')
    expect(b.BRAND_THEME).toBe('blue')
  })

  it('profil sans branding → défauts historiques AKAYIS', async () => {
    const b = await loadBrandingWith({})
    expect(b.APP_NAME).toBe('AKAYIS')
    expect(b.APP_FULL_NAME).toBe('AKAYIS CRM')
    expect(b.BRAND_THEME).toBe('green')
  })

  it('branding partiel → seuls les champs fournis sont pris, le reste par défaut', async () => {
    const b = await loadBrandingWith({ branding: { appName: 'ACME' } })
    expect(b.APP_NAME).toBe('ACME')
    expect(b.APP_FULL_NAME).toBe('AKAYIS CRM') // pwaName absent → défaut
    expect(b.BRAND_THEME).toBe('green')
  })
})
