/**
 * TC-085 — resolveTransferNetwork : réseau porté par l'opération, validé ∈ profil.
 *
 * Chantier dealer multi-réseaux (couche storeTransfers). Helper PUR (aucun I/O),
 * remplace l'ancienne constante TRANSFER_NETWORK='Orange'. Vérifie :
 *   • mono-réseau (défaut TAOFIC) : candidat omis → réseau unique (Orange), inchangé ;
 *   • multi-réseaux : candidat explicite requis, validé ∈ profil (pas de choix silencieux) ;
 *   • candidat hors profil → INVALID_TRANSFER_NETWORK ;
 *   • défaut = DEALER_NETWORKS (profil functions committé = mono Orange).
 */

import { describe, it, expect } from 'vitest'
import { resolveTransferNetwork } from '../../functions/src/storeTransfers/shared.js'

// Assertion précise sur le code métier d'un throw synchrone.
function expectCode(fn, code) {
  try {
    fn()
  } catch (e) {
    expect(e.code).toBe(code)
    return
  }
  throw new Error(`Attendu un throw ${code}, aucune exception levée.`)
}

describe('TC-085 — resolveTransferNetwork', () => {
  it('mono-réseau + candidat omis → réseau unique (comportement TAOFIC historique)', () => {
    expect(resolveTransferNetwork(undefined, ['Orange'])).toBe('Orange')
    expect(resolveTransferNetwork(null, ['Orange'])).toBe('Orange')
    expect(resolveTransferNetwork('', ['Orange'])).toBe('Orange')
  })

  it('mono-réseau + candidat = ce réseau → accepté', () => {
    expect(resolveTransferNetwork('Orange', ['Orange'])).toBe('Orange')
  })

  it('mono-réseau + candidat hors profil → INVALID_TRANSFER_NETWORK', () => {
    expectCode(() => resolveTransferNetwork('Moov', ['Orange']), 'INVALID_TRANSFER_NETWORK')
  })

  it('multi-réseaux + candidat valide → accepté (chaque réseau du profil)', () => {
    expect(resolveTransferNetwork('Moov', ['Orange', 'Moov'])).toBe('Moov')
    expect(resolveTransferNetwork('Orange', ['Orange', 'Moov'])).toBe('Orange')
  })

  it('multi-réseaux + candidat omis → INVALID_TRANSFER_NETWORK (réseau requis, pas de défaut silencieux)', () => {
    expectCode(() => resolveTransferNetwork(undefined, ['Orange', 'Moov']), 'INVALID_TRANSFER_NETWORK')
    expectCode(() => resolveTransferNetwork(null, ['Orange', 'Moov']), 'INVALID_TRANSFER_NETWORK')
    expectCode(() => resolveTransferNetwork('', ['Orange', 'Moov']), 'INVALID_TRANSFER_NETWORK')
  })

  it('multi-réseaux + candidat hors profil → INVALID_TRANSFER_NETWORK', () => {
    expectCode(() => resolveTransferNetwork('Telecel', ['Orange', 'Moov']), 'INVALID_TRANSFER_NETWORK')
  })

  it('accepte un Set comme liste de réseaux (parité avec DEALER_NETWORKS injecté)', () => {
    expect(resolveTransferNetwork('Moov', new Set(['Orange', 'Moov']))).toBe('Moov')
    expect(resolveTransferNetwork(undefined, new Set(['Orange']))).toBe('Orange')
  })

  it('défaut = DEALER_NETWORKS (profil functions committé TAOFIC = mono Orange)', () => {
    expect(resolveTransferNetwork(undefined)).toBe('Orange')
    expect(resolveTransferNetwork('Orange')).toBe('Orange')
    expectCode(() => resolveTransferNetwork('Moov'), 'INVALID_TRANSFER_NETWORK')
  })
})
