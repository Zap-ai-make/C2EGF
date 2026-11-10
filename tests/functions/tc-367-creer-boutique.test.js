/**
 * TC-367 — creerBoutique : le patron crée une boutique sans passer par la console.
 *   Handler integration avec Firestore Emulator, { db } injecté ; le service de
 *   connexion est un double en mémoire, qui suffit à prouver l'ordre des gestes
 *   et l'annulation.
 *
 * Comportement protégé :
 *   autorisation : refus sans auth, profil inactif, tout rôle autre que le patron,
 *                  payload hors liste blanche — AVANT toute création de compte.
 *   validation   : nom, e-mail, mot de passe ; rien n'est créé sur un refus.
 *   création     : compte + fiche + profil, aux champs de l'ancienne inscription ;
 *                  le mot de passe n'est ni écrit en base ni renvoyé.
 *   doublons     : e-mail d'un autre compte, nom d'une boutique active (casse et
 *                  accents ignorés) ; une boutique fermée ne bloque pas son nom.
 *   reprise      : un second clic après une coupure rend la boutique déjà créée.
 *   annulation   : Firestore refuse → le compte de connexion est retiré.
 *
 * Exécution : npm run test:functions (émulateur Firestore, projet demo-akayis-test).
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import {
  creerBoutiqueHandler,
  identifiantBoutique,
  cleNom,
} from '../../functions/src/boutiques/creerBoutique.js'

let adminApp
let db

const PROJECT_ID = process.env.GCLOUD_PROJECT
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST

beforeAll(() => {
  if (!FIRESTORE_HOST) throw new Error('SÉCURITÉ : FIRESTORE_EMULATOR_HOST non défini. Lancer via : npm run test:functions')
  if (!PROJECT_ID) throw new Error('SÉCURITÉ : GCLOUD_PROJECT non défini. Lancer via : npm run test:functions')
  if (PROJECT_ID !== 'demo-akayis-test') throw new Error(`SÉCURITÉ : projectId doit être "demo-akayis-test". Reçu : "${PROJECT_ID}"`)
  adminApp = getApps().length === 0 ? initializeApp({ projectId: PROJECT_ID }) : getApps()[0]
  db = getFirestore(adminApp)
})

afterAll(async () => { if (adminApp) await deleteApp(adminApp) })

/** Le service de connexion, réduit aux trois gestes que la callable emploie. */
function fauxAuth() {
  const comptes = new Map()
  let suivant = 0
  return {
    comptes,
    async getUserByEmail(email) {
      for (const c of comptes.values()) if (c.email === email) return c
      throw Object.assign(new Error('Aucun compte.'), { code: 'auth/user-not-found' })
    },
    async createUser({ email, password, displayName }) {
      for (const c of comptes.values()) {
        if (c.email === email) throw Object.assign(new Error('Pris.'), { code: 'auth/email-already-exists' })
      }
      suivant += 1
      const compte = { uid: `nouveau${suivant}xyz`, email, password, displayName }
      comptes.set(compte.uid, compte)
      return compte
    },
    async deleteUser(uid) { comptes.delete(uid) },
  }
}

const PATRON = { uid: 'u-patron', role: 'system_manager', active: true, name: 'Le patron' }
const PATRON_INACTIF = { uid: 'u-patron-inactif', role: 'system_manager', active: false, name: 'Ancien patron' }
const DEALER = { uid: 'u-dealer', role: 'dealer', active: true, name: 'Le dealer' }
const GERANT = { uid: 'u-gerant', role: 'store_admin', storeId: 'store-a', storeName: 'C2EGF OUAGA', active: true, name: 'C2EGF OUAGA' }

const FORMULAIRE = { nom: 'C2EGF  Koudougou ', email: ' Koudougou@C2EGF.test', motDePasse: 'mot-de-passe-1' }

let auth
const appel = (uid, data = FORMULAIRE, deps = {}) =>
  creerBoutiqueHandler({ auth: uid ? { uid } : null, data }, { db, FieldValue, auth, ...deps })

const effacer = async (chemin) => {
  const snap = await db.collection(chemin).get()
  await Promise.all(snap.docs.map((d) => d.ref.delete()))
}

beforeEach(async () => {
  auth = fauxAuth()
  await Promise.all([effacer('stores'), effacer('users')])
  // En parallèle : chaque aller-retour vers l'émulateur coûte près d'une seconde.
  await Promise.all([
    ...[PATRON, PATRON_INACTIF, DEALER, GERANT].map((p) => db.doc(`users/${p.uid}`).set(p)),
    db.doc('stores/store-a').set({ name: 'C2EGF OUAGA', active: true, adminUid: 'u-gerant' }),
    db.doc('stores/store-fermee').set({ name: 'C2EGF FADA', active: false, adminUid: 'u-ancien' }),
  ])
}, 30000)

const nombreDe = async (chemin) => (await db.collection(chemin).get()).size

describe('TC-367 — seul le patron crée une boutique', () => {
  it('[TC-367-01] refuse un appel sans authentification', async () => {
    await expect(appel(null)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('[TC-367-02] refuse le dealer et le compte boutique, sans créer de compte', async () => {
    await expect(appel('u-dealer')).rejects.toMatchObject({ code: 'ROLE_FORBIDDEN' })
    await expect(appel('u-gerant')).rejects.toMatchObject({ code: 'ROLE_FORBIDDEN' })
    expect(auth.comptes.size).toBe(0)
  })

  it('[TC-367-03] refuse un patron désactivé et un profil inconnu', async () => {
    await expect(appel('u-patron-inactif')).rejects.toMatchObject({ code: 'PROFILE_INACTIVE' })
    await expect(appel('u-personne')).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND' })
    expect(auth.comptes.size).toBe(0)
  })

  it('[TC-367-04] refuse un champ hors liste blanche (un rôle glissé dans la requête)', async () => {
    await expect(appel('u-patron', { ...FORMULAIRE, role: 'system_manager' }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST_ID' })
    expect(auth.comptes.size).toBe(0)
  })
})

describe('TC-367 — les trois champs', () => {
  it.each([
    ['un nom d’un caractère', { nom: 'A' }, 'INVALID_STORE_NAME'],
    ['un nom de 81 caractères', { nom: 'B'.repeat(81) }, 'INVALID_STORE_NAME'],
    ['un nom qui n’est pas un texte', { nom: 42 }, 'INVALID_STORE_NAME'],
    ['un e-mail sans arobase', { email: 'koudougou.c2egf.test' }, 'INVALID_EMAIL'],
    ['un e-mail absent', { email: undefined }, 'INVALID_EMAIL'],
    ['un mot de passe de 7 caractères', { motDePasse: '1234567' }, 'INVALID_PASSWORD'],
    ['un mot de passe qui finit par un espace', { motDePasse: 'mot-de-passe ' }, 'INVALID_PASSWORD'],
  ])('[TC-367-05] refuse %s, sans rien créer', async (_cas, changement, code) => {
    await expect(appel('u-patron', { ...FORMULAIRE, ...changement })).rejects.toMatchObject({ code })
    expect(auth.comptes.size).toBe(0)
    expect(await nombreDe('stores')).toBe(2)
  })
})

describe('TC-367 — la création', () => {
  it('[TC-367-06] crée le compte, la fiche et le profil, avec les champs de l’ancienne inscription', async () => {
    const r = await appel('u-patron')

    expect(r).toEqual({
      success: true, storeId: 'c2egf-koudougou-nouvea', uid: 'nouveau1xyz',
      nom: 'C2EGF Koudougou', email: 'koudougou@c2egf.test', dejaCreee: false,
    })

    const compte = auth.comptes.get('nouveau1xyz')
    expect(compte).toMatchObject({ email: 'koudougou@c2egf.test', password: 'mot-de-passe-1', displayName: 'C2EGF Koudougou' })

    const boutique = (await db.doc('stores/c2egf-koudougou-nouvea').get()).data()
    expect(boutique).toMatchObject({
      name: 'C2EGF Koudougou', email: 'koudougou@c2egf.test', active: true,
      adminUid: 'nouveau1xyz', createdBy: 'u-patron',
    })
    expect(boutique.createdAt).toBeDefined()

    const profil = (await db.doc('users/nouveau1xyz').get()).data()
    expect(profil).toMatchObject({
      name: 'C2EGF Koudougou', email: 'koudougou@c2egf.test', role: 'store_admin', active: true,
      storeId: 'c2egf-koudougou-nouvea', storeName: 'C2EGF Koudougou', createdBy: 'u-patron',
    })
  })

  it('[TC-367-07] le mot de passe n’est ni écrit en base ni renvoyé', async () => {
    const r = await appel('u-patron')
    const ecrit = JSON.stringify([
      (await db.doc(`stores/${r.storeId}`).get()).data(),
      (await db.doc(`users/${r.uid}`).get()).data(),
      r,
    ])
    expect(ecrit).not.toContain('mot-de-passe-1')
  })

  it('[TC-367-08] l’identifiant suit la forme de l’ancienne inscription', () => {
    expect(identifiantBoutique('C2EGF Bobo-Dioulasso Nº2', 'abcdef123')).toBe('c2egf-bobo-dioulasso-n-2-abcdef')
    expect(identifiantBoutique('***', 'abcdef123')).toBe('boutique-abcdef')
    expect(cleNom('  C2EGF   Ouagá ')).toBe('c2egf ouaga')
  })
})

describe('TC-367 — les doublons', () => {
  it('[TC-367-09] refuse un e-mail qui sert déjà à un autre compte', async () => {
    auth.comptes.set('u-gerant', { uid: 'u-gerant', email: 'koudougou@c2egf.test' })
    await expect(appel('u-patron')).rejects.toMatchObject({ code: 'EMAIL_ALREADY_USED' })
    expect(await nombreDe('stores')).toBe(2)
  })

  it('[TC-367-10] refuse le nom d’une boutique active, casse et accents ignorés', async () => {
    await expect(appel('u-patron', { ...FORMULAIRE, nom: 'c2egf ouagá' }))
      .rejects.toMatchObject({ code: 'STORE_NAME_TAKEN' })
    expect(auth.comptes.size).toBe(0)
  })

  it('[TC-367-11] le nom d’une boutique fermée reste libre', async () => {
    const r = await appel('u-patron', { ...FORMULAIRE, nom: 'C2EGF FADA' })
    expect(r.dejaCreee).toBe(false)
    expect(await nombreDe('stores')).toBe(3)
  })
})

describe('TC-367 — un second clic, une panne', () => {
  it('[TC-367-12] un second clic rend la boutique déjà créée, sans en créer une deuxième', async () => {
    const premier = await appel('u-patron')
    const second = await appel('u-patron')

    expect(second).toEqual({ ...premier, dejaCreee: true })
    expect(auth.comptes.size).toBe(1)
    expect(await nombreDe('stores')).toBe(3)
  })

  it('[TC-367-13] Firestore refuse : le compte de connexion est retiré, l’e-mail reste libre', async () => {
    // Une fiche existe déjà sous l'identifiant que la callable va calculer :
    // `create` refuse, tout le lot avec.
    await db.doc('stores/c2egf-koudougou-nouvea').set({ name: 'Occupée', active: false })

    await expect(appel('u-patron')).rejects.toBeDefined()
    expect(auth.comptes.size).toBe(0)
    expect((await db.doc('users/nouveau1xyz').get()).exists).toBe(false)
  })
})
