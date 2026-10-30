import { describe, it, expect, vi } from 'vitest'
import {
  DECLARATIONS_DE_PREPARATION,
  OUTILS_DE_PREPARATION,
  preparerOperation,
  resoudreExpediteur,
  trouverClient,
  trouverOperationEnAttente,
} from '../../src/lib/ia/preparations.js'
import { DECLARATIONS } from '../../src/lib/ia/outils.js'

/**
 * TC-308 — L'assistant PRÉPARE, la caissière confirme.
 *
 * Ce qui est figé ici :
 *   - une préparation n'enregistre rien et le DIT au modèle ;
 *   - elle applique les règles des écrans (stock, espèces, plafonds) ;
 *   - un doute (deux clients, deux opérations) se pose en question, jamais en
 *     supposition ;
 *   - la carte porte la commande EXACTE que l'écran aurait envoyée.
 *
 * Profil des tests : C2EGF (Dépôt et Retrait, Orange Money et Cash, Orange).
 */

const SALIF = { id: 'c-1', nom: 'OUEDRAOGO', prenom: 'Salif', codeAgent: '4544102', orange: '4544102' }
const SALIFOU = { id: 'c-2', nom: 'OUEDRAOGO', prenom: 'Salifou', numeroAgent: '76965827', orange: '76965827' }
const AWA = { id: 'c-3', nom: 'KABORE', prenom: 'Awa', codeAgent: '1234567', orange: '1234567' }
const CLIENTS = [SALIF, SALIFOU, AWA]

const ligne = (over = {}) => ({
  id: 'd-1',
  type: 'Dépôt',
  client: SALIF,
  clientId: SALIF.id,
  code: SALIF.orange,
  montant: 50000,
  statut: 'Non Terminées',
  date: '30/10/2026 09:00',
  createdAt: new Date('2026-10-30T09:00:00Z'),
  ...over,
})

const LIVRAISON = {
  id: 'r-1',
  type: 'Ravitaillement',
  expediteur: 'Mme Sawadogo',
  montant: 500000,
  remainingAmount: 300000,
  balanceType: 'stock',
  date: '30/10/2026 08:00',
}

const etat = (over = {}) => ({
  clients: CLIENTS,
  enAttente: [ligne()],
  ravitaillements: [LIVRAISON],
  expediteurs: ['Patron', 'Mme Sawadogo', 'Mohamed'],
  validateAmount: () => ({ isValid: true, message: '' }),
  liquidite: 100000,
  disponible: (vase) => (vase === 'stock' ? 400000 : 150000),
  ...over,
})

describe('TC-308 — les déclarations', () => {
  it('[IP-01] les cinq préparations sont offertes au modèle', () => {
    expect(OUTILS_DE_PREPARATION).toEqual([
      'preparer_transaction',
      'preparer_reglement',
      'preparer_annulation',
      'preparer_ravitaillement',
      'preparer_retour',
    ])
    const offerts = DECLARATIONS.map((d) => d.name)
    for (const nom of OUTILS_DE_PREPARATION) expect(offerts).toContain(nom)
  })

  it('[IP-02] chacune dit au modèle que la caissière confirme', () => {
    for (const declaration of DECLARATIONS_DE_PREPARATION) {
      expect(declaration.description).toMatch(/PRÉPARE/)
      expect(declaration.description).toMatch(/confirme/)
    }
  })

  it('[IP-03] les natures et les moyens sont ceux du profil', () => {
    const transaction = DECLARATIONS_DE_PREPARATION.find((d) => d.name === 'preparer_transaction')
    const reglement = DECLARATIONS_DE_PREPARATION.find((d) => d.name === 'preparer_reglement')
    expect(transaction.parameters.properties.type.enum).toEqual(['Dépôt', 'Retrait'])
    expect(reglement.parameters.properties.moyen.enum).toEqual(['Orange Money', 'Cash'])
  })
})

describe('TC-308 — trouverClient', () => {
  it('[IP-04] un code tapé en entier désigne sa fiche', () => {
    expect(trouverClient(CLIENTS, '4544102')).toEqual({ client: SALIF })
    expect(trouverClient(CLIENTS, '76 96 58 27')).toEqual({ client: SALIFOU })
  })

  it('[IP-05] un code inconnu est un refus qui dit comment enregistrer', () => {
    const { refus } = trouverClient(CLIENTS, '9999999')
    expect(refus).toMatch(/Aucun client n'a le code ou le numéro 9999999/)
    expect(refus).toMatch(/« \+ Enregistrer ce client »/)
  })

  it('[IP-06] un nom unique suffit, accents et casse pardonnés', () => {
    expect(trouverClient(CLIENTS, 'awa kaboré')).toEqual({ client: AWA })
  })

  it('[IP-07] deux fiches proches : le nom exact l’emporte', () => {
    expect(trouverClient(CLIENTS, 'Salif Ouedraogo')).toEqual({ client: SALIF })
  })

  it('[IP-08] un nom partagé reste un doute', () => {
    expect(trouverClient(CLIENTS, 'Ouedraogo')).toMatchObject({ total: 2 })
  })
})

describe('TC-308 — preparer_transaction', () => {
  it('[IP-09] rend une carte et dit au modèle que rien n’est enregistré', () => {
    const { carte, reponse } = preparerOperation('preparer_transaction', {
      client: '4544102', type: 'Dépôt', montant: 50000, statut: 'Non Terminées',
    }, etat())

    expect(reponse.presentee).toBe(true)
    expect(reponse.consigne).toMatch(/rien n'est enregistré avant/)
    expect(carte.titre).toBe('Dépôt non terminé')
    expect(carte.execution).toEqual({
      genre: 'transaction',
      transactionData: {
        client: SALIF,
        clientId: 'c-1',
        type: 'Dépôt',
        reseau: 'Orange',
        code: '4544102',
        montant: 50000,
        statut: 'Non Terminées',
      },
    })
  })

  it('[IP-10] le contrôle de stock de l’écran s’applique', () => {
    const validateAmount = vi.fn(() => ({ isValid: false, message: 'Stock insuffisant pour Orange. Disponible: 10 000 FCFA' }))
    const { carte, reponse } = preparerOperation('preparer_transaction', {
      client: 'Awa Kaboré', type: 'Dépôt', montant: 50000, statut: 'Validée',
    }, etat({ validateAmount }))

    expect(carte).toBeUndefined()
    expect(reponse).toEqual({ erreur: true, message: 'Stock insuffisant pour Orange. Disponible: 10 000 FCFA' })
    expect(validateAmount).toHaveBeenCalledWith('Orange', '50000', 'Dépôt')
  })

  it('[IP-11] un retrait au-delà des espèces attend, mais ne se valide pas', () => {
    const args = { client: 'Awa Kaboré', type: 'Retrait', montant: 200000 }
    const valide = preparerOperation('preparer_transaction', { ...args, statut: 'Validée' }, etat())
    const enAttente = preparerOperation('preparer_transaction', { ...args, statut: 'Non Terminées' }, etat())

    expect(valide.reponse.message).toMatch(/^Liquidité insuffisante/)
    expect(enAttente.carte.titre).toBe('Retrait non terminé')
  })

  it('[IP-12] deux clients possibles : une question, avec les codes', () => {
    const { carte, reponse } = preparerOperation('preparer_transaction', {
      client: 'Ouedraogo', type: 'Dépôt', montant: 5000, statut: 'Validée',
    }, etat())

    expect(carte).toBeUndefined()
    expect(reponse.a_preciser).toBe(true)
    expect(reponse.choix).toEqual(expect.arrayContaining([
      { nom: 'Salif OUEDRAOGO', code: '4544102' },
      { nom: 'Salifou OUEDRAOGO', code: '76965827' },
    ]))
  })

  it('[IP-13] sans statut clair, on demande au lieu de supposer', () => {
    const { reponse } = preparerOperation('preparer_transaction', {
      client: '4544102', type: 'Dépôt', montant: 5000, statut: '',
    }, etat())
    expect(reponse).toMatchObject({ a_preciser: true, choix: ['Non Terminées', 'Validée'] })
  })

  it('[IP-14] une nature que le profil n’a pas est une question', () => {
    const { reponse } = preparerOperation('preparer_transaction', {
      client: '4544102', type: 'Crédit', montant: 5000, statut: 'Validée',
    }, etat())
    expect(reponse).toMatchObject({ a_preciser: true, choix: ['Dépôt', 'Retrait'] })
  })
})

describe('TC-308 — trouverOperationEnAttente', () => {
  const DEUX = [
    ligne({ id: 'd-2', montant: 20000, createdAt: new Date('2026-10-30T11:00:00Z') }),
    ligne({ id: 'd-1', createdAt: new Date('2026-10-30T09:00:00Z') }),
    ligne({ id: 'd-3', type: 'Retrait', client: AWA, clientId: AWA.id, code: AWA.orange }),
  ]

  it('[IP-15] par nom ou par code, la ligne du client', () => {
    expect(trouverOperationEnAttente(DEUX, { client: 'awa' }).ligne.id).toBe('d-3')
    expect(trouverOperationEnAttente(DEUX, { client: '1234567' }).ligne.id).toBe('d-3')
  })

  it('[IP-16] deux opérations du même client : une liste numérotée, la plus ancienne d’abord', () => {
    const { reponse } = trouverOperationEnAttente(DEUX, { client: 'Salif' })
    expect(reponse.a_preciser).toBe(true)
    expect(reponse.choix.map((c) => c.numero)).toEqual([1, 2])
    expect(reponse.choix[0].montant).toMatch(/^50/)
    expect(trouverOperationEnAttente(DEUX, { client: 'Salif', operation: 2 }).ligne.id).toBe('d-2')
  })

  it('[IP-17] la nature départage', () => {
    expect(trouverOperationEnAttente(DEUX, { client: 'Awa', type: 'Retrait' }).ligne.id).toBe('d-3')
    expect(trouverOperationEnAttente(DEUX, { client: 'Awa', type: 'Dépôt' }).reponse.message)
      .toBe('Aucun dépôt non terminé pour « Awa ».')
  })
})

describe('TC-308 — preparer_reglement', () => {
  it('[IP-18] encaisser un dépôt : le reste dû entier par défaut', () => {
    const { carte } = preparerOperation('preparer_reglement', { client: 'Salif', moyen: 'Orange Money' }, etat())
    expect(carte.titre).toBe('Encaisser — Orange Money')
    expect(carte.execution).toEqual({
      genre: 'reglement', action: 'encaisser', draftId: 'd-1', montant: 50000, moyen: 'Orange Money', codeAgent: undefined,
    })
  })

  it('[IP-19] payer un retrait, en partie, avec un code agent', () => {
    const retrait = ligne({ type: 'Retrait', remainingAmount: 30000 })
    const { carte } = preparerOperation('preparer_reglement', {
      client: 'Salif', moyen: 'espèces', montant: 10000, code_agent: ' 7777777 ',
    }, etat({ enAttente: [retrait] }))
    expect(carte.execution).toMatchObject({ action: 'payerPar', montant: 10000, moyen: 'Cash', codeAgent: '7777777' })
    expect(carte.lignes).toContainEqual({ libelle: 'Reste dû après', valeur: expect.stringMatching(/^20/) })
  })

  it('[IP-20] les plafonds du tableau s’appliquent', () => {
    const { reponse } = preparerOperation('preparer_reglement', { client: 'Salif', moyen: 'Cash', montant: 60000 }, etat())
    expect(reponse).toEqual({ erreur: true, message: `Maximum : ${(50000).toLocaleString('fr-FR')} FCFA (reste dû)` })
  })

  it('[IP-21] sans moyen, on demande', () => {
    const { reponse } = preparerOperation('preparer_reglement', { client: 'Salif' }, etat())
    expect(reponse).toMatchObject({ a_preciser: true, choix: ['Orange Money', 'Cash'] })
  })
})

describe('TC-308 — preparer_annulation', () => {
  it('[IP-22] la carte dit ce que fait l’annulation, et part à la corbeille', () => {
    const { carte } = preparerOperation('preparer_annulation', { client: '4544102' }, etat())
    expect(carte.danger).toBe(true)
    expect(carte.avertissement).toMatch(/corbeille/)
    expect(carte.execution).toEqual({ genre: 'corbeille', id: 'd-1' })
  })
})

describe('TC-308 — preparer_ravitaillement', () => {
  it('[IP-23] un nom connu, même partiel, est repris tel que la liste l’écrit', () => {
    expect(resoudreExpediteur(['Patron', 'Mme Sawadogo'], 'sawadogo')).toEqual({ nom: 'Mme Sawadogo', nouveau: false })
    expect(resoudreExpediteur(['Patron', 'Mme Sawadogo'], 'Issa')).toEqual({ nom: 'Issa', nouveau: true })
  })

  it('[IP-24] rend la commande du formulaire', () => {
    const { carte } = preparerOperation('preparer_ravitaillement', {
      expediteur: 'patron', montant: 200000, reserve: 'Espèce',
    }, etat())
    expect(carte.execution).toEqual({
      genre: 'commande',
      commande: { action: 'replenish', amount: 200000, balanceType: 'liquidite', expediteur: 'Patron', note: undefined },
    })
    expect(carte.avertissement).toBeUndefined()
  })

  it('[IP-25] un nouveau nom est montré comme tel sur la carte', () => {
    const { carte } = preparerOperation('preparer_ravitaillement', { expediteur: 'Issa', montant: 1000, reserve: 'Stock' }, etat())
    expect(carte.avertissement).toMatch(/« Issa » n'a encore rien envoyé/)
  })

  it('[IP-26] sans expéditeur ni réserve, on demande', () => {
    expect(preparerOperation('preparer_ravitaillement', { montant: 1000, reserve: 'Stock' }, etat()).reponse.a_preciser).toBe(true)
    expect(preparerOperation('preparer_ravitaillement', { expediteur: 'Patron', montant: 1000 }, etat()).reponse.a_preciser).toBe(true)
  })
})

describe('TC-308 — preparer_retour', () => {
  it('[IP-27] rend à la livraison due, dans la réserve reçue par défaut', () => {
    const { carte } = preparerOperation('preparer_retour', { expediteur: 'Sawadogo', montant: 100000 }, etat())
    expect(carte.execution).toEqual({
      genre: 'commande',
      commande: { action: 'returnReplenishment', replenishmentId: 'r-1', amount: 100000, balanceType: 'stock' },
    })
  })

  it('[IP-28] la réserve qui ne couvre pas est nommée', () => {
    const { reponse } = preparerOperation('preparer_retour', { expediteur: 'Mme Sawadogo', montant: 200000, reserve: 'Espèce' }, etat())
    expect(reponse.message).toMatch(/^Espèce insuffisante/)
  })

  it('[IP-29] personne à qui rendre : un refus qui dit à qui l’on doit', () => {
    const { reponse } = preparerOperation('preparer_retour', { expediteur: 'Patron', montant: 1000 }, etat())
    expect(reponse).toEqual({ erreur: true, message: "Rien n'est dû à « Patron ». Il reste à rendre à : Mme Sawadogo." })
  })

  it('[IP-30] deux livraisons dues : on choisit', () => {
    const deux = [LIVRAISON, { ...LIVRAISON, id: 'r-2', montant: 100000, remainingAmount: 100000 }]
    const question = preparerOperation('preparer_retour', { expediteur: 'Mme Sawadogo', montant: 1000 }, etat({ ravitaillements: deux }))
    expect(question.reponse.choix).toHaveLength(2)
    const choisie = preparerOperation('preparer_retour', { expediteur: 'Mme Sawadogo', montant: 1000, livraison: 2 }, etat({ ravitaillements: deux }))
    expect(choisie.carte.execution.commande.replenishmentId).toBe('r-2')
  })
})

describe('TC-308 — preparerOperation', () => {
  it('[IP-31] un outil inconnu est un refus, jamais une exception', () => {
    expect(preparerOperation('vider_les_soldes', {}, etat())).toEqual({
      reponse: { erreur: true, message: 'Je ne sais pas préparer « vider_les_soldes ».' },
    })
  })

  it('[IP-32] une panne de l’état devient un refus', () => {
    const casse = etat({ validateAmount: () => { throw new Error('boum') } })
    const console_ = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { reponse } = preparerOperation('preparer_transaction', {
      client: '4544102', type: 'Dépôt', montant: 5000, statut: 'Validée',
    }, casse)
    expect(reponse).toEqual({ erreur: true, message: "Je n'ai pas pu préparer cette opération." })
    console_.mockRestore()
  })
})
