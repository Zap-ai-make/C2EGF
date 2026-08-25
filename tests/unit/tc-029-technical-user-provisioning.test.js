// @vitest-environment node
/**
 * TC-029 — Provisioning comptes techniques : fonctions pures et métier
 *
 * Sections :
 *   ENV  — validateEmulatorEnv (gardes strictes, aucun fallback)
 *   V    — validateRole (strict, pas de normalisation silencieuse)
 *   E    — normalizeEmail
 *   N    — validateName
 *   P    — isProjectAllowed (sans allowReal)
 *   K    — checkEmulatorEnv (compatibilité)
 *   STR  — parseStrictArgs (rejet options inconnues, doublons, etc.)
 *   PRF  — validateProfileStructure (champs interdits, timestamps, custom claims)
 *   D    — buildProfileData / hasStoreFields
 *   X    — validateExistingProfile
 *   C    — computeProvisioningResult
 *   A    — buildAuditEntry (liste blanche stricte)
 *   R    — parseProvisioningArgs (compatibilité)
 *   CRE  — createTechnicalUser (avec dépendances injectées)
 *   VER  — verifyTechnicalUser (avec dépendances injectées)
 *   DEL  — deleteTechnicalUser (avec dépendances injectées)
 */

import { describe, it, expect, vi } from 'vitest'
import {
  TECHNICAL_ROLES,
  STORE_ROLES,
  FORBIDDEN_PROFILE_FIELDS,
  PRODUCTION_BLOCKED_PROJECTS,
  ParseError,
  AdminEnvError,
  validateEmulatorEnv,
  validateRole,
  normalizeEmail,
  validateName,
  isProjectAllowed,
  checkEmulatorEnv,
  parseStrictArgs,
  validateProfileStructure,
  buildProfileData,
  hasStoreFields,
  validateExistingProfile,
  computeProvisioningResult,
  buildAuditEntry,
  parseProvisioningArgs,
  createTechnicalUser,
  verifyTechnicalUser,
  deleteTechnicalUser,
} from '../../scripts/lib/technicalUserProvisioning.mjs'

// ─────────────────────────────────────────────
// Section ENV — validateEmulatorEnv
// ─────────────────────────────────────────────
describe('TC-029-ENV — validateEmulatorEnv (gardes strictes)', () => {
  const VALID = {
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    GCLOUD_PROJECT: 'demo-akayis-test',
  }

  it('ENV-1 : env valide complet → ok=true avec projectId', () => {
    const r = validateEmulatorEnv(VALID)
    expect(r.ok).toBe(true)
    expect(r.projectId).toBe('demo-akayis-test')
  })

  it('ENV-2 : taofic-ajagbe toujours bloqué (même avec émulateurs présents)', () => {
    const r = validateEmulatorEnv({ ...VALID, GCLOUD_PROJECT: 'taofic-ajagbe' })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('PRODUCTION_PROJECT_BLOCKED')
    expect(r.message).toMatch(/taofic-ajagbe/)
  })

  it('ENV-3 : FIREBASE_AUTH_EMULATOR_HOST absent → EMULATOR_ENV_REQUIRED', () => {
    const r = validateEmulatorEnv({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', GCLOUD_PROJECT: 'demo-test' })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('EMULATOR_ENV_REQUIRED')
    expect(r.message).toMatch(/FIREBASE_AUTH_EMULATOR_HOST/)
  })

  it('ENV-4 : FIRESTORE_EMULATOR_HOST absent → EMULATOR_ENV_REQUIRED', () => {
    const r = validateEmulatorEnv({ FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', GCLOUD_PROJECT: 'demo-test' })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('EMULATOR_ENV_REQUIRED')
    expect(r.message).toMatch(/FIRESTORE_EMULATOR_HOST/)
  })

  it('ENV-5 : GCLOUD_PROJECT absent → PROJECT_ID_REQUIRED', () => {
    const r = validateEmulatorEnv({
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('PROJECT_ID_REQUIRED')
  })

  it('ENV-6 : projet non-demo → NON_DEMO_PROJECT_BLOCKED', () => {
    const r = validateEmulatorEnv({ ...VALID, GCLOUD_PROJECT: 'my-prod-project' })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('NON_DEMO_PROJECT_BLOCKED')
    expect(r.message).toMatch(/my-prod-project/)
  })

  it('ENV-7 : AUTH_HOST vide (espaces) → EMULATOR_ENV_REQUIRED', () => {
    const r = validateEmulatorEnv({ ...VALID, FIREBASE_AUTH_EMULATOR_HOST: '   ' })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('EMULATOR_ENV_REQUIRED')
  })

  it('ENV-8 : env vide → erreur sans PRODUCTION_PROJECT_BLOCKED', () => {
    const r = validateEmulatorEnv({})
    expect(r.ok).toBe(false)
    expect(r.code).not.toBe('PRODUCTION_PROJECT_BLOCKED')
  })

  it('ENV-9 : GCLOUD_PROJECT vide string → PROJECT_ID_REQUIRED', () => {
    const r = validateEmulatorEnv({ ...VALID, GCLOUD_PROJECT: '' })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('PROJECT_ID_REQUIRED')
  })

  it('ENV-10 : AdminEnvError constructible avec code typé', () => {
    const err = new AdminEnvError('TEST_CODE', 'test message')
    expect(err.code).toBe('TEST_CODE')
    expect(err.name).toBe('AdminEnvError')
    expect(err instanceof Error).toBe(true)
  })
})

// ─────────────────────────────────────────────
// Section V — validateRole (strict)
// ─────────────────────────────────────────────
describe('TC-029-V — validateRole (strict)', () => {
  it('V-1 : system_manager exact accepté', () => {
    expect(() => validateRole('system_manager')).not.toThrow()
  })

  it('V-2 : dealer exact accepté', () => {
    expect(() => validateRole('dealer')).not.toThrow()
  })

  it('V-3 : store_admin refusé (rôle boutique)', () => {
    expect(() => validateRole('store_admin')).toThrow(ParseError)
    expect(() => validateRole('store_admin')).toThrow(/boutique/)
  })

  it('V-4 : rôle inconnu "admin" refusé', () => {
    expect(() => validateRole('admin')).toThrow(ParseError)
  })

  it('V-5 : rôle inconnu "cashier" refusé', () => {
    expect(() => validateRole('cashier')).toThrow(ParseError)
  })

  it('V-6 : rôle inconnu "superadmin" refusé', () => {
    expect(() => validateRole('superadmin')).toThrow(ParseError)
  })

  it('V-7 : vide refusé', () => {
    expect(() => validateRole('')).toThrow(ParseError)
  })

  it('V-8 : null refusé', () => {
    expect(() => validateRole(null)).toThrow(ParseError)
  })

  it('V-9 : undefined refusé', () => {
    expect(() => validateRole(undefined)).toThrow(ParseError)
  })

  it('V-10 : TECHNICAL_ROLES immuable avec exactement 2 rôles', () => {
    expect([...TECHNICAL_ROLES]).toEqual(['system_manager', 'dealer'])
  })

  it('V-11 : STORE_ROLES contient store_admin', () => {
    expect([...STORE_ROLES]).toContain('store_admin')
  })
})

// ─────────────────────────────────────────────
// Section E — normalizeEmail
// ─────────────────────────────────────────────
describe('TC-029-E — normalizeEmail', () => {
  it('E-1 : trim + lowercase appliqués', () => {
    expect(normalizeEmail('  MGMT@Example.TEST  ')).toBe('mgmt@example.test')
  })

  it('E-2 : email invalide sans @', () => {
    expect(() => normalizeEmail('notanemail')).toThrow(ParseError)
  })

  it('E-3 : null refusé', () => {
    expect(() => normalizeEmail(null)).toThrow(ParseError)
  })

  it('E-4 : TLD court refusé', () => {
    expect(() => normalizeEmail('user@domain')).toThrow(/invalide/)
  })

  it('E-5 : .test TLD accepté', () => {
    expect(() => normalizeEmail('x@y.test')).not.toThrow()
  })

  it('E-6 : espaces seuls refusés', () => {
    expect(() => normalizeEmail('   ')).toThrow()
  })
})

// ─────────────────────────────────────────────
// Section N — validateName
// ─────────────────────────────────────────────
describe('TC-029-N — validateName', () => {
  it('N-1 : nom valide accepté', () => {
    expect(() => validateName('Gérant Global')).not.toThrow()
  })

  it('N-2 : espaces seuls refusés', () => {
    expect(() => validateName('   ')).toThrow(ParseError)
  })

  it('N-3 : un seul caractère refusé', () => {
    expect(() => validateName('X')).toThrow(ParseError)
  })

  it('N-4 : null refusé', () => {
    expect(() => validateName(null)).toThrow(ParseError)
  })

  it('N-5 : undefined refusé', () => {
    expect(() => validateName(undefined)).toThrow(ParseError)
  })
})

// ─────────────────────────────────────────────
// Section P — isProjectAllowed (sans allowReal)
// ─────────────────────────────────────────────
describe('TC-029-P — isProjectAllowed', () => {
  it('P-1 : demo-akayis-test autorisé', () => {
    expect(isProjectAllowed('demo-akayis-test')).toBe(true)
  })

  it('P-2 : taofic-ajagbe refusé absolument', () => {
    expect(isProjectAllowed('taofic-ajagbe')).toBe(false)
  })

  it('P-3 : projet non-demo refusé', () => {
    expect(isProjectAllowed('my-prod')).toBe(false)
    expect(isProjectAllowed('akayis-test')).toBe(false)
  })

  it('P-4 : null refusé', () => {
    expect(isProjectAllowed(null)).toBe(false)
  })

  it('P-5 : PRODUCTION_BLOCKED_PROJECTS contient taofic-ajagbe', () => {
    expect([...PRODUCTION_BLOCKED_PROJECTS]).toContain('taofic-ajagbe')
  })
})

// ─────────────────────────────────────────────
// Section K — checkEmulatorEnv (compat)
// ─────────────────────────────────────────────
describe('TC-029-K — checkEmulatorEnv', () => {
  it('K-1 : toutes variables → ok', () => {
    const r = checkEmulatorEnv({ FIREBASE_AUTH_EMULATOR_HOST: 'x', FIRESTORE_EMULATOR_HOST: 'y', GCLOUD_PROJECT: 'z' })
    expect(r.ok).toBe(true)
  })

  it('K-2 : manquant → ok=false avec liste', () => {
    const r = checkEmulatorEnv({ FIRESTORE_EMULATOR_HOST: 'y', GCLOUD_PROJECT: 'z' })
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('FIREBASE_AUTH_EMULATOR_HOST')
  })

  it('K-3 : env vide → 3 manquantes', () => {
    const r = checkEmulatorEnv({})
    expect(r.missing).toHaveLength(3)
  })
})

// ─────────────────────────────────────────────
// Section STR — parseStrictArgs
// ─────────────────────────────────────────────
describe('TC-029-STR — parseStrictArgs (strict)', () => {
  const schema = { keys: ['role', 'email', 'name'], flags: ['confirm', 'show-reset-link'] }

  it('STR-1 : --key=value parsé', () => {
    const r = parseStrictArgs(['node', 's.mjs', '--role=system_manager'], schema)
    expect(r.role).toBe('system_manager')
  })

  it('STR-2 : --key value parsé', () => {
    const r = parseStrictArgs(['node', 's.mjs', '--role', 'dealer'], schema)
    expect(r.role).toBe('dealer')
  })

  it('STR-3 : flag booléen --confirm sans valeur', () => {
    const r = parseStrictArgs(['node', 's.mjs', '--confirm'], schema)
    expect(r.confirm).toBe(true)
  })

  it('STR-4 : option inconnue → ParseError', () => {
    expect(() => parseStrictArgs(['node', 's.mjs', '--unknown'], schema)).toThrow(ParseError)
    expect(() => parseStrictArgs(['node', 's.mjs', '--unknown'], schema)).toThrow(/inconnue/)
  })

  it('STR-5 : argument positionnel → ParseError', () => {
    expect(() => parseStrictArgs(['node', 's.mjs', 'positionnel'], schema)).toThrow(ParseError)
    expect(() => parseStrictArgs(['node', 's.mjs', 'positionnel'], schema)).toThrow(/positionnel/)
  })

  it('STR-6 : option dupliquée --key=v --key=v2 → ParseError', () => {
    expect(() =>
      parseStrictArgs(['node', 's.mjs', '--role=dealer', '--role=system_manager'], schema)
    ).toThrow(ParseError)
    expect(() =>
      parseStrictArgs(['node', 's.mjs', '--role=dealer', '--role=system_manager'], schema)
    ).toThrow(/dupliqué/)
  })

  it('STR-7 : valeur manquante en fin de liste → ParseError', () => {
    expect(() => parseStrictArgs(['node', 's.mjs', '--role'], schema)).toThrow(ParseError)
    expect(() => parseStrictArgs(['node', 's.mjs', '--role'], schema)).toThrow(/manquante/)
  })

  it('STR-8 : valeur suivante commence par -- → ParseError', () => {
    expect(() => parseStrictArgs(['node', 's.mjs', '--role', '--email'], schema)).toThrow(ParseError)
  })

  it('STR-9 : valeur vide --key= → ParseError', () => {
    expect(() => parseStrictArgs(['node', 's.mjs', '--role='], schema)).toThrow(ParseError)
    expect(() => parseStrictArgs(['node', 's.mjs', '--role='], schema)).toThrow(/vide/)
  })

  it('STR-10 : flag dupliqué → ParseError', () => {
    expect(() =>
      parseStrictArgs(['node', 's.mjs', '--confirm', '--confirm'], schema)
    ).toThrow(ParseError)
  })

  it('STR-11 : flag avec valeur via = → ParseError', () => {
    expect(() =>
      parseStrictArgs(['node', 's.mjs', '--confirm=true'], schema)
    ).toThrow(ParseError)
  })

  it('STR-12 : plusieurs clés valides en même temps', () => {
    const r = parseStrictArgs(
      ['node', 's.mjs', '--role=dealer', '--email=x@y.test', '--name', 'Amine'],
      schema
    )
    expect(r.role).toBe('dealer')
    expect(r.email).toBe('x@y.test')
    expect(r.name).toBe('Amine')
  })
})

// ─────────────────────────────────────────────
// Section PRF — validateProfileStructure
// ─────────────────────────────────────────────
describe('TC-029-PRF — validateProfileStructure', () => {
  const fakeTs = { toDate: () => new Date() }
  const validProfile = {
    name: 'Gérant Test',
    email: 'mgr@test.com',
    role: 'system_manager',
    active: true,
    createdAt: fakeTs,
    updatedAt: fakeTs,
    lastLogin: null,
  }
  const fakeAuth = { email: 'mgr@test.com', disabled: false, customClaims: {} }

  it('PRF-1 : profil valide → 0 erreurs', () => {
    expect(validateProfileStructure(validProfile, fakeAuth, 'system_manager')).toHaveLength(0)
  })

  it('PRF-2 : storeId présent (non-null) → erreur', () => {
    const errs = validateProfileStructure({ ...validProfile, storeId: 'store-1' }, fakeAuth)
    expect(errs.some(e => e.includes('storeId'))).toBe(true)
  })

  it('PRF-3 : storeId=null présent → erreur (champ interdit même null)', () => {
    const errs = validateProfileStructure({ ...validProfile, storeId: null }, fakeAuth)
    expect(errs.some(e => e.includes('storeId'))).toBe(true)
  })

  it('PRF-4 : storeName=\'\' présent → erreur', () => {
    const errs = validateProfileStructure({ ...validProfile, storeName: '' }, fakeAuth)
    expect(errs.some(e => e.includes('storeName'))).toBe(true)
  })

  it('PRF-5 : dealerId présent → erreur', () => {
    const errs = validateProfileStructure({ ...validProfile, dealerId: 'd-1' }, fakeAuth)
    expect(errs.some(e => e.includes('dealerId'))).toBe(true)
  })

  it('PRF-6 : adminUid présent → erreur', () => {
    const errs = validateProfileStructure({ ...validProfile, adminUid: 'u-1' }, fakeAuth)
    expect(errs.some(e => e.includes('adminUid'))).toBe(true)
  })

  it('PRF-7 : boutiqueId présent → erreur', () => {
    const errs = validateProfileStructure({ ...validProfile, boutiqueId: 'b-1' }, fakeAuth)
    expect(errs.some(e => e.includes('boutiqueId'))).toBe(true)
  })

  it('PRF-8 : active=false → erreur', () => {
    const errs = validateProfileStructure({ ...validProfile, active: false }, fakeAuth)
    expect(errs.some(e => e.includes('active'))).toBe(true)
  })

  it('PRF-9 : active absent → erreur', () => {
    const p = Object.fromEntries(Object.entries(validProfile).filter(([k]) => k !== 'active'))
    const errs = validateProfileStructure(p, fakeAuth)
    expect(errs.some(e => e.includes('active'))).toBe(true)
  })

  it('PRF-10 : createdAt absent → erreur', () => {
    const p = Object.fromEntries(Object.entries(validProfile).filter(([k]) => k !== 'createdAt'))
    const errs = validateProfileStructure(p, fakeAuth)
    expect(errs.some(e => e.includes('createdAt'))).toBe(true)
  })

  it('PRF-11 : updatedAt absent → erreur', () => {
    const p = Object.fromEntries(Object.entries(validProfile).filter(([k]) => k !== 'updatedAt'))
    const errs = validateProfileStructure(p, fakeAuth)
    expect(errs.some(e => e.includes('updatedAt'))).toBe(true)
  })

  it('PRF-12 : email Auth ≠ Firestore → erreur cohérence', () => {
    const errs = validateProfileStructure(validProfile, { ...fakeAuth, email: 'other@test.com' })
    expect(errs.some(e => e.includes('incohérent'))).toBe(true)
  })

  it('PRF-13 : rôle demandé différent → erreur', () => {
    const errs = validateProfileStructure(validProfile, fakeAuth, 'dealer')
    expect(errs.some(e => e.includes('dealer'))).toBe(true)
  })

  it('PRF-14 : custom claim store_admin → erreur absolue', () => {
    const errs = validateProfileStructure(validProfile, { ...fakeAuth, customClaims: { role: 'store_admin' } })
    expect(errs.some(e => e.includes('store_admin'))).toBe(true)
  })

  it('PRF-15 : custom claim rôle ≠ profil → erreur', () => {
    const errs = validateProfileStructure(
      validProfile,
      { ...fakeAuth, customClaims: { role: 'dealer' } },
      'system_manager'
    )
    expect(errs.some(e => e.includes('claim'))).toBe(true)
  })

  it('PRF-16 : role=store_admin dans profil → erreur boutique', () => {
    const errs = validateProfileStructure({ ...validProfile, role: 'store_admin' }, fakeAuth)
    expect(errs.some(e => e.includes('boutique') || e.includes('store_admin'))).toBe(true)
  })

  it('PRF-17 : name absent → erreur', () => {
    const p = Object.fromEntries(Object.entries(validProfile).filter(([k]) => k !== 'name'))
    const errs = validateProfileStructure(p, fakeAuth)
    expect(errs.some(e => e.includes('name'))).toBe(true)
  })

  it('PRF-18 : FORBIDDEN_PROFILE_FIELDS contient exactement 5 champs', () => {
    expect([...FORBIDDEN_PROFILE_FIELDS]).toEqual(
      expect.arrayContaining(['storeId', 'storeName', 'dealerId', 'adminUid', 'boutiqueId'])
    )
    expect(FORBIDDEN_PROFILE_FIELDS).toHaveLength(5)
  })
})

// ─────────────────────────────────────────────
// Section D — buildProfileData / hasStoreFields
// ─────────────────────────────────────────────
describe('TC-029-D — buildProfileData / hasStoreFields', () => {
  it('D-1 : profil sans champs boutique', () => {
    const p = buildProfileData({ uid: 'u1', email: 'x@test.com', name: 'Test', role: 'dealer' })
    expect(p.storeId).toBeUndefined()
    expect(p.storeName).toBeUndefined()
    expect(p.active).toBe(true)
    expect(p.lastLogin).toBeNull()
  })

  it('D-2 : hasStoreFields → false pour profil propre', () => {
    expect(hasStoreFields({ role: 'system_manager', active: true })).toBe(false)
  })

  it('D-3 : hasStoreFields → true pour storeId non-null', () => {
    expect(hasStoreFields({ storeId: 's-1' })).toBe(true)
  })

  it('D-4 : hasStoreFields → true pour storeId=null (champ présent)', () => {
    expect(hasStoreFields({ storeId: null })).toBe(true)
  })

  it('D-5 : hasStoreFields → true pour dealerId', () => {
    expect(hasStoreFields({ dealerId: 'd-1' })).toBe(true)
  })

  it('D-6 : hasStoreFields → false pour null', () => {
    expect(hasStoreFields(null)).toBe(false)
  })
})

// ─────────────────────────────────────────────
// Section X — validateExistingProfile
// ─────────────────────────────────────────────
describe('TC-029-X — validateExistingProfile', () => {
  it('X-1 : profil correspondant → valid', () => {
    const r = validateExistingProfile({ role: 'system_manager', active: true }, 'system_manager')
    expect(r.valid).toBe(true)
  })

  it('X-2 : store_admin → ROLE_CONFLICT_STORE_ADMIN', () => {
    const r = validateExistingProfile({ role: 'store_admin' }, 'system_manager')
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('ROLE_CONFLICT_STORE_ADMIN')
  })

  it('X-3 : rôle différent → ROLE_CONFLICT_EXISTING', () => {
    const r = validateExistingProfile({ role: 'dealer', active: true }, 'system_manager')
    expect(r.valid).toBe(false)
    expect(r.reason).toContain('ROLE_CONFLICT_EXISTING')
  })

  it('X-4 : storeId présent → PROFILE_HAS_STORE_FIELDS', () => {
    const r = validateExistingProfile({ role: 'system_manager', active: true, storeId: 's-1' }, 'system_manager')
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('PROFILE_HAS_STORE_FIELDS')
  })

  it('X-5 : inactif → ACCOUNT_INACTIVE', () => {
    const r = validateExistingProfile({ role: 'system_manager', active: false }, 'system_manager')
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('ACCOUNT_INACTIVE')
  })

  it('X-6 : null → PROFILE_ABSENT', () => {
    const r = validateExistingProfile(null, 'dealer')
    expect(r.reason).toBe('PROFILE_ABSENT')
  })
})

// ─────────────────────────────────────────────
// Section C — computeProvisioningResult
// ─────────────────────────────────────────────
describe('TC-029-C — computeProvisioningResult', () => {
  it('C-1 : ni Auth ni profil → CREATED', () => {
    expect(computeProvisioningResult({ authExists: false, profileExists: false, profileMatchesRole: null, isStoreAdmin: false })).toBe('CREATED')
  })

  it('C-2 : Auth sans profil → PROFILE_CREATED', () => {
    expect(computeProvisioningResult({ authExists: true, profileExists: false, profileMatchesRole: null, isStoreAdmin: false })).toBe('PROFILE_CREATED')
  })

  it('C-3 : Auth + profil valide → UNCHANGED', () => {
    expect(computeProvisioningResult({ authExists: true, profileExists: true, profileMatchesRole: true, isStoreAdmin: false })).toBe('UNCHANGED')
  })

  it('C-4 : store_admin → ROLE_CONFLICT', () => {
    expect(computeProvisioningResult({ authExists: true, profileExists: true, profileMatchesRole: true, isStoreAdmin: true })).toBe('ROLE_CONFLICT')
  })

  it('C-5 : profil avec rôle différent → ROLE_CONFLICT', () => {
    expect(computeProvisioningResult({ authExists: true, profileExists: true, profileMatchesRole: false, isStoreAdmin: false })).toBe('ROLE_CONFLICT')
  })

  it('C-6 : profil inactif → ACCOUNT_INACTIVE', () => {
    expect(computeProvisioningResult({ authExists: true, profileExists: true, profileMatchesRole: true, isStoreAdmin: false, profileInactive: true })).toBe('ACCOUNT_INACTIVE')
  })
})

// ─────────────────────────────────────────────
// Section A — buildAuditEntry (liste blanche)
// ─────────────────────────────────────────────
describe('TC-029-A — buildAuditEntry (liste blanche stricte)', () => {
  const base = {
    action: 'TECHNICAL_USER_CREATED',
    targetUid: 'uid-1',
    targetEmail: 'x@test.com',
    targetRole: 'system_manager',
    projectId: 'demo-akayis-test',
    isEmulator: true,
  }

  it('A-1 : entrée valide générée avec liste blanche', () => {
    const e = buildAuditEntry(base)
    expect(e.action).toBe('TECHNICAL_USER_CREATED')
    expect(e.actorType).toBe('provisioning_script')
    expect(e.emulator).toBe(true)
  })

  it('A-2 : aucun secret dans l\'entrée', () => {
    const e = buildAuditEntry(base)
    const str = JSON.stringify(e)
    expect(str).not.toMatch(/password/i)
    expect(str).not.toMatch(/resetLink/i)
    expect(str).not.toMatch(/oobCode/i)
    expect(str).not.toMatch(/token/i)
  })

  it('A-3 : action inconnue → erreur', () => {
    expect(() => buildAuditEntry({ ...base, action: 'UNKNOWN_ACTION' })).toThrow()
  })

  it('A-4 : targetUid absent → null', () => {
    const e = buildAuditEntry({ ...base, targetUid: undefined })
    expect(e.targetUid).toBeNull()
  })

  it('A-5 : metadata libre filtrée — seule liste blanche conservée', () => {
    const e = buildAuditEntry({
      ...base,
      metadata: {
        result: 'CREATED',
        password: 'DOIT-ETRE-FILTRE',
        token: 'DOIT-ETRE-FILTRE',
        rollbackAttempted: true,
        rollbackSucceeded: false,
        errorCode: 'SOME_ERROR',
      },
    })
    expect(e.metadata.result).toBe('CREATED')
    expect(e.metadata.rollbackAttempted).toBe(true)
    expect(e.metadata.rollbackSucceeded).toBe(false)
    expect(e.metadata.errorCode).toBe('SOME_ERROR')
    expect(Object.prototype.hasOwnProperty.call(e.metadata, 'password')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(e.metadata, 'token')).toBe(false)
  })

  it('A-6 : TECHNICAL_USER_DELETED accepté', () => {
    expect(() => buildAuditEntry({ ...base, action: 'TECHNICAL_USER_DELETED' })).not.toThrow()
  })

  it('A-7 : TECHNICAL_USER_CREATION_FAILED accepté', () => {
    expect(() => buildAuditEntry({ ...base, action: 'TECHNICAL_USER_CREATION_FAILED' })).not.toThrow()
  })

  it('A-8 : TECHNICAL_USER_DELETION_FAILED accepté', () => {
    expect(() => buildAuditEntry({ ...base, action: 'TECHNICAL_USER_DELETION_FAILED' })).not.toThrow()
  })
})

// ─────────────────────────────────────────────
// Section R — parseProvisioningArgs (compat)
// ─────────────────────────────────────────────
describe('TC-029-R — parseProvisioningArgs (compatibilité)', () => {
  it('R-1 : --role=system_manager', () => {
    expect(parseProvisioningArgs(['node', 's.mjs', '--role=system_manager']).role).toBe('system_manager')
  })

  it('R-2 : --role dealer (espace)', () => {
    expect(parseProvisioningArgs(['node', 's.mjs', '--role', 'dealer']).role).toBe('dealer')
  })

  it('R-3 : --confirm détecté', () => {
    expect(parseProvisioningArgs(['node', 's.mjs', '--confirm']).confirm).toBe(true)
  })

  it('R-4 : sans --confirm → false', () => {
    expect(parseProvisioningArgs(['node', 's.mjs']).confirm).toBe(false)
  })
})

// ─────────────────────────────────────────────
// Section CRE — createTechnicalUser (injecté)
// ─────────────────────────────────────────────
describe('TC-029-CRE — createTechnicalUser (dépendances injectées)', () => {
  const email = 'test-create@akayis.test'
  const role = 'system_manager'
  const name = 'Test SM'
  const fakeTs = { toDate: () => new Date() }

  function makeDeps(overrides = {}) {
    const authMock = {
      getUserByEmail: vi.fn().mockRejectedValue(Object.assign(new Error('nf'), { code: 'auth/user-not-found' })),
      createUser: vi.fn().mockResolvedValue({ uid: 'new-uid-123' }),
      deleteUser: vi.fn().mockResolvedValue(),
      generatePasswordResetLink: vi.fn().mockResolvedValue('http://127.0.0.1:9099/reset?oobCode=HIDDEN'),
    }
    const docMock = {
      get: vi.fn().mockResolvedValue({ exists: false }),
      set: vi.fn().mockResolvedValue(),
      delete: vi.fn().mockResolvedValue(),
    }
    const dbMock = {
      doc: vi.fn().mockReturnValue(docMock),
      collection: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ docs: [] }) }),
        add: vi.fn().mockResolvedValue({ id: 'audit-id' }),
      }),
    }
    return {
      auth: authMock,
      db: dbMock,
      projectId: 'demo-akayis-test',
      isEmulator: true,
      generateResetLink: authMock.generatePasswordResetLink,
      writeAudit: vi.fn().mockResolvedValue({ id: 'audit-id' }),
      ...overrides,
    }
  }

  it('CRE-1 : création normale → CREATED, resetLink absent du résultat', async () => {
    const deps = makeDeps()
    const result = await createTechnicalUser({ email, name, role }, deps)
    expect(result.result).toBe('CREATED')
    expect(result.uid).toBe('new-uid-123')
    expect(result.resetLinkGenerated).toBe(true)
    expect(result.resetLink).toBeUndefined()
  })

  it('CRE-2 : onResetLink appelé avec le lien, pas dans le résultat', async () => {
    const deps = makeDeps()
    let captured = null
    const result = await createTechnicalUser({ email, name, role, onResetLink: (l) => { captured = l } }, deps)
    expect(result.result).toBe('CREATED')
    expect(captured).toBe('http://127.0.0.1:9099/reset?oobCode=HIDDEN')
    expect(result.resetLink).toBeUndefined()
  })

  it('CRE-3 : UNCHANGED si Auth + profil valide (aucune écriture)', async () => {
    const existingProfile = { name, email, role: 'system_manager', active: true, createdAt: fakeTs, updatedAt: fakeTs, lastLogin: null }
    const setMock = vi.fn()
    const deps = makeDeps({
      auth: {
        getUserByEmail: vi.fn().mockResolvedValue({ uid: 'existing-uid', email, disabled: false, customClaims: {} }),
        createUser: vi.fn(),
      },
      db: {
        doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: true, data: () => existingProfile }), set: setMock }),
        collection: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ docs: [] }) }) }),
      },
    })
    const result = await createTechnicalUser({ email, name, role }, deps)
    expect(result.result).toBe('UNCHANGED')
    expect(setMock).not.toHaveBeenCalled()
  })

  it('CRE-4 : ROLE_CONFLICT si custom claim store_admin', async () => {
    const deps = makeDeps({
      auth: {
        getUserByEmail: vi.fn().mockResolvedValue({ uid: 'uid-x', email, disabled: false, customClaims: { role: 'store_admin' } }),
      },
    })
    const result = await createTechnicalUser({ email, name, role }, deps)
    expect(result.result).toBe('ROLE_CONFLICT')
  })

  it('CRE-5 : EMAIL_UID_CONFLICT si profil concurrent', async () => {
    const deps = makeDeps({
      auth: {
        getUserByEmail: vi.fn().mockResolvedValue({ uid: 'uid-1', email, disabled: false, customClaims: {} }),
      },
      db: {
        doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: false }) }),
        collection: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ docs: [{ id: 'other-uid', data: () => ({ email, role: 'dealer' }) }] }),
          }),
          add: vi.fn().mockResolvedValue({ id: 'audit-id' }),
        }),
      },
    })
    const result = await createTechnicalUser({ email, name, role }, deps)
    expect(result.result).toBe('EMAIL_UID_CONFLICT')
  })

  it('CRE-6 : rollback Auth si Firestore création échoue', async () => {
    const deleteUser = vi.fn().mockResolvedValue()
    const deps = makeDeps({
      auth: {
        getUserByEmail: vi.fn().mockRejectedValue(Object.assign(new Error('nf'), { code: 'auth/user-not-found' })),
        createUser: vi.fn().mockResolvedValue({ uid: 'new-uid-rb' }),
        deleteUser,
      },
      db: {
        doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: false }), set: vi.fn().mockRejectedValue(new Error('FS fail')), delete: vi.fn() }),
        collection: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ docs: [] }) }), add: vi.fn().mockResolvedValue({ id: 'a' }) }),
      },
    })
    const result = await createTechnicalUser({ email, name, role }, deps)
    expect(result.result).toBe('FIRESTORE_CREATE_FAILED')
    expect(result.rollbackAttempted).toBe(true)
    expect(deleteUser).toHaveBeenCalledWith('new-uid-rb')
  })

  it('CRE-7 : rollback complet si generateResetLink échoue', async () => {
    const deleteUser = vi.fn().mockResolvedValue()
    const deleteDoc = vi.fn().mockResolvedValue()
    const deps = makeDeps({
      auth: {
        getUserByEmail: vi.fn().mockRejectedValue(Object.assign(new Error('nf'), { code: 'auth/user-not-found' })),
        createUser: vi.fn().mockResolvedValue({ uid: 'new-uid-rl' }),
        deleteUser,
      },
      db: {
        doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: false }), set: vi.fn().mockResolvedValue(), delete: deleteDoc }),
        collection: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ docs: [] }) }), add: vi.fn().mockResolvedValue({ id: 'a' }) }),
      },
      generateResetLink: vi.fn().mockRejectedValue(new Error('Reset fail')),
    })
    const result = await createTechnicalUser({ email, name, role }, deps)
    expect(result.result).toBe('RESET_LINK_FAILED')
    expect(result.rollbackAttempted).toBe(true)
    expect(deleteDoc).toHaveBeenCalled()
    expect(deleteUser).toHaveBeenCalledWith('new-uid-rl')
  })

  it('CRE-8 : CREATED_WITH_AUDIT_FAILURE — compte intact si audit échoue', async () => {
    const deps = makeDeps({
      writeAudit: vi.fn().mockRejectedValue(new Error('Audit error')),
    })
    const result = await createTechnicalUser({ email, name, role }, deps)
    expect(result.result).toBe('CREATED_WITH_AUDIT_FAILURE')
    expect(result.uid).toBe('new-uid-123')
    expect(result.auditError).toBeDefined()
  })

  it('CRE-9 : PROFILE_CREATED si Auth préexistant sans profil', async () => {
    const createUser = vi.fn()
    const deps = makeDeps({
      auth: {
        getUserByEmail: vi.fn().mockResolvedValue({ uid: 'exist-auth-uid', email, disabled: false, customClaims: {} }),
        createUser,
        generatePasswordResetLink: vi.fn().mockResolvedValue('http://link'),
      },
    })
    const result = await createTechnicalUser({ email, name, role }, deps)
    expect(result.result).toBe('PROFILE_CREATED')
    expect(result.uid).toBe('exist-auth-uid')
    expect(createUser).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────
// Section VER — verifyTechnicalUser (injecté)
// ─────────────────────────────────────────────
describe('TC-029-VER — verifyTechnicalUser (dépendances injectées)', () => {
  const email = 'verify-test@akayis.test'
  const role = 'dealer'
  const fakeTs = { toDate: () => new Date() }

  function makeVerifyDeps(profileData = null, authOverrides = {}) {
    return {
      auth: {
        getUserByEmail: vi.fn().mockResolvedValue({
          uid: 'uid-verify-1', email, disabled: false, customClaims: {},
          ...authOverrides,
        }),
      },
      db: {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ exists: profileData !== null, data: () => profileData }),
        }),
        collection: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ docs: [] }) }),
        }),
      },
    }
  }

  it('VER-1 : VALID pour profil complet dealer', async () => {
    const profile = { name: 'Dealer Test', email, role: 'dealer', active: true, createdAt: fakeTs, updatedAt: fakeTs, lastLogin: null }
    const result = await verifyTechnicalUser({ email, role }, makeVerifyDeps(profile))
    expect(result.result).toBe('VALID')
    expect(result.uid).toBe('uid-verify-1')
  })

  it('VER-2 : NOT_FOUND si compte Auth absent', async () => {
    const deps = {
      auth: { getUserByEmail: vi.fn().mockRejectedValue(Object.assign(new Error(), { code: 'auth/user-not-found' })) },
      db: { doc: vi.fn(), collection: vi.fn() },
    }
    const result = await verifyTechnicalUser({ email, role }, deps)
    expect(result.result).toBe('NOT_FOUND')
  })

  it('VER-3 : INVALID si profil Firestore absent', async () => {
    const result = await verifyTechnicalUser({ email, role }, makeVerifyDeps(null))
    expect(result.result).toBe('INVALID')
  })

  it('VER-4 : INVALID si active=false', async () => {
    const profile = { name: 'T', email, role: 'dealer', active: false, createdAt: fakeTs, updatedAt: fakeTs, lastLogin: null }
    const result = await verifyTechnicalUser({ email, role }, makeVerifyDeps(profile))
    expect(result.result).toBe('INVALID')
  })

  it('VER-5 : INVALID si rôle ne correspond pas', async () => {
    const profile = { name: 'T', email, role: 'system_manager', active: true, createdAt: fakeTs, updatedAt: fakeTs, lastLogin: null }
    const result = await verifyTechnicalUser({ email, role: 'dealer' }, makeVerifyDeps(profile))
    expect(result.result).toBe('INVALID')
  })
})

// ─────────────────────────────────────────────
// Section DEL — deleteTechnicalUser (injecté)
// ─────────────────────────────────────────────
describe('TC-029-DEL — deleteTechnicalUser (dépendances injectées)', () => {
  const email = 'del-test@akayis.test'
  const uid = 'uid-del-1'
  const fakeTs = { toDate: () => new Date() }
  const validProfile = { name: 'Del Test', email, role: 'dealer', active: true, createdAt: fakeTs, updatedAt: fakeTs, lastLogin: null }

  function makeDelDeps(profileData = validProfile, authExtra = {}) {
    const docMock = {
      get: vi.fn().mockResolvedValue({ exists: profileData !== null, data: () => profileData }),
      delete: vi.fn().mockResolvedValue(),
      set: vi.fn().mockResolvedValue(),
    }
    return {
      auth: {
        getUserByEmail: vi.fn().mockResolvedValue({ uid, email, disabled: false, customClaims: {}, ...authExtra }),
        deleteUser: vi.fn().mockResolvedValue(),
      },
      db: {
        doc: vi.fn().mockReturnValue(docMock),
        collection: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ docs: [] }) }),
          add: vi.fn().mockResolvedValue({ id: 'a' }),
        }),
      },
      projectId: 'demo-akayis-test',
      isEmulator: true,
      writeAudit: vi.fn().mockResolvedValue({ id: 'a' }),
    }
  }

  it('DEL-1 : DELETED pour compte dealer valide', async () => {
    const deps = makeDelDeps()
    const result = await deleteTechnicalUser({ email }, deps)
    expect(result.result).toBe('DELETED')
    expect(result.uid).toBe(uid)
    expect(deps.auth.deleteUser).toHaveBeenCalledWith(uid)
  })

  it('DEL-2 : NOT_FOUND si Auth absent', async () => {
    const deps = makeDelDeps()
    deps.auth.getUserByEmail = vi.fn().mockRejectedValue(Object.assign(new Error(), { code: 'auth/user-not-found' }))
    const result = await deleteTechnicalUser({ email }, deps)
    expect(result.result).toBe('NOT_FOUND')
  })

  it('DEL-3 : ROLE_CONFLICT pour store_admin', async () => {
    const storeProfile = { ...validProfile, role: 'store_admin', storeId: 's-1' }
    const deps = makeDelDeps(storeProfile)
    const result = await deleteTechnicalUser({ email }, deps)
    expect(result.result).toBe('ROLE_CONFLICT')
    expect(deps.auth.deleteUser).not.toHaveBeenCalled()
  })

  it('DEL-4 : rollback Firestore si suppression Auth échoue', async () => {
    const restoreSet = vi.fn().mockResolvedValue()
    const deps = makeDelDeps()
    deps.auth.deleteUser = vi.fn().mockRejectedValue(new Error('Auth delete fail'))
    deps.db.doc().set = restoreSet

    const result = await deleteTechnicalUser({ email }, deps)
    expect(result.result).toBe('AUTH_DELETE_FAILED')
    expect(result.rollbackAttempted).toBe(true)
    expect(restoreSet).toHaveBeenCalled()
  })

  it('DEL-5 : refusé hors émulateur → AdminEnvError', async () => {
    const deps = makeDelDeps()
    deps.isEmulator = false
    await expect(deleteTechnicalUser({ email }, deps)).rejects.toThrow(/émulateur/)
  })

  it('DEL-6 : INVALID si profil Firestore absent (Auth orphelin)', async () => {
    const deps = makeDelDeps(null)
    const result = await deleteTechnicalUser({ email }, deps)
    expect(result.result).toBe('INVALID')
  })
})
