/**
 * TC-083 — Caractérisation : les constantes front dérivent du profil client actif.
 *
 * Phase 1 du produit pilote : NETWORK_OPTIONS / TRANSACTION_TYPES / PAYMENT_METHODS
 * ne sont plus codées en dur mais dérivées de config/clients (profil sélectionné par
 * VITE_CLIENT_ID). Ce test VERROUILLE le principe « extraire sans changer » : sous le
 * profil du client actuel (TAOFIC, via .env), les valeurs doivent être STRICTEMENT
 * identiques à celles codées en dur avant la Phase 1.
 *
 * Si ce test échoue en résolvant le profil pilote, c'est que l'environnement de test
 * ne charge pas VITE_CLIENT_ID=taofic_ajagbe → à corriger avant de continuer.
 */

import { describe, it, expect } from 'vitest'
import { NETWORK_OPTIONS, TRANSACTION_TYPES, PAYMENT_METHODS } from '../../src/utils/constants.js'
import { DEALER_NETWORK } from '../../src/constants/dealerConstants.js'
import { activeProfile } from '../../src/config/activeClientProfile.js'

describe('TC-083 — Constantes dérivées du profil client actif', () => {
  it('le profil actif en test est bien TAOFIC (VITE_CLIENT_ID via .env)', () => {
    expect(activeProfile.id).toBe('taofic_ajagbe')
  })

  it('NETWORK_OPTIONS = valeurs historiques TAOFIC (un seul réseau)', () => {
    expect(NETWORK_OPTIONS).toEqual(['Orange'])
  })

  it('TRANSACTION_TYPES = valeurs historiques TAOFIC (Dépôt/Retrait, sans Crédit)', () => {
    expect(TRANSACTION_TYPES).toEqual([
      { value: 'Dépôt', label: 'Dépôt' },
      { value: 'Retrait', label: 'Retrait' },
    ])
  })

  it('PAYMENT_METHODS = valeurs historiques TAOFIC (Orange Money, Cash)', () => {
    expect(PAYMENT_METHODS).toEqual(['Orange Money', 'Cash'])
  })

  it('DEALER_NETWORK = valeur historique TAOFIC (Orange, mono-réseau)', () => {
    expect(DEALER_NETWORK).toBe('Orange')
  })
})
