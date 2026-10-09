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
  transactions: { types: ['Dépôt', 'Retrait'], paymentMethods: ['Orange Money', 'Cash'] },
  cashier: { canEditBalances: false },
  collaborations: { enabled: true },
  // Le fuseau est un axe OBLIGATOIRE depuis que le serveur horodate et borne
  // l'annulation d'une clôture à la journée en cours : sans lui, il retomberait
  // sur celui de la machine qui exécute la fonction, qui n'est celui de personne.
  regional: { timezone: 'Africa/Ouagadougou' },
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
      transactions: { types: ['Dépôt', 'Retrait'], paymentMethods: ['Orange Money', 'Banque'] },
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

  it('refuse un profil sans fuseau horaire', () => {
    expect(() => generateStoreProfileFile({ ...validProfile, regional: undefined }))
      .toThrow(/regional\.timezone/)
    expect(() => generateStoreProfileFile({ ...validProfile, regional: { timezone: '  ' } }))
      .toThrow(/regional\.timezone/)
  })

  it('reporte le fuseau du profil dans le module généré', () => {
    expect(generateStoreProfileFile(validProfile))
      .toContain("export const STORE_TIME_ZONE = 'Africa/Ouagadougou'")
  })
})

describe('TC-110d — Anti-dérive de l’artefact commité', () => {
  const commite = () => readFileSync(storeProfilePath, 'utf8').replace(/\r\n/g, '\n')

  /**
   * ⚠ CE BLOC A ÉTÉ RÉÉCRIT, ET LA RAISON EST LE CŒUR DU SUJET.
   *
   * Il exigeait que l'artefact commité égale CELUI DE TAOFIC, puis notait qu'il
   * « convient aussi à C2EGF (mêmes axes) ». C'était figer une COÏNCIDENCE :
   * les deux profils produisaient le même fichier parce qu'aucun axe boutique
   * ne les distinguait encore.
   *
   * S8 y met fin légitimement. C2EGF déclare ses expéditeurs de ravitaillement
   * — Patron, Mme Sawadogo, Mohamed… — et TAOFIC, qui est une autre entreprise,
   * n'en a pas. Leur donner les mêmes noms pour sauver l'assertion aurait été
   * inventer le carnet d'adresses d'un client.
   *
   * L'artefact commité appartient à CE dépôt, qui est l'instance C2EGF : c'est
   * donc sur lui qu'il se vérifie, comme le fait déjà `npm run check:generated`.
   */
  it('functions/src/config/storeProfile.js == généré pour C2EGF', () => {
    expect(commite()).toBe(generateStoreProfileFile(resolveProfile('c2egf_burkina')))
  })

  /**
   * Et la divergence avec TAOFIC est elle-même une propriété à tenir : elle
   * prouve que le générateur LIT le profil au lieu de recracher des constantes.
   * Un générateur qui ignorerait l'axe rendrait les deux fichiers identiques —
   * et cette assertion échouerait, ce qui est exactement ce qu'on veut.
   */
  it('le profil d’un autre client produit un artefact DIFFÉRENT', () => {
    const taofic = generateStoreProfileFile(resolveProfile('taofic_ajagbe'))
    expect(taofic).not.toBe(commite())
    expect(taofic).toContain('STORE_REPLENISHMENT_SENDERS = []')
  })
})
