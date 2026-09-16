import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { doc, setDoc, deleteDoc, getDoc, writeBatch } from 'firebase/firestore'

let env
beforeAll(async () => {
  if (process.env.GCLOUD_PROJECT !== 'demo-akayis-test') throw new Error('Projet demo requis')
  env = await initializeTestEnvironment({
    projectId: 'demo-akayis-test',
    firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') },
  })
})
afterAll(async () => { await env?.cleanup() })
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async ctx => {
    for (const id of ['a', 'b']) {
      await setDoc(doc(ctx.firestore(), `users/${id}`), { role: 'store_admin', active: true, storeId: id })
      await setDoc(doc(ctx.firestore(), `stores/${id}`), { active: true, name: id, adminUid: id })
    }
  })
})
const draft = { type: 'Retrait', montant: 100, clientId: 'client-a', storeId: 'a', statut: 'Non Terminées' }
async function seed(extra) {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'clients/a/drafts/partial'), { ...draft, ...extra })
    await setDoc(doc(ctx.firestore(), 'clients/a/drafts/partial/settlements/p1'), { amount: 40 })
  })
}
describe('SEC-03 : conserver le parent et les tranches de règlement', () => {
  it.each([
    { paidAmount: 40, remainingAmount: 60, settlementStatus: 'partial' },
    { paidAmount: 40, refundedAmount: 40, remainingAmount: 100 },
    { settlementType: 'Retrait' },
    { originalAmount: 100 },
    { settlementUpdatedAt: null },
  ])('refuse suppression et remplacement : %j', async extra => {
    await seed(extra)
    const db = env.authenticatedContext('a').firestore()
    const ref = doc(db, 'clients/a/drafts/partial')
    await assertFails(deleteDoc(ref))
    await assertFails(setDoc(ref, { ...draft, type: 'Dépôt', montant: 1000 }))
    const batch = writeBatch(db)
    batch.delete(ref)
    batch.set(ref, { ...draft, type: 'Dépôt', montant: 1000 })
    await assertFails(batch.commit())
    expect((await getDoc(ref)).data()).toEqual({ ...draft, ...extra })
    expect((await getDoc(doc(db, 'clients/a/drafts/partial/settlements/p1'))).data().amount).toBe(40)
    await assertFails(deleteDoc(doc(env.authenticatedContext('b').firestore(), ref.path)))
  })
  it('route aussi la suppression d’un brouillon simple par le serveur', async () => {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'clients/a/drafts/plain'), draft))
    await assertFails(deleteDoc(doc(env.authenticatedContext('b').firestore(), 'clients/a/drafts/plain')))
    await assertFails(deleteDoc(doc(env.authenticatedContext('a').firestore(), 'clients/a/drafts/plain')))
  })
})
