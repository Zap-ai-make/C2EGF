/**
 * TC-093 — DEFAULT_THEME dérive du profil client (branding.theme).
 *
 * Avant : `DEFAULT_THEME = 'dark'` était codé en dur, et `branding.theme` n'était
 * lu nulle part (constante exportée « réservée »). Déclarer un thème dans le profil
 * n'avait donc AUCUN effet — l'application ouvrait en sombre quel que soit le client.
 *
 * Après : le thème d'ouverture dérive du profil, comme le nom du produit. C'est un
 * changement de comportement délibéré ; ce test le fige.
 *
 * Invariant conservé : le choix explicite de l'utilisateur, persisté en localStorage,
 * reste prioritaire (ThemeContext lit d'abord localStorage). DEFAULT_THEME ne décide
 * que du premier chargement, quand rien n'est encore persisté.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('../../src/config/activeClientProfile.js')
})

// Recharge themes.js (et branding.js dont il dépend) avec un profil actif mocké.
async function loadThemesWith(profile) {
  vi.resetModules()
  vi.doMock('../../src/config/activeClientProfile.js', () => ({ activeProfile: profile }))
  return import('../../src/constants/themes.js')
}

describe('TC-093 — DEFAULT_THEME dérivé du profil', () => {
  it('caractérisation C2EGF (profil réel) → palette de marque au premier chargement', async () => {
    vi.resetModules()
    const t = await import('../../src/constants/themes.js')
    expect(t.DEFAULT_THEME).toBe('c2egf')
  })

  it('la palette C2EGF passe par le jeton de marque, non par une valeur littérale', async () => {
    vi.resetModules()
    const t = await import('../../src/constants/themes.js')
    expect(t.THEMES.c2egf.classes.accent).toBe('bg-brand-500')
  })

  it('le jeton de marque vaut bien le bleu relevé sur le logo', async () => {
    // Le lien entre la classe et sa couleur vit désormais dans le CSS. Ce test le
    // garde explicite : changer --color-brand-500 reteinte toute l'application,
    // et doit donc se faire en connaissance de cause.
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const css = readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8')
    expect(css).toMatch(/--color-brand-500:\s*#173863/)
  })

  it('le thème « custom » a disparu — il était inapplicable par construction', async () => {
    vi.resetModules()
    const t = await import('../../src/constants/themes.js')
    expect(t.THEMES.custom).toBeUndefined()
  })

  it('un autre thème déclaré dans le profil est respecté', async () => {
    const t = await loadThemesWith({ branding: { theme: 'purple' } })
    expect(t.DEFAULT_THEME).toBe('purple')
  })

  it('thème inconnu de THEMES → repli sur dark, jamais un thème cassé', async () => {
    const t = await loadThemesWith({ branding: { theme: 'chartreuse' } })
    expect(t.DEFAULT_THEME).toBe('dark')
  })

  it('profil sans branding → défaut historique du produit (green)', async () => {
    const t = await loadThemesWith({})
    expect(t.DEFAULT_THEME).toBe('green')
  })

  it('le thème retenu existe toujours dans THEMES', async () => {
    vi.resetModules()
    const t = await import('../../src/constants/themes.js')
    expect(t.THEMES[t.DEFAULT_THEME]).toBeDefined()
  })
})
