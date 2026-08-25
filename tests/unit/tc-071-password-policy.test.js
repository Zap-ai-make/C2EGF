// @vitest-environment node
/**
 * TC-071 — Politique de mot de passe : renforcement des NOUVEAUX mots de passe
 * sans régression de la connexion des comptes existants.
 *
 * Invariant de caractérisation (le plus important) :
 *   La validation de CONNEXION reste au plancher Firebase (6 caractères).
 *   Relever ce plancher verrouillerait les comptes déjà créés avec 6–7 caractères.
 *
 * Nouveau comportement :
 *   Tout NOUVEAU mot de passe (inscription, changement) exige ≥ 8 caractères,
 *   via isValidNewPassword / MIN_NEW_PASSWORD_LENGTH.
 */

import { describe, it, expect } from 'vitest'
import {
  isValidPassword,
  isValidNewPassword,
  validateFormFields,
} from '../../src/utils/authHelpers'
import { AUTH_CONFIG, AUTH_ERRORS } from '../../src/constants/authMessages'

describe('TC-071 — Plancher de connexion préservé (min 6)', () => {
  it('MIN_PASSWORD_LENGTH reste à 6 (plancher Firebase)', () => {
    expect(AUTH_CONFIG.MIN_PASSWORD_LENGTH).toBe(6)
  })

  it('isValidPassword accepte 6 caractères (compte existant)', () => {
    expect(isValidPassword('abc123')).toBe(true)
    expect(isValidPassword('abc1234')).toBe(true) // 7
  })

  it('isValidPassword refuse < 6', () => {
    expect(isValidPassword('abc12')).toBeFalsy() // 5
  })

  it('validateFormFields NE bloque PAS un mot de passe de 6 caractères (connexion)', () => {
    const { errors } = validateFormFields({ email: 'user@test.com', password: 'abc123' })
    expect(errors.password).toBeUndefined()
  })

  it('validateFormFields refuse encore un mot de passe de 5 caractères', () => {
    const { errors } = validateFormFields({ email: 'user@test.com', password: 'abc12' })
    expect(errors.password).toBeDefined()
  })
})

describe('TC-071 — Nouveaux mots de passe renforcés (min 8)', () => {
  it('MIN_NEW_PASSWORD_LENGTH vaut 8', () => {
    expect(AUTH_CONFIG.MIN_NEW_PASSWORD_LENGTH).toBe(8)
  })

  it('isValidNewPassword refuse 6 et 7 caractères', () => {
    expect(isValidNewPassword('abc123')).toBeFalsy()  // 6
    expect(isValidNewPassword('abc1234')).toBeFalsy() // 7
  })

  it('isValidNewPassword accepte 8 caractères et plus', () => {
    expect(isValidNewPassword('abcd1234')).toBe(true)   // 8
    expect(isValidNewPassword('abcd12345')).toBe(true)  // 9
  })

  it('isValidNewPassword gère les entrées vides', () => {
    expect(isValidNewPassword('')).toBeFalsy()
    expect(isValidNewPassword(undefined)).toBeFalsy()
  })

  it('le message NEW_PASSWORD_MIN_LENGTH mentionne 8 caractères', () => {
    expect(AUTH_ERRORS.NEW_PASSWORD_MIN_LENGTH).toContain('8')
  })
})
