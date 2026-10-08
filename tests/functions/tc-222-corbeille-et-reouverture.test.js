import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'

/**
 * TC-222 — La corbeille, la réouverture et le journal des modifications.
 *
 * TROIS GESTES, UNE SEULE RÈGLE
 * ─────────────────────────────
 * Supprimer, rouvrir et corriger touchent tous les trois à un montant DÉJÀ
 * compté dans les cartes stock et liquidité. La règle qui les gouverne est la
 * même : après le geste, les soldes doivent valoir ce qu'ils vaudraient si
 * l'histoire s'était déroulée autrement — jamais « à peu près ».
 *
 * POURQUOI ROUVRIR NE REMET PAS LES SOLDES À ZÉRO
 * ──────────────────────────────────────────────
 * C'est le piège de ce lot. `validateDraft` n'applique que la jambe du
 * RÈGLEMENT (la liquidité qui entre), en supposant que la jambe du BROUILLON
 * (le stock qui sort) est déjà dans les soldes — c'est `add` qui l'a posée.
 * Rouvrir en défaisant tout ramènerait donc un brouillon dont la revalidation
 * compterait le stock une fois de moins qu'il ne faut.
 *
 * La cible d'une réouverture est l'état « brouillon tout juste saisi », obtenu
 * en composant deux primitives déjà testées : tout défaire, puis reposer la
 * seule jambe du brouillon. Les deux assertions de TC-222-10 et TC-222-11
 * figent cette différence d'un cran, parce que c'est elle qui se perdrait
 * d'abord lors d'une relecture distraite.
 *
 * CE QUE LE PROFIL C2EGF IMPOSE AU TEST
 * ─────────────────────────────────────
 * Il n'existe pas de bouton « Valider » tout court : un dépôt se valide par
 * « Encaisser », un retrait par « Payer par ». Donc TOUTE ligne d'historique
 * porte un `paymentMethod`. Les fixtures passent par le vrai chemin
 * (`add` puis `validateDraft`) au lieu d'écrire un document à la main, pour
 * que les champs de règlement soient ceux que la production verra.
 */

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const UID = 'store-corbeille-admin'
const STORE = 'store-corbeille-a'
const request = data => ({ auth: { uid: UID }, data })

// De quoi encaisser ET payer sans buter sur une liquidité insuffisante : un
// retrait consomme la liquidité, et un fixture trop serré ferait échouer le
// test pour une raison qui n'a rien à voir avec ce qu'il mesure.
const STOCK_INITIAL = 500_000
const LIQUIDITE_INITIALE = 300_000

beforeAll(() => {
  if (PROJECT !== 'demo-akayis-test' || !/^(127\.0\.0\.1|localhost):\d+$/.test(HOST || '')) throw new Error('Émulateur demo requis')
  app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT })
  db = getFirestore(app)
})
afterAll(async () => { await deleteApp(app) })
beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await db.doc(`users/${UID}`).set({ role: 'store_admin', active: true, storeId: STORE, name: 'Awa', email: 'awa@c2egf.test' })
  await db.doc(`stores/${STORE}`).set({ active: true, name: 'Boutique A', adminUid: UID })
  await db.doc(`clients/${STORE}/networkBalances/current`).set({
    balances: { Orange: { stock: STOCK_INITIAL, liquidite: LIQUIDITE_INITIALE } },
  })
})

const call = data => storeTransactionCommandHandler(request(data), { db, FieldValue, logWriter: () => {} })
const soldes = async () => (await db.doc(`clients/${STORE}/networkBalances/current`).get()).data().balances.Orange
const ligne = async id => (await db.doc(`clients/${STORE}/history/${id}`).get()).data()
const brouillon = async id => (await db.doc(`clients/${STORE}/drafts/${id}`).get()).data()

const saisir = ({ montant = 100_000, type = 'Dépôt' } = {}) => call({
  action: 'add',
  transaction: { clientId: 'client-1', client: { nom: 'Ouedraogo', prenom: 'Kader' }, type, reseau: 'Orange', code: '000111', montant, statut: 'Non Terminées' },
})

const saisirPuisValider = async ({ montant = 100_000, type = 'Dépôt', paymentMethod = 'Cash' } = {}) => {
  const draft = await saisir({ montant, type })
  const { historyId } = await call({ action: 'validateDraft', draftId: draft.id, paymentMethod })
  return historyId
}

// ---------------------------------------------------------------------------
// trashHistory — la suppression d'une ligne validée
// ---------------------------------------------------------------------------

describe('TC-222 — trashHistory', () => {
  it('[TC-222-01] rend le montant, marque la ligne et écrit l’audit', async () => {
    const historyId = await saisirPuisValider()
    expect(await soldes()).toEqual({ stock: 400_000, liquidite: 400_000 })

    await call({ action: 'trashHistory', historyId })

    // Supprimer veut dire « cette transaction n'a pas eu lieu » : les soldes
    // reviennent exactement à leur valeur d'avant la saisie.
    expect(await soldes()).toEqual({ stock: STOCK_INITIAL, liquidite: LIQUIDITE_INITIALE })

    const apres = await ligne(historyId)
    expect(apres.statut).toBe('Supprimée')
    expect(apres.origin).toBe('history')
    expect(apres.deletedBy).toBe(UID)
    expect(apres.deletedByName).toBe('Awa')
    expect(apres.deletedAt).toBeTruthy()

    const audits = await db.collection(`clients/${STORE}/auditLogs`).where('action', '==', 'trashHistory').get()
    expect(audits.size).toBe(1)
    expect(audits.docs[0].data()).toMatchObject({
      historyId,
      uid: UID,
      beforeBalances: { Orange: { stock: 400_000, liquidite: 400_000 } },
      afterBalances: { Orange: { stock: STOCK_INITIAL, liquidite: LIQUIDITE_INITIALE } },
    })
  })

  it('[TC-222-02] rend le montant d’un retrait payé en espèces', async () => {
    const historyId = await saisirPuisValider({ montant: 50_000, type: 'Retrait' })
    expect(await soldes()).toEqual({ stock: 550_000, liquidite: 250_000 })

    await call({ action: 'trashHistory', historyId })
    expect(await soldes()).toEqual({ stock: STOCK_INITIAL, liquidite: LIQUIDITE_INITIALE })
  })

  it('[TC-222-03] refuse de rendre deux fois le même montant', async () => {
    const historyId = await saisirPuisValider()
    await call({ action: 'trashHistory', historyId })

    await expect(call({ action: 'trashHistory', historyId })).rejects.toThrow()
    // Le second refus ne doit rien avoir bougé : c'est tout l'intérêt du garde-fou.
    expect(await soldes()).toEqual({ stock: STOCK_INITIAL, liquidite: LIQUIDITE_INITIALE })
  })

  it('[TC-222-04] refuse un ravitaillement', async () => {
    const { id } = await call({ action: 'replenish', expediteur: 'Patron', amount: 10_000, balanceType: 'stock' })
    await expect(call({ action: 'trashHistory', historyId: id })).rejects.toThrow()
    expect((await ligne(id)).statut).toBe('Validée')
  })

  it('[TC-222-05] refuse une clôture', async () => {
    const { id } = await call({ action: 'closeDay' })
    await expect(call({ action: 'trashHistory', historyId: id })).rejects.toThrow()
  })

  it('[TC-222-06] refuse une trace de collaboration', async () => {
    const historyId = await saisirPuisValider()
    await db.doc(`clients/${STORE}/history/${historyId}`).update({ collaborationId: 'collab-7' })
    await expect(call({ action: 'trashHistory', historyId })).rejects.toThrow()
  })

  it('[TC-222-07] refuse une ligne partiellement réglée', async () => {
    const historyId = await saisirPuisValider()
    // Deux tranches sur trois encaissées : supprimer laisserait des tranches
    // orphelines, que `reverseHistoryTransactionImpact` ne sait pas recoller.
    await db.doc(`clients/${STORE}/history/${historyId}`).update({
      settlementStatus: 'partial',
      remainingAmount: 40_000,
    })
    await expect(call({ action: 'trashHistory', historyId })).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// trashDraft — la suppression d'une non terminée
// ---------------------------------------------------------------------------

describe('TC-222 — trashDraft', () => {
  it('[TC-222-08] rend le stock et déplace le brouillon dans la corbeille', async () => {
    const draft = await saisir()
    expect(await soldes()).toEqual({ stock: 400_000, liquidite: LIQUIDITE_INITIALE })

    const { historyId } = await call({ action: 'trashDraft', draftId: draft.id })

    expect(await soldes()).toEqual({ stock: STOCK_INITIAL, liquidite: LIQUIDITE_INITIALE })
    expect(await brouillon(draft.id)).toBeUndefined()

    // La ligne atterrit dans `history` pour que la corbeille reste UNE liste,
    // servie par l'abonnement et la pagination qui existent déjà.
    const corbeille = await ligne(historyId)
    expect(corbeille).toMatchObject({
      statut: 'Supprimée',
      origin: 'draft',
      montant: 100_000,
      type: 'Dépôt',
      deletedBy: UID,
    })
  })

  it('[TC-222-09] refuse un brouillon dont des tranches sont engagées', async () => {
    const draft = await saisir()
    await db.doc(`clients/${STORE}/drafts/${draft.id}`).update({ settlementStatus: 'partial', paidAmount: 60_000 })
    await expect(call({ action: 'trashDraft', draftId: draft.id })).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// reopenHistory — ramener une ligne validée dans le formulaire
// ---------------------------------------------------------------------------

describe('TC-222 — reopenHistory', () => {
  it('[TC-222-10] ramène les soldes à l’état brouillon, PAS à zéro', async () => {
    const historyId = await saisirPuisValider()
    expect(await soldes()).toEqual({ stock: 400_000, liquidite: 400_000 })

    await call({ action: 'reopenHistory', historyId })

    // Le stock reste sorti (−100 000) parce que le brouillon existe de nouveau ;
    // seule la liquidité encaissée est rendue. Revalider rejouera la seule
    // jambe du règlement, et les soldes retomberont juste.
    expect(await soldes()).toEqual({ stock: 400_000, liquidite: LIQUIDITE_INITIALE })
  })

  it('[TC-222-11] revalider après réouverture retombe sur les mêmes soldes', async () => {
    const historyId = await saisirPuisValider()
    const avant = await soldes()

    const { draftId } = await call({ action: 'reopenHistory', historyId })
    await call({ action: 'validateDraft', draftId, paymentMethod: 'Cash' })

    // La boucle complète est neutre : c'est la preuve que l'état intermédiaire
    // choisi en TC-222-10 est le bon.
    expect(await soldes()).toEqual(avant)
  })

  it('[TC-222-12] crée un brouillon dépouillé de tout le règlement', async () => {
    const historyId = await saisirPuisValider()
    const { draftId } = await call({ action: 'reopenHistory', historyId })

    const draft = await brouillon(draftId)
    expect(draft).toMatchObject({
      statut: 'Non Terminées',
      type: 'Dépôt',
      montant: 100_000,
      reseau: 'Orange',
      clientId: 'client-1',
      reopenedFromHistoryId: historyId,
    })
    // Un seul de ces champs qui survivrait ferait croire le brouillon réglé, et
    // `updateDraft` le refuserait aussitôt — le gérant ne pourrait plus le corriger.
    for (const champ of [
      'paymentMethod', 'effectiveNetwork', 'validatedAt',
      'originalAmount', 'paidAmount', 'refundedAmount', 'remainingAmount',
      'settlementStatus', 'settlementSummary', 'settlementUpdatedAt',
      'settlementAmount', 'settlementType',
    ]) {
      expect(draft).not.toHaveProperty(champ)
    }
  })

  it('[TC-222-13] le brouillon rouvert reste modifiable', async () => {
    const historyId = await saisirPuisValider()
    const { draftId } = await call({ action: 'reopenHistory', historyId })

    await expect(call({ action: 'updateDraft', draftId, updates: { montant: 90_000 } })).resolves.toMatchObject({ montant: 90_000 })
  })

  it('[TC-222-14] garde la date d’origine : la transaction ne saute pas à aujourd’hui', async () => {
    const historyId = await saisirPuisValider()
    const dateOrigine = (await ligne(historyId)).date

    const { draftId } = await call({ action: 'reopenHistory', historyId })
    expect((await brouillon(draftId)).date).toBe(dateOrigine)
  })

  it('[TC-222-15] retire la ligne de l’historique', async () => {
    const historyId = await saisirPuisValider()
    await call({ action: 'reopenHistory', historyId })
    expect(await ligne(historyId)).toBeUndefined()
  })

  it('[TC-222-16] refuse un ravitaillement, une clôture et une ligne supprimée', async () => {
    const { id: ravito } = await call({ action: 'replenish', expediteur: 'Patron', amount: 10_000, balanceType: 'stock' })
    await expect(call({ action: 'reopenHistory', historyId: ravito })).rejects.toThrow()

    const supprimee = await saisirPuisValider()
    await call({ action: 'trashHistory', historyId: supprimee })
    await expect(call({ action: 'reopenHistory', historyId: supprimee })).rejects.toThrow()
  })

  it('[TC-222-17] refuse une ligne partiellement réglée', async () => {
    const historyId = await saisirPuisValider()
    await db.doc(`clients/${STORE}/history/${historyId}`).update({ settlementStatus: 'partial', remainingAmount: 40_000 })
    await expect(call({ action: 'reopenHistory', historyId })).rejects.toThrow()
  })

  /**
   * LA LIGNE VALIDÉE D’UN GESTE, SANS RÈGLEMENT.
   *
   * Le bouton « Valider » du formulaire ecrit directement dans l historique :
   * la ligne porte les DEUX jambes — stock sorti, liquidite entree — mais
   * aucun `paymentMethod`. Les imports et les migrations empruntent le meme
   * chemin et produisent la meme forme.
   *
   * Elle se rouvre comme les autres. Toute la difficulte est que la
   * revalidation doit REJOUER ces deux jambes : `validateDraft` ne pose la
   * jambe de liquidite que s il recoit un mode de reglement, ou le drapeau
   * `direct`. Sans ce drapeau, la liquidite disparaitrait des soldes sans
   * erreur et sans trace, et l ecart n apparaitrait qu a la cloture — c est
   * exactement ce que TC-222-27 interdit.
   */
  it('[TC-222-23] rouvre une ligne validée sans mode de règlement', async () => {
    const { id } = await call({
      action: 'add',
      transaction: { clientId: 'client-1', type: 'Dépôt', reseau: 'Orange', montant: 100_000, statut: 'Validée' },
    })

    const { draftId } = await call({ action: 'reopenHistory', historyId: id })
    const draft = await brouillon(draftId)

    expect(draft.reopenedDirect).toBe(true)
    expect(draft.reopenedPaymentMethod).toBeNull()
    // Etat « brouillon tout juste saisi » : le stock reste sorti, la liquidite
    // encaissee est rendue.
    expect(await soldes()).toEqual({ stock: 400_000, liquidite: LIQUIDITE_INITIALE })
  })

  it('[TC-222-24] une telle ligne reste supprimable', async () => {
    const { id } = await call({
      action: 'add',
      transaction: { clientId: 'client-1', type: 'Dépôt', reseau: 'Orange', montant: 100_000, statut: 'Validée' },
    })

    await call({ action: 'trashHistory', historyId: id })
    expect(await soldes()).toEqual({ stock: STOCK_INITIAL, liquidite: LIQUIDITE_INITIALE })
  })

  it('[TC-222-25] le brouillon rouvert mémorise le mode de règlement d’origine', async () => {
    const historyId = await saisirPuisValider({ paymentMethod: 'Orange Money' })
    const { draftId } = await call({ action: 'reopenHistory', historyId })

    // C'est ce souvenir qui permet à la correction de REPARTIR dans
    // l'historique sans redemander « Encaisser par quoi ? » au gérant.
    expect((await brouillon(draftId)).reopenedPaymentMethod).toBe('Orange Money')
  })

  it('[TC-222-26] corriger puis revalider par le mode mémorisé remet la ligne dans l’historique', async () => {
    const historyId = await saisirPuisValider({ montant: 100_000 })
    const { draftId } = await call({ action: 'reopenHistory', historyId })
    const { reopenedPaymentMethod } = await brouillon(draftId)

    await call({ action: 'updateDraft', draftId, updates: { montant: 60_000 } })
    const { historyId: final } = await call({ action: 'validateDraft', draftId, paymentMethod: reopenedPaymentMethod })

    const ligneFinale = await ligne(final)
    expect(ligneFinale.montant).toBe(60_000)
    expect(ligneFinale.paymentMethod).toBe('Cash')
    expect(ligneFinale.modifications.map(e => [e.avant, e.apres])).toEqual([[100_000, 60_000]])
    expect(await brouillon(draftId)).toBeUndefined()

    // Les soldes doivent valoir ce qu'ils vaudraient si 60 000 avait été saisi
    // du premier coup : stock −60 000, liquidité +60 000.
    expect(await soldes()).toEqual({ stock: 440_000, liquidite: 360_000 })
  })

  /**
   * LA BOUCLE COMPLÈTE D’UNE VALIDATION DIRECTE.
   *
   * C est l assertion qui vaut le plus cher du fichier : sans le drapeau
   * `direct`, la revalidation laisserait les soldes a { 400 000, 300 000 } —
   * cent mille francs de liquidite evapores, sans la moindre erreur levee.
   */
  it('[TC-222-27] corriger une ligne validée d’un geste rejoue ses DEUX jambes', async () => {
    const { id } = await call({
      action: 'add',
      transaction: { clientId: 'client-1', type: 'Dépôt', reseau: 'Orange', montant: 100_000, statut: 'Validée' },
    })

    const { draftId } = await call({ action: 'reopenHistory', historyId: id })
    await call({ action: 'updateDraft', draftId, updates: { montant: 70_000 } })
    const { historyId: final } = await call({ action: 'validateDraft', draftId, direct: true })

    const ligneFinale = await ligne(final)
    expect(ligneFinale.montant).toBe(70_000)
    expect(ligneFinale.statut).toBe('Validée')
    expect(ligneFinale.paymentMethod).toBeNull()
    expect(ligneFinale.directValidation).toBe(true)

    // Exactement ce que vaudrait une saisie de 70 000 validee du premier coup.
    expect(await soldes()).toEqual({ stock: 430_000, liquidite: 370_000 })
  })

  it('[TC-222-28] la ligne ainsi corrigée reste supprimable sans fuite', async () => {
    const { id } = await call({
      action: 'add',
      transaction: { clientId: 'client-1', type: 'Dépôt', reseau: 'Orange', montant: 100_000, statut: 'Validée' },
    })
    const { draftId } = await call({ action: 'reopenHistory', historyId: id })
    const { historyId: final } = await call({ action: 'validateDraft', draftId, direct: true })

    // `directValidation` doit primer sur `validatedAt`, que `validateDraft`
    // pose aussi : sinon seule la jambe du brouillon serait rendue.
    await call({ action: 'trashHistory', historyId: final })
    expect(await soldes()).toEqual({ stock: STOCK_INITIAL, liquidite: LIQUIDITE_INITIALE })
  })

  /**
   * LE RETRAIT VALIDÉ D’UN GESTE — un cas qui levait une exception.
   *
   * `reverseHistoryTransactionImpact` refusait ce cas (« L annulation
   * automatique de ce retrait historique n est pas sure. ») alors qu il
   * calculait le depot symetrique. Un retrait validé d’un geste ne pouvait donc
   * etre NI corrige NI supprime, definitivement.
   */
  it('[TC-222-29] un retrait validé d’un geste se supprime et se rouvre', async () => {
    const { id } = await call({
      action: 'add',
      transaction: { clientId: 'client-1', type: 'Retrait', reseau: 'Orange', montant: 80_000, statut: 'Validée' },
    })
    expect(await soldes()).toEqual({ stock: 580_000, liquidite: 220_000 })

    const { draftId } = await call({ action: 'reopenHistory', historyId: id })
    expect(await soldes()).toEqual({ stock: 580_000, liquidite: LIQUIDITE_INITIALE })

    await call({ action: 'validateDraft', draftId, direct: true })
    expect(await soldes()).toEqual({ stock: 580_000, liquidite: 220_000 })
  })

  it('[TC-222-30] et se supprime en rendant ses deux jambes', async () => {
    const { id } = await call({
      action: 'add',
      transaction: { clientId: 'client-1', type: 'Retrait', reseau: 'Orange', montant: 80_000, statut: 'Validée' },
    })

    await call({ action: 'trashHistory', historyId: id })
    expect(await soldes()).toEqual({ stock: STOCK_INITIAL, liquidite: LIQUIDITE_INITIALE })
  })

  /**
   * LA PIÈCE DONT TOUT LE RESTE DÉPEND.
   *
   * `applyLiquidityDelta` consomme un retrait EN CASCADE sur les reseaux : il
   * vide le premier, entame le suivant. Apres coup, la repartition n existe
   * plus nulle part — lui rendre le montant au premier reseau donnerait un
   * total juste sur une repartition fausse, l erreur qui ne se voit pas.
   *
   * `add` l ecrit donc AVANT d appliquer l impact. Sans ce champ, ni la
   * suppression ni la reouverture d un retrait valide d un geste ne seraient
   * possibles — c est lui qui a leve la limitation documentee par TC-013-F.
   */
  it('[TC-222-32] un retrait validé d’un geste enregistre sa répartition de liquidité', async () => {
    const { id } = await call({
      action: 'add',
      transaction: { clientId: 'client-1', type: 'Retrait', reseau: 'Orange', montant: 80_000, statut: 'Validée' },
    })

    const ligneCreee = await ligne(id)
    expect(ligneCreee.directValidation).toBe(true)
    expect(ligneCreee.liquiditySplit).toEqual({ Orange: 80_000 })
  })

  it('[TC-222-33] un dépôt n’en a pas besoin : sa liquidité entre d’un bloc', async () => {
    const { id } = await call({
      action: 'add',
      transaction: { clientId: 'client-1', type: 'Dépôt', reseau: 'Orange', montant: 60_000, statut: 'Validée' },
    })

    expect(await ligne(id)).not.toHaveProperty('liquiditySplit')
  })

  it('[TC-222-31] sans le drapeau `direct`, les soldes restent intacts', async () => {
    // Le comportement d origine de `validateDraft` : un mode de reglement nul
    // et pas de drapeau ne touche a rien. D autres appels en dependent.
    const draft = await saisir({ montant: 50_000 })
    const avant = await soldes()

    await call({ action: 'validateDraft', draftId: draft.id })
    expect(await soldes()).toEqual(avant)
  })

  /**
   * LA LIGNE VALIDÉE SANS RÈGLEMENT *ET* SANS LES DEUX JAMBES.
   *
   * TC-222-31 vient de la fabriquer : `validateDraft` sans mode de reglement
   * et sans drapeau ne touche pas aux soldes. La ligne obtenue porte donc
   * `validatedAt`, pas de `paymentMethod`, PAS de `directValidation` — et la
   * seule jambe du brouillon dans les soldes.
   *
   * Le piege : `reopenedDirect` ne peut pas se deduire de la seule absence de
   * mode de reglement. Cette ligne-la n a jamais pose de jambe de liquidite ;
   * la revalider en « direct » lui en inventerait une, et la correction d un
   * montant INCHANGE deplacerait les soldes. Un ecart ne — comme toujours ici —
   * d une revalidation qui ne refait pas exactement ce qu avait fait l original.
   *
   * La regle exacte est donc : « direct » veut dire QUE LA LIGNE PORTAIT SES
   * DEUX JAMBES, pas « la ligne n avait pas de mode de reglement ».
   */
  it('[TC-222-34] une ligne validée sans jambe de liquidité n’en gagne pas une à la correction', async () => {
    const draft = await saisir({ montant: 50_000 })
    const { historyId } = await call({ action: 'validateDraft', draftId: draft.id })
    const avant = await soldes()

    const { draftId } = await call({ action: 'reopenHistory', historyId })
    // Rouvrir seul est neutre : on defait la jambe du brouillon, on la repose.
    expect(await soldes()).toEqual(avant)

    // Le client rejoue ce que le serveur a memorise, comme TC-222-26.
    const { reopenedDirect } = await brouillon(draftId)
    expect(reopenedDirect).toBe(false)

    await call({ action: 'validateDraft', draftId, direct: reopenedDirect })
    // Montant inchange, soldes inchanges. C est toute l assertion.
    expect(await soldes()).toEqual(avant)
  })
})

// ---------------------------------------------------------------------------
// Le journal des modifications
// ---------------------------------------------------------------------------

describe('TC-222 — journal des modifications', () => {
  it('[TC-222-18] empile une entrée quand le montant change', async () => {
    const draft = await saisir()
    await call({ action: 'updateDraft', draftId: draft.id, updates: { montant: 90_000 } })

    const journal = (await brouillon(draft.id)).modifications
    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatchObject({ avant: 100_000, apres: 90_000, by: UID, byName: 'Awa' })
    expect(journal[0].at).toBeTruthy()
  })

  it('[TC-222-19] empile dans l’ordre chronologique sur plusieurs corrections', async () => {
    const draft = await saisir()
    await call({ action: 'updateDraft', draftId: draft.id, updates: { montant: 90_000 } })
    await call({ action: 'updateDraft', draftId: draft.id, updates: { montant: 80_000 } })

    const journal = (await brouillon(draft.id)).modifications
    expect(journal.map(e => [e.avant, e.apres])).toEqual([[100_000, 90_000], [90_000, 80_000]])
  })

  it('[TC-222-20] n’empile rien quand le montant ne change pas', async () => {
    const draft = await saisir()
    await call({ action: 'updateDraft', draftId: draft.id, updates: { code: '999888' } })

    expect((await brouillon(draft.id)).modifications ?? []).toEqual([])
  })

  it('[TC-222-21] le journal remonte dans l’historique à la validation', async () => {
    const draft = await saisir()
    await call({ action: 'updateDraft', draftId: draft.id, updates: { montant: 90_000 } })
    const { historyId } = await call({ action: 'validateDraft', draftId: draft.id, paymentMethod: 'Cash' })

    const journal = (await ligne(historyId)).modifications
    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatchObject({ avant: 100_000, apres: 90_000 })
  })

  it('[TC-222-22] le journal survit à une réouverture', async () => {
    const draft = await saisir()
    await call({ action: 'updateDraft', draftId: draft.id, updates: { montant: 90_000 } })
    const { historyId } = await call({ action: 'validateDraft', draftId: draft.id, paymentMethod: 'Cash' })

    const { draftId } = await call({ action: 'reopenHistory', historyId })
    await call({ action: 'updateDraft', draftId, updates: { montant: 70_000 } })
    const { historyId: final } = await call({ action: 'validateDraft', draftId, paymentMethod: 'Cash' })

    // Le gérant doit pouvoir lire la chaîne entière, pas seulement la dernière
    // correction : c'est ce que le modal « Modification » affiche.
    expect((await ligne(final)).modifications.map(e => [e.avant, e.apres]))
      .toEqual([[100_000, 90_000], [90_000, 70_000]])
  })
})
