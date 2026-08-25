/**
 * Provisioning des comptes techniques AKAYIS — module partagé.
 *
 * Trois couches :
 *   1. Fonctions pures et types (testables sans Firebase)
 *   2. Fonctions métier (createTechnicalUser, verifyTechnicalUser, deleteTechnicalUser)
 *      — acceptent des dépendances injectées (auth, db, …)
 *   3. Parser strict et validateur de profil
 *
 * Ce module ne contient aucun appel Firebase direct.
 * Les dépendances Firebase sont toujours injectées.
 */

import { FieldValue } from 'firebase-admin/firestore'

// ─────────────────────────────────────────────
// 1. Classes d'erreur
// ─────────────────────────────────────────────

export class ParseError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ParseError'
    this.code = 'PARSE_ERROR'
  }
}

export class AdminEnvError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AdminEnvError'
    this.code = code
  }
}

// ─────────────────────────────────────────────
// 2. Constantes
// ─────────────────────────────────────────────

export const TECHNICAL_ROLES = Object.freeze(['system_manager', 'dealer'])
export const STORE_ROLES = Object.freeze(['store_admin'])
// Liste de blocage : projets sur lesquels le provisioning est interdit en absolu,
// emulateurs presents ou non. c2egf-b0b5a est la production de CE depot ;
// taofic-ajagbe, celle du client dont le produit a ete copie, est conservee —
// une entree superflue dans une liste de blocage ne coute rien, son absence si.
export const PRODUCTION_BLOCKED_PROJECTS = Object.freeze(['taofic-ajagbe', 'c2egf-b0b5a'])
export const FORBIDDEN_PROFILE_FIELDS = Object.freeze([
  'storeId', 'storeName', 'dealerId', 'adminUid', 'boutiqueId',
])

const AUDIT_ACTIONS = Object.freeze([
  'TECHNICAL_USER_CREATED',
  'TECHNICAL_USER_PROFILE_CREATED',
  'TECHNICAL_USER_CREATION_FAILED',
  'TECHNICAL_USER_DELETED',
  'TECHNICAL_USER_DELETION_FAILED',
])

// ─────────────────────────────────────────────
// 3. Validation de l'environnement (pure)
// ─────────────────────────────────────────────

/**
 * Valide strictement l'environnement émulateur.
 * Aucun fallback. Aucun mode réel.
 * @param {object} env — process.env ou objet de test
 * @returns {{ ok: true, projectId: string } | { ok: false, code: string, message: string }}
 */
export function validateEmulatorEnv(env = {}) {
  const authHost = (env.FIREBASE_AUTH_EMULATOR_HOST ?? '').trim()
  const fsHost = (env.FIRESTORE_EMULATOR_HOST ?? '').trim()
  const projectId = (env.GCLOUD_PROJECT ?? '').trim()

  // Projets de production bloqués en absolu, même si les émulateurs sont présents.
  // Dérivé de la liste ci-dessus : un seul endroit à tenir à jour.
  if (PRODUCTION_BLOCKED_PROJECTS.includes(projectId)) {
    return {
      ok: false,
      code: 'PRODUCTION_PROJECT_BLOCKED',
      message: `[SÉCURITÉ] Le projet "${projectId}" est explicitement interdit dans ce lot.`,
    }
  }

  if (!authHost) {
    return {
      ok: false,
      code: 'EMULATOR_ENV_REQUIRED',
      message: '[SÉCURITÉ] FIREBASE_AUTH_EMULATOR_HOST est requis (ex: 127.0.0.1:9099).',
    }
  }

  if (!fsHost) {
    return {
      ok: false,
      code: 'EMULATOR_ENV_REQUIRED',
      message: '[SÉCURITÉ] FIRESTORE_EMULATOR_HOST est requis (ex: 127.0.0.1:8080).',
    }
  }

  if (!projectId) {
    return {
      ok: false,
      code: 'PROJECT_ID_REQUIRED',
      message: '[SÉCURITÉ] GCLOUD_PROJECT est obligatoire.',
    }
  }

  if (!projectId.startsWith('demo-')) {
    return {
      ok: false,
      code: 'NON_DEMO_PROJECT_BLOCKED',
      message: `[SÉCURITÉ] "${projectId}" n'est pas un projet demo. Seul demo-* est autorisé.`,
    }
  }

  return { ok: true, projectId }
}

// ─────────────────────────────────────────────
// 4. Validation des arguments (pure, strict)
// ─────────────────────────────────────────────

/**
 * Valide un rôle technique exact. Rejette toute valeur non exacte,
 * tout rôle boutique et tout rôle inconnu.
 * Ne normalise pas (trim silencieux interdit).
 */
export function validateRole(role) {
  if (role === null || role === undefined || role === '') {
    throw new ParseError('Le rôle est obligatoire.')
  }
  if (typeof role !== 'string') {
    throw new ParseError('Le rôle doit être une chaîne de caractères.')
  }
  if (STORE_ROLES.includes(role)) {
    throw new ParseError(
      `Le rôle "${role}" est réservé aux boutiques et ne peut pas être créé par ce script.`
    )
  }
  if (!TECHNICAL_ROLES.includes(role)) {
    throw new ParseError(
      `Rôle inconnu : "${role}". Rôles techniques autorisés : ${TECHNICAL_ROLES.join(', ')}.`
    )
  }
}

/**
 * Valide et normalise un email (trim + lowercase).
 * @returns {string}
 */
export function normalizeEmail(email) {
  if (!email || typeof email !== 'string') {
    throw new ParseError("L'email est obligatoire.")
  }
  const normalized = email.trim().toLowerCase()
  if (!normalized) {
    throw new ParseError("L'email ne peut pas être vide.")
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized)) {
    throw new ParseError(`Email invalide : "${email}".`)
  }
  return normalized
}

/**
 * Valide le nom (obligatoire, au moins 2 caractères non-espaces).
 */
export function validateName(name) {
  if (!name || typeof name !== 'string') {
    throw new ParseError('Le nom est obligatoire.')
  }
  const trimmed = name.trim()
  if (!trimmed) {
    throw new ParseError('Le nom ne peut pas être composé uniquement d\'espaces.')
  }
  if (trimmed.length < 2) {
    throw new ParseError('Le nom doit contenir au moins 2 caractères.')
  }
}

// ─────────────────────────────────────────────
// 5. Parser CLI strict
// ─────────────────────────────────────────────

/**
 * Parse les arguments CLI de façon stricte.
 * Rejette : options inconnues, doublons, valeurs vides/manquantes,
 *            arguments positionnels, valeur suivante commençant par --.
 *
 * @param {string[]} argv — process.argv
 * @param {{ keys?: string[], flags?: string[] }} schema
 * @returns {object}
 */
export function parseStrictArgs(argv = [], {
  keys = [],
  flags = [],
} = {}) {
  const result = {}
  const seen = new Set()
  const args = argv.slice(2)

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    // Positionnal argument
    if (!arg.startsWith('--')) {
      throw new ParseError(`Argument positionnel interdit : "${arg}". Utilisez --clé=valeur ou --clé valeur.`)
    }

    const withoutDashes = arg.slice(2)

    // --key=value form
    const eqIdx = withoutDashes.indexOf('=')
    let key, value

    if (eqIdx !== -1) {
      key = withoutDashes.slice(0, eqIdx)
      value = withoutDashes.slice(eqIdx + 1)

      if (flags.includes(key)) {
        throw new ParseError(`--${key} est un flag booléen et n'accepte pas de valeur.`)
      }

      if (!keys.includes(key)) {
        throw new ParseError(`Option inconnue : --${key}.`)
      }

      if (seen.has(key)) {
        throw new ParseError(`Option dupliquée : --${key}.`)
      }

      if (!value || !value.trim()) {
        throw new ParseError(`Valeur vide pour --${key}.`)
      }

      seen.add(key)
      result[key] = value

    } else {
      key = withoutDashes

      if (flags.includes(key)) {
        if (seen.has(key)) {
          throw new ParseError(`Flag dupliqué : --${key}.`)
        }
        seen.add(key)
        result[key] = true
        continue
      }

      if (!keys.includes(key)) {
        throw new ParseError(`Option inconnue : --${key}.`)
      }

      if (seen.has(key)) {
        throw new ParseError(`Option dupliquée : --${key}.`)
      }

      const next = args[i + 1]
      if (next === undefined) {
        throw new ParseError(`Valeur manquante pour --${key}.`)
      }
      if (next.startsWith('--')) {
        throw new ParseError(`Valeur manquante pour --${key} (trouvé "${next}" à la place).`)
      }

      value = next
      if (!value.trim()) {
        throw new ParseError(`Valeur vide pour --${key}.`)
      }

      seen.add(key)
      result[key] = value
      i++
    }
  }

  return result
}

/**
 * Alias conservé pour compatibilité TC-029-R.
 * Wrapper non-strict autour de parseStrictArgs pour les anciens usages.
 */
export function parseProvisioningArgs(argv = []) {
  const args = argv.slice(2)
  const result = { confirm: false }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) continue
    const withoutDashes = arg.slice(2)
    const eqIdx = withoutDashes.indexOf('=')

    if (eqIdx !== -1) {
      const key = withoutDashes.slice(0, eqIdx)
      const val = withoutDashes.slice(eqIdx + 1)
      if (['role', 'email', 'name'].includes(key)) result[key] = val
    } else {
      const key = withoutDashes
      if (key === 'confirm') { result.confirm = true; continue }
      if (key === 'show-reset-link') { result.showResetLink = true; continue }
      if (['role', 'email', 'name'].includes(key) && args[i + 1] && !args[i + 1].startsWith('--')) {
        result[key] = args[++i]
      }
    }
  }
  return result
}

// ─────────────────────────────────────────────
// 6. Validateur strict de profil
// ─────────────────────────────────────────────

/**
 * Valide la structure complète d'un profil Firestore technique.
 * Vérifie la liste blanche + les champs interdits (même null/vide).
 *
 * @param {object} profile — données Firestore
 * @param {object|null} authUser — UserRecord Firebase (peut être null)
 * @param {string|null} requestedRole — rôle attendu (null = pas de vérification de rôle)
 * @returns {string[]} — liste d'erreurs (vide = profil valide)
 */
export function validateProfileStructure(profile, authUser = null, requestedRole = null) {
  const errors = []

  if (!profile || typeof profile !== 'object') {
    return ['profil absent ou invalide']
  }

  // Champs interdits — même présents avec valeur null, undefined ou ''
  for (const field of FORBIDDEN_PROFILE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(profile, field)) {
      errors.push(`Champ interdit présent : "${field}" (valeur : ${JSON.stringify(profile[field])})`)
    }
  }

  // name
  if (!Object.prototype.hasOwnProperty.call(profile, 'name') || !profile.name || typeof profile.name !== 'string' || !profile.name.trim()) {
    errors.push('name absent ou vide')
  }

  // email
  if (!profile.email || typeof profile.email !== 'string') {
    errors.push('email absent')
  }

  // role
  if (!profile.role || typeof profile.role !== 'string') {
    errors.push('role absent')
  } else if (STORE_ROLES.includes(profile.role)) {
    errors.push(`role "${profile.role}" est un rôle boutique interdit pour un compte technique`)
  } else if (!TECHNICAL_ROLES.includes(profile.role)) {
    errors.push(`role "${profile.role}" inconnu`)
  }

  // active
  if (!Object.prototype.hasOwnProperty.call(profile, 'active')) {
    errors.push('active absent')
  } else if (profile.active !== true) {
    errors.push(`active doit être true (reçu : ${JSON.stringify(profile.active)})`)
  }

  // timestamps
  const isTimestamp = (v) => v && typeof v === 'object' && typeof v.toDate === 'function'
  if (!isTimestamp(profile.createdAt)) {
    errors.push('createdAt absent ou n\'est pas un Timestamp valide')
  }
  if (!isTimestamp(profile.updatedAt)) {
    errors.push('updatedAt absent ou n\'est pas un Timestamp valide')
  }

  // lastLogin (null ou Timestamp)
  if (profile.lastLogin !== null && profile.lastLogin !== undefined && !isTimestamp(profile.lastLogin)) {
    errors.push('lastLogin doit être null ou un Timestamp valide')
  }

  // cohérence email Auth ↔ Firestore
  if (authUser && profile.email && profile.email !== authUser.email) {
    errors.push(`email incohérent Auth (${authUser.email}) ≠ Firestore (${profile.email})`)
  }

  // rôle attendu
  if (requestedRole && profile.role && profile.role !== requestedRole) {
    errors.push(`role demandé "${requestedRole}" ≠ role existant "${profile.role}"`)
  }

  // custom claims incompatibles
  const claims = authUser?.customClaims ?? {}
  if (claims.role === 'store_admin') {
    errors.push('custom claim role=store_admin interdit pour un compte technique')
  }
  if (claims.role && TECHNICAL_ROLES.includes(profile.role) && claims.role !== profile.role) {
    errors.push(`custom claim role="${claims.role}" ≠ profil role="${profile.role}"`)
  }

  return errors
}

// ─────────────────────────────────────────────
// 7. Modèle de données
// ─────────────────────────────────────────────

export function buildProfileData({ uid, email, name, role }) {
  return {
    name: name.trim(),
    email,
    role,
    active: true,
    lastLogin: null,
  }
}

export function hasStoreFields(profile) {
  if (!profile || typeof profile !== 'object') return false
  return FORBIDDEN_PROFILE_FIELDS.some(
    (f) => Object.prototype.hasOwnProperty.call(profile, f)
  )
}

// ─────────────────────────────────────────────
// 8. Audit par liste blanche stricte
// ─────────────────────────────────────────────

/**
 * Construit une entrée d'audit par liste blanche explicite.
 * Aucune donnée libre, aucune stacktrace, aucun secret.
 *
 * @param {{ action, targetUid?, targetEmail, targetRole, projectId, isEmulator, metadata? }} opts
 */
export function buildAuditEntry({
  action,
  targetUid,
  targetEmail,
  targetRole,
  projectId,
  isEmulator,
  metadata = {},
}) {
  if (!AUDIT_ACTIONS.includes(action)) {
    throw new Error(`Action d'audit inconnue : "${action}". Autorisées : ${AUDIT_ACTIONS.join(', ')}`)
  }

  // Métadonnées — liste blanche stricte
  const safeMetadata = {
    ...(metadata.result !== undefined && { result: String(metadata.result) }),
    ...(metadata.rollbackAttempted !== undefined && { rollbackAttempted: Boolean(metadata.rollbackAttempted) }),
    ...(metadata.rollbackSucceeded !== undefined && { rollbackSucceeded: Boolean(metadata.rollbackSucceeded) }),
    ...(metadata.errorCode !== undefined && { errorCode: String(metadata.errorCode) }),
  }

  return {
    action,
    actorType: 'provisioning_script',
    targetUid: targetUid ?? null,
    targetEmail: typeof targetEmail === 'string' ? targetEmail : null,
    targetRole: typeof targetRole === 'string' ? targetRole : null,
    projectId: typeof projectId === 'string' ? projectId : null,
    emulator: Boolean(isEmulator),
    executedAt: new Date().toISOString(),
    metadata: safeMetadata,
  }
}

// ─────────────────────────────────────────────
// 9. Détection de profils concurrents
// ─────────────────────────────────────────────

/**
 * Cherche tous les profils Firestore dont l'email correspond,
 * indépendamment de l'UID.
 * Retourne les profils sous un autre UID que celui attendu.
 *
 * @param {object} db — Firestore Admin
 * @param {string} email — email normalisé
 * @param {string|null} expectedUid — UID Auth trouvé (ou null si pas de compte Auth)
 * @returns {Promise<Array<{ uid: string, data: object }>>}
 */
export async function findConcurrentProfiles(db, email, expectedUid) {
  const snap = await db.collection('users').where('email', '==', email).get()
  return snap.docs
    .map((d) => ({ uid: d.id, data: d.data() }))
    .filter((p) => p.uid !== expectedUid)
}

// ─────────────────────────────────────────────
// 10. Fonction métier : createTechnicalUser
// ─────────────────────────────────────────────

/**
 * Crée un compte technique de façon idempotente.
 *
 * Résultats possibles :
 *   CREATED           — Auth + profil créés
 *   PROFILE_CREATED   — Auth préexistant, profil créé
 *   UNCHANGED         — compte déjà valide, aucune écriture
 *
 * Erreurs (propriété `result`) :
 *   ROLE_CONFLICT     — rôle incompatible existant
 *   EMAIL_UID_CONFLICT — même email sous un autre UID
 *   ORPHAN_PROFILE    — profil Firestore sans compte Auth
 *   PROFILE_MISMATCH  — profil existant invalide
 *   AUTH_CREATE_FAILED
 *   FIRESTORE_CREATE_FAILED (avec rollback Auth)
 *   RESET_LINK_FAILED (avec rollback complet)
 *   CREATED_WITH_AUDIT_FAILURE — créé mais audit raté (compte intact)
 *
 * @param {{ email: string, name: string, role: string, onResetLink?: function }} options
 * @param {{ auth, db, projectId: string, isEmulator: boolean,
 *            generateResetLink?: function, writeAudit?: function }} deps
 */
export async function createTechnicalUser(options, deps) {
  const { email, name, role, onResetLink = null } = options
  const {
    auth,
    db,
    projectId,
    isEmulator,
    generateResetLink = (em) => auth.generatePasswordResetLink(em),
    writeAudit = (entry) => db.collection('auditLogs').add(entry),
  } = deps

  // 1. Recherche Auth par email
  let authUser = null
  try {
    authUser = await auth.getUserByEmail(email)
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err
  }

  const expectedUid = authUser?.uid ?? null

  // 2. Détection profils concurrents (même email, UID différent)
  const concurrent = await findConcurrentProfiles(db, email, expectedUid)
  if (concurrent.length > 0) {
    return {
      result: 'EMAIL_UID_CONFLICT',
      error: `Profil Firestore concurrent détecté sous uid=${concurrent[0].uid}. Intervention manuelle requise.`,
    }
  }

  // 3. Profil orphelin (Firestore sans Auth)
  if (!authUser) {
    const orphanSnap = await db.doc(`users/${expectedUid || '_none_'}`).get()
    // On a déjà vérifié les profils par email ci-dessus, mais cherchons aussi par email dans le cas d'un uid connu
    // En réalité si !authUser && concurrent vide, il n'y a pas de profil concurrent
    // Mais si l'email est dans Firestore sans Auth, findConcurrentProfiles l'aurait détecté avec uid=doc.id≠null
    // → déjà géré. On continue.
    void orphanSnap
  }

  // 4. Custom claims Auth incompatibles
  if (authUser?.customClaims?.role === 'store_admin') {
    return {
      result: 'ROLE_CONFLICT',
      error: 'Le compte Auth possède le custom claim role=store_admin. Modification interdite.',
    }
  }
  if (authUser?.customClaims?.role && authUser.customClaims.role !== role) {
    return {
      result: 'ROLE_CONFLICT',
      error: `Custom claim role="${authUser.customClaims.role}" incompatible avec rôle demandé "${role}".`,
    }
  }

  // 5. Profil Firestore existant (même UID)
  let ownProfile = null
  if (expectedUid) {
    const snap = await db.doc(`users/${expectedUid}`).get()
    if (snap.exists) ownProfile = snap.data()
  }

  // 6. Idempotence : Auth + profil valide → UNCHANGED (aucune écriture)
  if (authUser && ownProfile) {
    const errors = validateProfileStructure(ownProfile, authUser, role)
    if (errors.length === 0) {
      return { result: 'UNCHANGED', uid: expectedUid, email, role }
    }
    // Store admin conflit
    if (ownProfile.role === 'store_admin' || hasStoreFields(ownProfile)) {
      return {
        result: 'ROLE_CONFLICT',
        error: `Profil existant incompatible : ${errors.join('; ')}`,
      }
    }
    return {
      result: 'PROFILE_MISMATCH',
      errors,
    }
  }

  // 7. Création Auth (si nécessaire)
  let newUid = expectedUid
  let newAuthCreated = false

  if (!authUser) {
    try {
      const newUser = await auth.createUser({
        email,
        displayName: name.trim(),
        emailVerified: false,
        disabled: false,
      })
      newUid = newUser.uid
      newAuthCreated = true
    } catch (err) {
      await _safeAudit(writeAudit, {
        action: 'TECHNICAL_USER_CREATION_FAILED',
        targetUid: null, targetEmail: email, targetRole: role,
        projectId, isEmulator,
        metadata: { result: 'AUTH_CREATE_FAILED', errorCode: err.code || 'UNKNOWN' },
      })
      return {
        result: 'AUTH_CREATE_FAILED',
        error: err.message,
      }
    }
  }

  // 8. Création profil Firestore
  const profileData = buildProfileData({ uid: newUid, email, name, role })
  try {
    await db.doc(`users/${newUid}`).set({
      ...profileData,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (fsErr) {
    // Rollback Auth si on vient de le créer
    let rollbackSucceeded = false
    if (newAuthCreated) {
      try {
        await auth.deleteUser(newUid)
        rollbackSucceeded = true
      } catch {
        rollbackSucceeded = false
      }
    }
    await _safeAudit(writeAudit, {
      action: 'TECHNICAL_USER_CREATION_FAILED',
      targetUid: newUid, targetEmail: email, targetRole: role,
      projectId, isEmulator,
      metadata: {
        result: 'FIRESTORE_CREATE_FAILED',
        rollbackAttempted: newAuthCreated,
        rollbackSucceeded,
        errorCode: fsErr.code || 'UNKNOWN',
      },
    })
    return {
      result: 'FIRESTORE_CREATE_FAILED',
      error: fsErr.message,
      rollbackAttempted: newAuthCreated,
      rollbackSucceeded,
    }
  }

  // 9. Lien de réinitialisation du mot de passe
  let resetLinkGenerated = false
  try {
    const link = await generateResetLink(email)
    resetLinkGenerated = true
    // Le lien n'est JAMAIS dans le résultat retourné
    // Il est transmis uniquement via le callback onResetLink (CLI)
    if (typeof onResetLink === 'function') {
      onResetLink(link)
    }
  } catch (resetErr) {
    // Rollback complet : supprimer profil + Auth si nouvellement créé
    let rollbackSucceeded = false
    try {
      await db.doc(`users/${newUid}`).delete()
      if (newAuthCreated) {
        await auth.deleteUser(newUid)
      }
      rollbackSucceeded = true
    } catch {
      rollbackSucceeded = false
    }
    await _safeAudit(writeAudit, {
      action: 'TECHNICAL_USER_CREATION_FAILED',
      targetUid: newUid, targetEmail: email, targetRole: role,
      projectId, isEmulator,
      metadata: {
        result: 'RESET_LINK_FAILED',
        rollbackAttempted: true,
        rollbackSucceeded,
      },
    })
    return {
      result: 'RESET_LINK_FAILED',
      error: resetErr.message,
      rollbackAttempted: true,
      rollbackSucceeded,
    }
  }

  // 10. Audit de succès
  const resultCode = newAuthCreated ? 'CREATED' : 'PROFILE_CREATED'
  const auditAction = newAuthCreated ? 'TECHNICAL_USER_CREATED' : 'TECHNICAL_USER_PROFILE_CREATED'
  try {
    await writeAudit(buildAuditEntry({
      action: auditAction,
      targetUid: newUid, targetEmail: email, targetRole: role,
      projectId, isEmulator,
      metadata: { result: resultCode },
    }))
  } catch (auditErr) {
    // Compte créé avec succès — ne pas faire de rollback pour un échec d'audit
    return {
      result: 'CREATED_WITH_AUDIT_FAILURE',
      uid: newUid,
      email,
      role,
      resetLinkGenerated,
      auditError: auditErr.message,
    }
  }

  return {
    result: resultCode,
    uid: newUid,
    email,
    role,
    resetLinkGenerated,
  }
}

// ─────────────────────────────────────────────
// 11. Fonction métier : verifyTechnicalUser
// ─────────────────────────────────────────────

/**
 * Vérifie la cohérence complète d'un compte technique.
 * --role est obligatoire.
 *
 * @param {{ email: string, role: string }} options
 * @param {{ auth, db }} deps
 * @returns {Promise<{ result: 'VALID'|'INVALID'|'NOT_FOUND', checks: Array, uid?, profile? }>}
 */
export async function verifyTechnicalUser(options, deps) {
  const { email, role } = options
  const { auth, db } = deps

  // 1. Compte Auth
  let authUser
  try {
    authUser = await auth.getUserByEmail(email)
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      return { result: 'NOT_FOUND', checks: [{ ok: false, label: 'compte Auth absent' }] }
    }
    throw err
  }

  const uid = authUser.uid
  const checks = []

  // 2. Profil Firestore au même UID
  const snap = await db.doc(`users/${uid}`).get()
  if (!snap.exists) {
    return {
      result: 'INVALID',
      uid,
      checks: [{ ok: false, label: `profil Firestore users/${uid} absent` }],
    }
  }

  const profile = snap.data()

  // 3. Profils concurrents (même email, UID différent)
  const concurrent = await findConcurrentProfiles(db, email, uid)
  if (concurrent.length > 0) {
    return {
      result: 'INVALID',
      uid,
      checks: [{ ok: false, label: `profil concurrent sous uid=${concurrent[0].uid}` }],
    }
  }

  // 4. Validation structurelle complète
  const structErrors = validateProfileStructure(profile, authUser, role)

  // 5. Checks additionnels
  checks.push({ ok: !authUser.disabled, label: 'compte Auth non désactivé' })
  checks.push({ ok: profile.email === email, label: 'email cohérent Auth ↔ Firestore' })
  checks.push({ ok: profile.role === role, label: `rôle exact "${role}"` })
  checks.push({ ok: profile.active === true, label: 'active === true' })
  checks.push({ ok: typeof profile.name === 'string' && profile.name.trim().length >= 2, label: 'name valide' })
  checks.push({ ok: !authUser.customClaims?.role || authUser.customClaims.role === role, label: 'custom claims compatibles' })
  checks.push({ ok: structErrors.length === 0, label: `structure profil valide${structErrors.length > 0 ? ' (' + structErrors[0] + ')' : ''}` })

  const allOk = checks.every((c) => c.ok)

  return {
    result: allOk ? 'VALID' : 'INVALID',
    uid,
    profile,
    checks,
    ...(structErrors.length > 0 && { structErrors }),
  }
}

// ─────────────────────────────────────────────
// 12. Fonction métier : deleteTechnicalUser
// ─────────────────────────────────────────────

/**
 * Supprime un compte technique. Émulateur uniquement.
 * Ordre : valider → supprimer profil Firestore → supprimer Auth.
 * Rollback Firestore si suppression Auth échoue.
 *
 * @param {{ email: string }} options
 * @param {{ auth, db, projectId: string, isEmulator: boolean, writeAudit?: function }} deps
 * @returns {Promise<object>}
 */
export async function deleteTechnicalUser(options, deps) {
  const { email } = options
  const {
    auth,
    db,
    projectId,
    isEmulator,
    writeAudit = (entry) => db.collection('auditLogs').add(entry),
  } = deps

  if (!isEmulator) {
    throw new AdminEnvError('EMULATOR_ENV_REQUIRED', 'deleteTechnicalUser n\'est autorisé qu\'en mode émulateur.')
  }

  // 1. Compte Auth
  let authUser
  try {
    authUser = await auth.getUserByEmail(email)
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      return { result: 'NOT_FOUND', error: `Aucun compte Auth pour ${email}.` }
    }
    throw err
  }

  const uid = authUser.uid

  // 2. Profil Firestore
  const snap = await db.doc(`users/${uid}`).get()
  if (!snap.exists) {
    return {
      result: 'INVALID',
      error: `Auth uid=${uid} existe mais aucun profil Firestore. Intervention manuelle requise.`,
    }
  }

  const profile = snap.data()

  // 3. Profils concurrents
  const concurrent = await findConcurrentProfiles(db, email, uid)
  if (concurrent.length > 0) {
    return {
      result: 'EMAIL_UID_CONFLICT',
      error: `Profil concurrent détecté sous uid=${concurrent[0].uid}. Suppression annulée.`,
    }
  }

  // 4. Validation du profil
  if (profile.role === 'store_admin' || hasStoreFields(profile)) {
    return {
      result: 'ROLE_CONFLICT',
      error: `${email} est un store_admin protégé. Suppression interdite.`,
    }
  }

  if (!TECHNICAL_ROLES.includes(profile.role)) {
    return {
      result: 'INVALID',
      error: `Rôle "${profile.role}" inconnu. Suppression refusée.`,
    }
  }

  if (authUser.customClaims?.role === 'store_admin') {
    return {
      result: 'ROLE_CONFLICT',
      error: 'Custom claim role=store_admin. Suppression refusée.',
    }
  }

  if (profile.email !== email) {
    return {
      result: 'EMAIL_MISMATCH',
      error: `Email Auth (${email}) ≠ email Firestore (${profile.email}).`,
    }
  }

  if (!profile.active) {
    return {
      result: 'INVALID',
      error: 'Profil inactif. Suppression refusée (état incohérent).',
    }
  }

  // 5. Ordre de suppression : profil Firestore → Auth
  const profileSnapshot = { ...profile } // snapshot pour rollback

  try {
    await db.doc(`users/${uid}`).delete()
  } catch (fsErr) {
    await _safeAudit(writeAudit, {
      action: 'TECHNICAL_USER_DELETION_FAILED',
      targetUid: uid, targetEmail: email, targetRole: profile.role,
      projectId, isEmulator,
      metadata: { result: 'FIRESTORE_DELETE_FAILED', errorCode: fsErr.code || 'UNKNOWN' },
    })
    return {
      result: 'FIRESTORE_DELETE_FAILED',
      error: fsErr.message,
    }
  }

  // 6. Supprimer Auth
  try {
    await auth.deleteUser(uid)
  } catch (authErr) {
    // Rollback : restaurer le profil Firestore
    let rollbackSucceeded = false
    try {
      await db.doc(`users/${uid}`).set({
        ...profileSnapshot,
        updatedAt: FieldValue.serverTimestamp(),
      })
      rollbackSucceeded = true
    } catch {
      rollbackSucceeded = false
    }

    await _safeAudit(writeAudit, {
      action: 'TECHNICAL_USER_DELETION_FAILED',
      targetUid: uid, targetEmail: email, targetRole: profile.role,
      projectId, isEmulator,
      metadata: {
        result: 'AUTH_DELETE_FAILED',
        rollbackAttempted: true,
        rollbackSucceeded,
        errorCode: authErr.code || 'UNKNOWN',
      },
    })

    return {
      result: 'AUTH_DELETE_FAILED',
      error: authErr.message,
      rollbackAttempted: true,
      rollbackSucceeded,
    }
  }

  // 7. Audit de succès
  await _safeAudit(writeAudit, {
    action: 'TECHNICAL_USER_DELETED',
    targetUid: uid, targetEmail: email, targetRole: profile.role,
    projectId, isEmulator,
    metadata: { result: 'DELETED' },
  })

  return { result: 'DELETED', uid, email, role: profile.role }
}

// ─────────────────────────────────────────────
// 13. Helpers internes
// ─────────────────────────────────────────────

async function _safeAudit(writeAudit, auditOpts) {
  try {
    await writeAudit(buildAuditEntry(auditOpts))
  } catch {
    // Audit non bloquant
  }
}

// ─────────────────────────────────────────────
// 14. Fonctions pures conservées (compatibilité TC-029)
// ─────────────────────────────────────────────

export function isProjectAllowed(projectId) {
  if (!projectId || typeof projectId !== 'string') return false
  if (PRODUCTION_BLOCKED_PROJECTS.includes(projectId)) return false
  if (!projectId.startsWith('demo-')) return false
  return true
}

export function validateExistingProfile(profile, requestedRole) {
  if (!profile) return { valid: false, reason: 'PROFILE_ABSENT' }
  if (profile.role === 'store_admin') return { valid: false, reason: 'ROLE_CONFLICT_STORE_ADMIN' }
  if (profile.role !== requestedRole) return { valid: false, reason: `ROLE_CONFLICT_EXISTING:${profile.role}` }
  if (hasStoreFields(profile)) return { valid: false, reason: 'PROFILE_HAS_STORE_FIELDS' }
  if (profile.active === false) return { valid: false, reason: 'ACCOUNT_INACTIVE' }
  return { valid: true, reason: null }
}

export function computeProvisioningResult({ authExists, profileExists, profileMatchesRole, isStoreAdmin, profileInactive = false }) {
  if (isStoreAdmin) return 'ROLE_CONFLICT'
  if (!authExists && !profileExists) return 'CREATED'
  if (authExists && !profileExists) return 'PROFILE_CREATED'
  if (authExists && profileExists && profileInactive) return 'ACCOUNT_INACTIVE'
  if (authExists && profileExists && profileMatchesRole === true) return 'UNCHANGED'
  if (authExists && profileExists && profileMatchesRole === false) return 'ROLE_CONFLICT'
  return 'PROFILE_MISMATCH'
}

// Conservé pour compatibilité TC-029-K
export function checkEmulatorEnv(env = {}) {
  const required = {
    FIREBASE_AUTH_EMULATOR_HOST: env.FIREBASE_AUTH_EMULATOR_HOST,
    FIRESTORE_EMULATOR_HOST: env.FIRESTORE_EMULATOR_HOST,
    GCLOUD_PROJECT: env.GCLOUD_PROJECT,
  }
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k)
  return { ok: missing.length === 0, missing }
}
