/**
 * TC-083 — Caractérisation : les constantes front dérivent du profil client actif.
 *
 * NETWORK_OPTIONS / TRANSACTION_TYPES / PAYMENT_METHODS ne sont pas codées en dur :
 * elles dérivent de config/clients (profil sélectionné par VITE_CLIENT_ID). Ce test
 * VERROUILLE les valeurs du client de CE dépôt — C2EGF BURKINA — pour qu'aucune
 * modification du profil ne passe inaperçue.
 *
 * Si ce test échoue en résolvant le profil pilote ('_pilot'), c'est que
 * l'environnement de test ne charge pas VITE_CLIENT_ID=c2egf_burkina : le fichier
 * .env local est absent ou incomplet (il est gitignoré — voir .env.example).
 *
 * Écart assumé vs. TAOFIC (client d'origine du produit) : C2EGF conserve le type
 * « Crédit » du profil pilote. Les autres axes sont identiques (1 réseau Orange,
 * 2 méthodes de règlement, dealer mono-réseau).
 */

import { describe, it, expect } from 'vitest'
import { NETWORK_OPTIONS, TRANSACTION_TYPES, PAYMENT_METHODS } from '../../src/utils/constants.js'
import { DEALER_NETWORK } from '../../src/constants/dealerConstants.js'
import { activeProfile } from '../../src/config/activeClientProfile.js'

describe('TC-083 — Constantes dérivées du profil client actif', () => {
  it('le profil actif en test est bien C2EGF (VITE_CLIENT_ID via .env)', () => {
    expect(activeProfile.id).toBe('c2egf_burkina')
  })

  it('NETWORK_OPTIONS = profil C2EGF (un seul réseau)', () => {
    expect(NETWORK_OPTIONS).toEqual(['Orange'])
  })

  it('TRANSACTION_TYPES = profil C2EGF (Dépôt/Retrait/Crédit)', () => {
    expect(TRANSACTION_TYPES).toEqual([
      { value: 'Dépôt', label: 'Dépôt' },
      { value: 'Retrait', label: 'Retrait' },
      { value: 'Crédit', label: 'Crédit' },
    ])
  })

  it('PAYMENT_METHODS = profil C2EGF (Orange Money, Cash)', () => {
    expect(PAYMENT_METHODS).toEqual(['Orange Money', 'Cash'])
  })

  it('DEALER_NETWORK = profil C2EGF (Orange, mono-réseau)', () => {
    expect(DEALER_NETWORK).toBe('Orange')
  })
})
