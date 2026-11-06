/**
 * TC-364 — d'abord sur l'appareil, sans faire clignoter l'écran (lot H,
 * docs/rester-dans-le-quota-gratuit.md §H).
 *
 * Toute opération passe par la file, réseau présent ou pas : avec internet, elle part
 * dans la seconde. Ce fichier verrouille ce que l'écran en dit pendant cette seconde :
 * - les soldes comptent l'opération tout de suite, mais le titre « Soldes
 *   provisoires » ne s'affiche que si la file le demande ;
 * - le bandeau du bas et la mention « En attente d'envoi » de même ;
 * - un refus, lui, se montre toujours.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../src/services/firestore', () => ({ firestoreService: {} }))
vi.mock('../../src/config/clientIsolation', () => ({ getStorageKey: (cle) => cle }))
vi.mock('../../src/context/AuthContext', () => ({ AuthContext: React.createContext({}) }))

import { NetworkConfigProvider, useNetworkConfig } from '../../src/context/NetworkConfigContext.jsx'
import { EnvoisContext } from '../../src/context/envoisContexte.js'
import OfflineBanner from '../../src/components/OfflineBanner.jsx'
import EtatEnvoi from '../../src/components/ui/EtatEnvoi.jsx'
import { EN_ATTENTE, REFUSEE, SAISIE } from '../../src/services/fileEnvoi.js'

const saisie = { id: 's1', type: SAISIE, etat: EN_ATTENTE, creeLe: 1, tentatives: 0, erreur: null, charge: { transaction: { type: 'Dépôt', reseau: 'Orange', montant: 1000, statut: 'Non Terminées' } } }
const refusee = { id: 'r1', type: SAISIE, etat: REFUSEE, creeLe: 1, tentatives: 1, erreur: { code: 'INSUFFICIENT_STORE_BALANCE', message: 'Stock Orange insuffisant.' }, charge: { transaction: {} } }

const envoisSimules = (over = {}) => ({
  disponible: true, soumettre: vi.fn(), retirer: vi.fn(), apresEnvoi: () => () => {},
  operations: [], enAttente: [], refusees: [], signalerAttente: false, ...over,
})

beforeEach(() => {
  localStorage.setItem('network_data_v3', JSON.stringify({ Orange: { stock: 5000, liquidite: 0 } }))
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
})

describe('TC-364 — les soldes', () => {
  let soldes
  function Lecteur() {
    soldes = useNetworkConfig()
    return null
  }
  const monter = (envois) => render(
    <EnvoisContext.Provider value={envois}>
      <NetworkConfigProvider><Lecteur /></NetworkConfigProvider>
    </EnvoisContext.Provider>,
  )

  it('[LD-01] l’opération qui part compte aussitôt, sans que le titre ne change', () => {
    monter(envoisSimules({ operations: [saisie], enAttente: [saisie], signalerAttente: false }))
    expect(soldes.networkData.Orange.stock).toBe(4000)
    expect(soldes.soldesProvisoires).toBe(false)
  })

  it('[LD-02] elle tarde : le titre le dit', () => {
    monter(envoisSimules({ operations: [saisie], enAttente: [saisie], signalerAttente: true }))
    expect(soldes.networkData.Orange.stock).toBe(4000)
    expect(soldes.soldesProvisoires).toBe(true)
  })
})

describe('TC-364 — le bandeau du bas et la ligne', () => {
  const avec = (envois, enfant) => render(<EnvoisContext.Provider value={envois}>{enfant}</EnvoisContext.Provider>)

  it('[LD-03] réseau présent, une opération qui part dans la seconde : ni bandeau ni mention', () => {
    avec(envoisSimules({ operations: [saisie], enAttente: [saisie] }), (
      <>
        <OfflineBanner />
        <EtatEnvoi envoi={{ etat: EN_ATTENTE, erreur: null }} id="s1" />
      </>
    ))
    expect(screen.queryByTestId('bandeau-hors-ligne')).toBeNull()
    expect(screen.queryByTestId('envoi-en-attente')).toBeNull()
  })

  it('[LD-04] elle tarde : le bandeau la compte et la ligne le dit', () => {
    avec(envoisSimules({ operations: [saisie], enAttente: [saisie], signalerAttente: true }), (
      <>
        <OfflineBanner />
        <EtatEnvoi envoi={{ etat: EN_ATTENTE, erreur: null }} id="s1" />
      </>
    ))
    expect(screen.getByTestId('bandeau-hors-ligne')).toHaveTextContent('1 opération en attente d’envoi')
    expect(screen.getByTestId('envoi-en-attente')).toHaveTextContent('En attente d’envoi')
  })

  it('[LD-05] un refus se montre toujours, même quand l’attente se tait', () => {
    avec(envoisSimules({ operations: [saisie, refusee], enAttente: [saisie], refusees: [refusee] }), (
      <>
        <OfflineBanner />
        <EtatEnvoi envoi={{ etat: REFUSEE, erreur: refusee.erreur }} id="r1" />
      </>
    ))
    const bandeau = screen.getByTestId('bandeau-hors-ligne')
    expect(bandeau).toHaveTextContent('1 opération refusée par le serveur')
    expect(bandeau).not.toHaveTextContent('en attente')
    expect(screen.getByTestId('envoi-refuse')).toHaveTextContent('Refusée : Stock Orange insuffisant.')
  })

  it('[LD-06] hors ligne, le bandeau le dit sans attendre', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    avec(envoisSimules({ operations: [saisie], enAttente: [saisie], signalerAttente: true }), <OfflineBanner />)
    expect(screen.getByTestId('bandeau-hors-ligne')).toHaveTextContent('Hors ligne — les données affichées proviennent du cache local · 1 opération en attente d’envoi')
  })
})
