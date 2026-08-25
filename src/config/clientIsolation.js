const DEFAULT_CLIENT_ID = 'nouveau_client'

const normalizeClientId = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return normalized || DEFAULT_CLIENT_ID
}

export const CLIENT_ID = normalizeClientId(import.meta.env.VITE_CLIENT_ID)

export const getStorageKey = (key) => `${CLIENT_ID}_${key}`

export const getFirestoreCollectionPath = (collectionName) => {
  if (import.meta.env.VITE_FIRESTORE_USE_CLIENT_NAMESPACE === 'false') {
    return collectionName
  }

  return `clients/${CLIENT_ID}/${collectionName}`
}

export const clientIsolationInfo = {
  clientId: CLIENT_ID,
  firestoreNamespaceEnabled: import.meta.env.VITE_FIRESTORE_USE_CLIENT_NAMESPACE !== 'false'
}
