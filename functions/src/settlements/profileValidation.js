import { DealerRequestError } from '../errors.js'

const STORE_MEMBER_ROLES = new Set(['store_admin', 'member'])

export function validateSettlementProfile(profile, operationLabel) {
  if (!profile.active) {
    throw new DealerRequestError('PROFILE_INACTIVE', 'Compte désactivé.')
  }
  if (!STORE_MEMBER_ROLES.has(profile.role)) {
    throw new DealerRequestError(
      'ROLE_FORBIDDEN',
      `Seuls les membres de boutique peuvent enregistrer ${operationLabel}.`,
    )
  }
  const storeId = typeof profile.storeId === 'string' ? profile.storeId.trim() : ''
  if (!storeId) {
    throw new DealerRequestError('STORE_ID_REQUIRED', 'Profil sans boutique assignée.')
  }
  return storeId
}

export function validateSettlementTransactionProfile(profile, expectedStoreId) {
  if (!profile.active || !STORE_MEMBER_ROLES.has(profile.role)) {
    throw new DealerRequestError('ROLE_FORBIDDEN', 'Accès refusé (profil modifié).')
  }
  const storeId = typeof profile.storeId === 'string' ? profile.storeId.trim() : ''
  if (!storeId || storeId !== expectedStoreId) {
    throw new DealerRequestError('SETTLEMENT_STORE_MISMATCH', 'Boutique modifiée entre les lectures.')
  }
  return storeId
}
