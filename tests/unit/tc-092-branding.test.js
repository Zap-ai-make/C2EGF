/**
 * TC-092 — branding.js : le nom du produit dérive du profil client actif.
 *
 * Caractérisation : sous le profil réel des tests (TAOFIC, VITE_CLIENT_ID=taofic_ajagbe),
 * la marque reste « AKAYIS » / « AKAYIS CRM » — comportement identique à aujourd'hui.
 * Puis on prouve la dérivation : un profil avec un autre `branding` change les constantes ;
 * un profil sans `branding` retombe sur les défauts historiques.
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
  it('caractérisation TAOFIC (profil réel) → AKAYIS / AKAYIS CRM / green', async () => {
    vi.resetModules()
    const b = await import('../../src/constants/branding.js')
    expect(b.APP_NAME).toBe('AKAYIS')
    expect(b.APP_FULL_NAME).toBe('AKAYIS CRM')
    expect(b.BRAND_THEME).toBe('green')
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
