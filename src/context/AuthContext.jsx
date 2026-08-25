import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updatePassword,
  deleteUser,
  reauthenticateWithCredential,
  EmailAuthProvider,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth'
import { doc, setDoc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { auth, db } from '../config/firebase'
import { getAuthErrorMessage } from '../utils/authHelpers'
import { AUTH_ROLES } from '../constants/authMessages'
import { FIRESTORE_CONFIG } from '../constants/firestoreConstants'
import { firestoreService } from '../services/firestore'

const AuthContext = createContext()

export { AuthContext }

const createStoreId = (storeName, uid) => {
  const slug = String(storeName || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `${slug || 'boutique'}-${uid.slice(0, 6)}`
}

const normalizeEmail = (email) => String(email || '').trim().toLowerCase()

const fetchStoreProfile = async (profile) => {
  const storeRef = doc(db, FIRESTORE_CONFIG.COLLECTIONS.STORES, profile.storeId)
  const storeSnap = await getDoc(storeRef)
  if (!storeSnap.exists()) {
    throw new Error('Boutique introuvable')
  }

  const storeData = storeSnap.data()
  const store = {
    id: profile.storeId,
    name: storeData.name || profile.storeName || 'Boutique',
    active: storeData.active !== false
  }

  if (!store.active) {
    throw new Error('Boutique inactive')
  }

  return store
}

/**
 * Résout le profil authentifié pour n'importe quel rôle.
 *
 * - Vérifie que le document users/{uid} existe
 * - Vérifie que le profil est actif
 * - Vérifie que le rôle appartient aux rôles autorisés
 * - Pour store_admin : charge le store et vérifie qu'il est actif
 * - Pour system_manager et dealer : aucune lecture store, activeStore = null
 *
 * @returns {{ profile: object, store: object|null }}
 */
export const resolveAuthenticatedProfile = async (uid) => {
  const docRef = doc(db, FIRESTORE_CONFIG.COLLECTIONS.USERS, uid)
  const docSnap = await getDoc(docRef)

  if (!docSnap.exists()) {
    throw new Error('Profil introuvable')
  }

  const profile = docSnap.data()

  if (!profile.active) {
    throw new Error('Compte inactif')
  }

  const validRoles = Object.values(AUTH_ROLES)
  if (!validRoles.includes(profile.role)) {
    throw new Error('Rôle non autorisé')
  }

  if (profile.role === AUTH_ROLES.STORE_ADMIN) {
    if (!profile.storeId) {
      throw new Error('Compte non rattaché à une boutique active')
    }
    const store = await fetchStoreProfile(profile)
    return { profile, store }
  }

  // Rôles globaux : pas de boutique requise
  return { profile, store: null }
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [activeStore, setActiveStore] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Compteur de génération : chaque nouvel événement Auth invalide les résolutions précédentes.
  // Également mis à Number.MAX_SAFE_INTEGER lors du démontage pour bloquer tout setState tardif.
  const authResolutionIdRef = useRef(0)

  const signup = useCallback(async (email, password, storeName) => {
    try {
      setError('')
      setLoading(true)

      const normalizedStoreName = String(storeName || '').trim()
      if (!normalizedStoreName) {
        throw new Error('Le nom de la boutique est obligatoire')
      }
      const storeDisplayName = normalizedStoreName

      const normalizedEmail = normalizeEmail(email)
      const result = await createUserWithEmailAndPassword(auth, normalizedEmail, password)
      const user = result.user
      const storeId = createStoreId(normalizedStoreName, user.uid)
      const now = serverTimestamp()
      const storePayload = {
        name: normalizedStoreName,
        email: normalizedEmail,
        active: true,
        adminUid: user.uid,
        createdAt: now,
        updatedAt: now
      }
      const profilePayload = {
        name: storeDisplayName,
        email: normalizedEmail,
        role: AUTH_ROLES.STORE_ADMIN,
        active: true,
        storeId,
        storeName: normalizedStoreName,
        createdAt: now,
        updatedAt: now,
        lastLogin: now
      }

      const batch = writeBatch(db)
      batch.set(doc(db, FIRESTORE_CONFIG.COLLECTIONS.STORES, storeId), storePayload)
      batch.set(doc(db, FIRESTORE_CONFIG.COLLECTIONS.USERS, user.uid), profilePayload)
      await batch.commit()

      const store = { id: storeId, name: normalizedStoreName, active: true }
      firestoreService.setActiveStore(store)
      setActiveStore(store)
      setUserProfile(profilePayload)

      return result
    } catch (err) {
      const createdUser = auth.currentUser
      if (createdUser && err?.code?.startsWith('permission-denied')) {
        try {
          await deleteUser(createdUser)
        } catch (deleteError) {
          console.error('Could not rollback orphan auth user:', deleteError)
        }
      }

      const errorMessage = getAuthErrorMessage(err.code, err.message)
      setError(errorMessage)
      setLoading(false)
      console.error('Signup error:', err)
      throw err
    }
  }, [])

  const signin = useCallback(async (email, password) => {
    try {
      setError('')
      setLoading(true)

      await setPersistence(auth, browserLocalPersistence)
      const result = await signInWithEmailAndPassword(auth, normalizeEmail(email), password)
      const { profile, store } = await resolveAuthenticatedProfile(result.user.uid)

      firestoreService.setActiveStore(store)
      setActiveStore(store)
      setUserProfile(profile)
      setCurrentUser(result.user)
      setLoading(false)

      return { ...result, role: profile.role }
    } catch (err) {
      const errorMessage = getAuthErrorMessage(err.code, err.message)
      setError(errorMessage)
      setLoading(false)
      console.error('Signin error:', err)
      throw err
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      setError('')
      await signOut(auth)
      setUserProfile(null)
      setActiveStore(null)
      firestoreService.setActiveStore(null)
    } catch (err) {
      const errorMessage = getAuthErrorMessage(err.code, 'Erreur lors de la déconnexion')
      setError(errorMessage)
      console.error('Logout error:', err)
      throw err
    }
  }, [])

  const resetPassword = useCallback(async (email) => {
    try {
      setError('')
      await sendPasswordResetEmail(auth, normalizeEmail(email))
      return true
    } catch (err) {
      const errorMessage = getAuthErrorMessage(err.code, err.message)
      setError(errorMessage)
      console.error('Password reset error:', err)
      throw err
    }
  }, [])

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    try {
      setError('')
      const user = auth.currentUser

      if (!user) {
        throw new Error('Utilisateur non connecté')
      }

      const credential = EmailAuthProvider.credential(user.email, currentPassword)
      await reauthenticateWithCredential(user, credential)
      await updatePassword(user, newPassword)
      return true
    } catch (err) {
      const errorMessage = getAuthErrorMessage(err.code, err.message)
      setError(errorMessage)
      console.error('Password change error:', err)
      throw err
    }
  }, [])

  const getUserProfile = useCallback(async (uid) => {
    try {
      const { profile } = await resolveAuthenticatedProfile(uid)
      return profile
    } catch (err) {
      console.error('Error getting user profile:', err)
      return null
    }
  }, [])

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      // Incrémenter la génération : toute résolution précédente devient obsolète.
      const resolutionId = ++authResolutionIdRef.current

      // Nettoyage synchrone immédiat : aucun ancien contexte ne reste exploitable.
      setLoading(true)
      setError('')
      setCurrentUser(user)
      setUserProfile(null)
      setActiveStore(null)
      firestoreService.setActiveStore(null)

      if (!user) {
        if (resolutionId !== authResolutionIdRef.current) return
        setLoading(false)
        return
      }

      try {
        const { profile, store } = await resolveAuthenticatedProfile(user.uid)

        if (resolutionId !== authResolutionIdRef.current) return

        firestoreService.setActiveStore(store)
        setActiveStore(store)
        setUserProfile(profile)
        setError('')

        await setDoc(
          doc(db, FIRESTORE_CONFIG.COLLECTIONS.USERS, user.uid),
          { lastLogin: serverTimestamp() },
          { merge: true }
        )
      } catch (err) {
        if (resolutionId !== authResolutionIdRef.current) return
        setError(err.message || 'Accès non autorisé')
        setUserProfile(null)
        setActiveStore(null)
        firestoreService.setActiveStore(null)
      }

      if (resolutionId !== authResolutionIdRef.current) return
      setLoading(false)
    })

    return () => {
      // Invalider toute résolution en cours lors du démontage.
      authResolutionIdRef.current = Number.MAX_SAFE_INTEGER
      unsubscribe()
    }
  }, [])

  const role = userProfile?.role ?? null

  const value = useMemo(() => ({
    currentUser,
    userProfile,
    activeStore,
    loading,
    error,
    authError: error,
    role,
    isStoreAdmin: role === AUTH_ROLES.STORE_ADMIN,
    isSystemManager: role === AUTH_ROLES.SYSTEM_MANAGER,
    isDealer: role === AUTH_ROLES.DEALER,
    hasStoreContext: role === AUTH_ROLES.STORE_ADMIN && activeStore?.id === userProfile?.storeId,
    signup,
    signin,
    logout,
    resetPassword,
    changePassword,
    getUserProfile
  }), [
    currentUser,
    userProfile,
    activeStore,
    loading,
    error,
    role,
    signup,
    signin,
    logout,
    resetPassword,
    changePassword,
    getUserProfile
  ])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export default AuthProvider
