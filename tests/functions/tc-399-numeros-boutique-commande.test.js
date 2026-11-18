import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'

/**
 * TC-399 — La boutique enregistre ses numéros : `updateStoreNumbers`
 * (docs/superpowers/specs/2026-11-17-numeros-boutique-design.md).
 *
 * Décidé par l'utilisateur le 2026-11-17 : la boutique elle-même les saisit,
 * depuis son Profil. Le numéro dealer est celui où les agents envoient leur
 * argent : chaque changement va au journal, avant et après.
 */

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const UID = 'numeros-caisse'
const STORE = 'numeros-boutique'
const request = (data) => ({ auth: { uid: UID }, data })

beforeAll(() => {
  if (PROJECT !== 'demo-akayis-test' || !/^(127\.0\.0\.1|localhost):\d+$/.test(HOST || '')) throw new Error('Émulateur demo requis')
  app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT })
  db = getFirestore(app)
})
afterAll(async () => { await deleteApp(app) })

const profil = (role = 'store_admin') => db.doc(`users/${UID}`).set({ role, active: true, storeId: STORE, name: 'Boutique N', email: 'n@c2egf.test' })

beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await Promise.all([
    profil(),
    db.doc(`stores/${STORE}`).set({ active: true, name: 'Boutique N' }),
  ])
})

const enregistrer = (flotte, dealer) => storeTransactionCommandHandler(
  request({ action: 'updateStoreNumbers', flotte, dealer }),
  { db, FieldValue, logWriter: () => {} },
)
const fiche = async () => (await db.doc(`stores/${STORE}`).get()).data()
const journal = async () => (await db.collection(`clients/${STORE}/auditLogs`).get()).docs.map((d) => d.data())

describe('TC-399 — la boutique enregistre ses numéros', () => {
  it('[TC-399-01] écrit les deux numéros sans espaces, et le journal garde l’avant et l’après', async () => {
    expect(await enregistrer('70 12 34 56', { Orange: '76543210' }))
      .toEqual({ numeros: { flotte: '70123456', dealer: { Orange: '76543210' } } })
    expect(await fiche()).toMatchObject({ flotte: '70123456', dealer: { Orange: '76543210' }, name: 'Boutique N', active: true })
    expect(await journal()).toEqual([expect.objectContaining({
      action: 'updateStoreNumbers', uid: UID,
      avant: { dealer: {} },
      apres: { flotte: '70123456', dealer: { Orange: '76543210' } },
    })])
  })

  it('[TC-399-02] un champ vidé efface ce numéro, et garde l’autre', async () => {
    await enregistrer('70123456', { Orange: '76543210' })
    expect(await enregistrer('', { Orange: '76543210' })).toEqual({ numeros: { dealer: { Orange: '76543210' } } })
    const apres = await fiche()
    expect(apres).not.toHaveProperty('flotte')
    expect(apres.dealer).toEqual({ Orange: '76543210' })
    const lignes = await journal()
    expect(lignes).toHaveLength(2)
    expect(lignes).toContainEqual(expect.objectContaining({
      avant: { flotte: '70123456', dealer: { Orange: '76543210' } },
      apres: { dealer: { Orange: '76543210' } },
    }))
  })

  it('[TC-399-03] refus : un autre rôle que le compte boutique, un numéro mal formé, un réseau inconnu ; rien ne bouge', async () => {
    await profil('member')
    await expect(enregistrer('70123456', { Orange: '' }))
      .rejects.toMatchObject({ code: 'ROLE_FORBIDDEN', message: 'Seul le compte boutique modifie ses numéros.' })
    await profil()
    await expect(enregistrer('123', { Orange: '' }))
      .rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID', message: 'Numéro flotte : 8 chiffres.' })
    await expect(enregistrer('', { Moov: '70123456' }))
      .rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID', message: 'Réseau inconnu : Moov.' })
    expect(await fiche()).toEqual({ active: true, name: 'Boutique N' })
    expect(await journal()).toEqual([])
  })

  it('[TC-399-05] chaque vrai changement date la fiche (numerosModifiesLe), pour que le patron le voie', async () => {
    // Constat SEC-14 de l'audit du 18 novembre : le journal n'est lu que par la
    // boutique. La date sur la fiche, que le patron lit déjà, dit quand.
    const avant = Date.now() - 5000
    await enregistrer('70123456', { Orange: '76543210' })
    const premiere = (await fiche()).numerosModifiesLe
    expect(premiere).toBeInstanceOf(Timestamp)
    expect(premiere.toMillis()).toBeGreaterThanOrEqual(avant)
    // Rien à changer : la date ne bouge pas.
    await enregistrer('70 12 34 56', { Orange: '76543210' })
    expect((await fiche()).numerosModifiesLe.isEqual(premiere)).toBe(true)
  })

  it('[TC-399-04] rien à changer : aucune écriture, aucune ligne au journal', async () => {
    await enregistrer('70123456', { Orange: '' })
    expect(await enregistrer('70 12 34 56', { Orange: '' }))
      .toEqual({ numeros: { flotte: '70123456', dealer: {} }, inchange: true })
    expect(await journal()).toHaveLength(1)
  })
})
