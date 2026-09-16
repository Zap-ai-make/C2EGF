// Non-regression of audited weaknesses. Uses a dedicated local demo project.
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc, deleteDoc, getDoc, getDocs, collection, updateDoc, writeBatch } from 'firebase/firestore'
const host = process.env.FIRESTORE_EMULATOR_HOST
assert.match(host || '', /^(127\.0\.0\.1|localhost):\d+$/)
const [hostname, port] = host.split(':')
const env = await initializeTestEnvironment({projectId:'demo-c2egf-audit-repro',firestore:{host:hostname,port:Number(port),rules:readFileSync('firestore.rules','utf8')}})
const outputs=[]
const record = name => { outputs.push(name); console.log('CLOSED: '+name) }
try {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async ctx => {
    const db=ctx.firestore()
    await setDoc(doc(db,'users','a'),{role:'store_admin',active:true,storeId:'store-a',storeName:'A'})
    await setDoc(doc(db,'users','b'),{role:'store_admin',active:true,storeId:'store-b',storeName:'B'})
    await setDoc(doc(db,'stores','store-a'),{name:'A',active:true,adminUid:'a'})
    await setDoc(doc(db,'stores','store-b'),{name:'B',active:false,adminUid:'b'})
    await setDoc(doc(db,'globalClients','client-a'),{nom:'Test',prenom:'Audit',registeredStoreId:'store-a',registeredStoreName:'A'})
    await setDoc(doc(db,'clients/store-a/drafts/partial'),{type:'Retrait',montant:100,clientId:'client-a',storeId:'store-a',statut:'Non Terminées',paidAmount:40,remainingAmount:60,settlementStatus:'partial'})
    await setDoc(doc(db,'clients/store-a/drafts/partial/settlements/p1'),{amount:40})
  })
  const a=env.authenticatedContext('a').firestore()
  const b=env.authenticatedContext('b').firestore()
  await assertFails(setDoc(doc(a,'clients/store-a/networkBalances/current'),{balances:{Orange:{stock:9000000,liquidite:9000000}}}))
  await assertFails(setDoc(doc(b,'clients/store-a/networkBalances/current'),{balances:{Orange:{stock:1}}}))
  record('SEC-01 direct own and cross-store balance writes denied')
  const newcomer=env.authenticatedContext('newcomer').firestore()
  const batch=writeBatch(newcomer)
  batch.set(doc(newcomer,'stores/new-store'),{name:'New store',adminUid:'newcomer',active:true})
  batch.set(doc(newcomer,'users/newcomer'),{role:'store_admin',active:true,storeId:'new-store',storeName:'New store'})
  await assertFails(batch.commit())
  await assertFails(getDocs(collection(newcomer,'globalClients')))
  record('SEC-02 self-enrollment and global client read denied')
  await assertFails(deleteDoc(doc(a,'clients/store-a/drafts/partial')))
  assert.equal((await getDoc(doc(a,'clients/store-a/drafts/partial/settlements/p1'))).exists(),true)
  await assertFails(setDoc(doc(a,'clients/store-a/drafts/partial'),{type:'Dépôt',montant:1000,clientId:'other-client',storeId:'store-a',statut:'Non Terminées'}))
  record('SEC-03 settled parent deletion and recreation denied')
  await assertFails(setDoc(doc(a,'clients/store-a/drafts/outside-profile'),{type:'Crédit',reseau:'Moov',montant:100,clientId:'client-a',statut:'Non Terminées'}))
  record('SEC-04 direct draft write denied')
  await assertFails(setDoc(doc(b,'clients/store-b/networkBalances/current'),{balances:{Orange:{stock:123}}}))
  record('SEC-05 inactive store cannot write balances directly')
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(),'clients/store-a/history/h1'),{type:'Dépôt',reseau:'Orange',montant:100,clientId:'client-a',statut:'Validée'}))
  await assertFails(updateDoc(doc(a,'clients/store-a/history/h1'),{statut:'Annulée'}))
  await assertFails(updateDoc(doc(a,'clients/store-a/history/h1'),{statut:'Validée'}))
  record('SEC-03 history status writes denied outside atomic server command')
  console.log(JSON.stringify({checks:outputs.length,project:'demo-c2egf-audit-repro'}))
} finally { await env.cleanup() }
