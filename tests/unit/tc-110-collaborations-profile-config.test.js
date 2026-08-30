/**
 * TC-110 — Axes BOUTIQUE du profil → config functions (storeProfile).
 *
 * Premier lot du module « collaborations inter-boutiques / dettes internes ».
 * Le module est opt-out (activé par défaut dans le pilote) et son périmètre serveur
 * dérive entièrement du profil client — jamais d'une liste en dur. Ce test verrouille :
 *   • la dérivation des 3 axes (réseaux boutique, drapeau, méthodes de règlement) ;
 *   • l'ajout systématique de « Banque » aux méthodes du profil, dédoublonné ;
 *   • le refus explicite d'un profil incomplet (aucun défaut silencieux) ;
 *   • l'héritage : C2EGF n'écrit rien et reçoit le drapeau du pilote ;
 *   • ANTI-DÉRIVE : functions/src/config/storeProfile.js commité == régénéré pour TAOFIC
 *     (sinon `node scripts/generate-functions-config.mjs --client taofic_ajagbe`
 *     doit être relancé).
 *
 * Pendant de TC-084, qui verrouille l'axe DEALER (dealerProfile).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveProfile } from '../../config/clients/index.js'
import {
  generateStoreProfileFile,
  DEBT_ONLY_SETTLEMENT_METHOD,
} from '../../scripts/lib/generateStoreProfile.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const storeProfilePath = resolve(__dirname, '../../functions/src/config/storeProfile.js')

// Profil minimal valide — sert de base aux cas d'erreur, pour ne faire varier
// qu'un seul axe à la fois.
const validProfile = {
  networks: { enabled: ['Orange'] },
  transactions: { paymentMethods: ['Orange Money', 'Cash'] },
  collaborations: { enabled: true },
}

describe('TC-110 — Génération de storeProfile depuis le profil client', () => {
  it('TAOFIC → un seul réseau boutique (Orange)', () => {
    expect(generateStoreProfileFile(resolveProfile('taofic_ajagbe')))
      .toContain("export const STORE_NETWORKS = ['Orange']")
  })

  it('C2EGF → un seul réseau boutique (Orange), comme TAOFIC', () => {
    expect(generateStoreProfileFile(resolveProfile('c2egf_burkina')))
      .toContain("export const STORE_NETWORKS = ['Orange']")
  })

  it('profil pilote → les 5 réseaux (opt-out : tout activé)', () => {
    expect(generateStoreProfileFile(resolveProfile('_pilot')))
      .toContain("export const STORE_NETWORKS = ['Orange', 'Moov', 'Telecel', 'Coris', 'Sank']")
  })

  it('le module est activé par défaut (politique opt-out du pilote)', () => {
    expect(generateStoreProfileFile(resolveProfile('_pilot')))
      .toContain('export const COLLABORATIONS_ENABLED = true')
  })

  it('C2EGF hérite du drapeau sans le déclarer', () => {
    expect(resolveProfile('c2egf_burkina').collaborations.enabled).toBe(true)
    expect(generateStoreProfileFile(resolveProfile('c2egf_burkina')))
      .toContain('export const COLLABORATIONS_ENABLED = true')
  })

  it('un client qui désactive le module le voit refusé jusqu’au serveur', () => {
    const off = { ...validProfile, collaborations: { enabled: false } }
    expect(generateStoreProfileFile(off)).toContain('export const COLLABORATIONS_ENABLED = false')
  })
})

describe('TC-110b — Méthodes de règlement des dettes', () => {
  it('méthodes du profil + Banque', () => {
    expect(generateStoreProfileFile(validProfile))
      .toContain("export const DEBT_SETTLEMENT_METHODS = ['Orange Money', 'Cash', 'Banque']")
  })

  it('Banque n’est ajoutée qu’une fois si le profil la liste déjà', () => {
    const withBank = {
      ...validProfile,
      transactions: { paymentMethods: ['Orange Money', 'Banque'] },
    }
    expect(generateStoreProfileFile(withBank))
      .toContain("export const DEBT_SETTLEMENT_METHODS = ['Orange Money', 'Banque']")
  })

  it('Banque reste distincte des méthodes de transaction client du profil', () => {
    // Le profil ne doit PAS être pollué : « Banque » ne règle pas une transaction
    // client, seulement une dette interne.
    expect(resolveProfile('c2egf_burkina').transactions.paymentMethods)
      .not.toContain(DEBT_ONLY_SETTLEMENT_METHOD)
  })

  it('profil multi-réseaux → toutes ses méthodes sont reprises', () => {
    expect(generateStoreProfileFile(resolveProfile('_pilot')))
      .toContain("'Orange Money', 'Moov Money', 'Telecel Money', 'Coris Money', 'Sank Money', 'Cash', 'Banque'")
  })
})

describe('TC-110c — Profil incomplet : erreur explicite, jamais de défaut silencieux', () => {
  it('networks.enabled vide → erreur', () => {
    expect(() => generateStoreProfileFile({ ...validProfile, networks: { enabled: [] } }))
      .toThrow(/networks\.enabled doit être une liste non vide/)
  })

  it('networks absent → erreur', () => {
    expect(() => generateStoreProfileFile({ ...validProfile, networks: undefined }))
      .toThrow(/networks\.enabled doit être une liste non vide/)
  })

  it('transactions.paymentMethods vide → erreur', () => {
    expect(() => generateStoreProfileFile({ ...validProfile, transactions: { paymentMethods: [] } }))
      .toThrow(/paymentMethods doit être une liste non vide/)
  })

  it('collaborations absent → erreur (pas de « true » par défaut)', () => {
    expect(() => generateStoreProfileFile({ ...validProfile, collaborations: undefined }))
      .toThrow(/collaborations\.enabled doit être un booléen/)
  })

  it('collaborations.enabled non booléen → erreur', () => {
    expect(() => generateStoreProfileFile({ ...validProfile, collaborations: { enabled: 'oui' } }))
      .toThrow(/collaborations\.enabled doit être un booléen/)
  })
})

describe('TC-110d — Anti-dérive de l’artefact commité', () => {
  it('functions/src/config/storeProfile.js == généré pour TAOFIC', () => {
    const committed = readFileSync(storeProfilePath, 'utf8').replace(/\r\n/g, '\n')
    const generated = generateStoreProfileFile(resolveProfile('taofic_ajagbe'))
    expect(committed).toBe(generated)
  })

  it('l’artefact commité convient aussi à C2EGF (mêmes axes que TAOFIC)', () => {
    const committed = readFileSync(storeProfilePath, 'utf8').replace(/\r\n/g, '\n')
    expect(committed).toBe(generateStoreProfileFile(resolveProfile('c2egf_burkina')))
  })
})
