import { describe, it, expect, vi } from 'vitest'
import {
  clientDeLaTransaction,
  evaluerTransaction,
  preparerTransaction,
  estValidationDirecte,
  reseauxDisponibles,
} from '../../src/utils/preparationTransaction.js'
import { preparerRavitaillement, preparerRetour, libelleVase } from '../../src/utils/ravitaillement.js'

/**
 * TC-305 — La préparation d'une opération, hors de tout écran.
 *
 * Le formulaire et l'assistant doivent décider avec les MÊMES règles. Ces
 * fonctions sont celles que le formulaire employait en ligne ; les tests
 * composants (TC-104, TC-219, TC-302, TC-216, TC-229, TC-242) gardent le
 * formulaire, ceux-ci gardent les règles elles-mêmes.
 */

const FICHE = { id: 'c-1', nom: 'BANABA', prenom: 'Guafarou', orange: '45441020' }
const stockSuffisant = () => ({ isValid: true, message: '' })

const evaluer = (surcharge = {}) => evaluerTransaction({
  client: FICHE,
  montant: '5000',
  type: 'Dépôt',
  reseau: 'Orange',
  validateAmount: stockSuffisant,
  liquidite: 500000,
  ...surcharge,
})

describe('TC-305 — clientDeLaTransaction', () => {
  it('[PT-01] la fiche désignée passe telle quelle', () => {
    expect(clientDeLaTransaction({ client: FICHE, codeTape: '999', reseau: 'Orange' })).toBe(FICHE)
  })

  it('[PT-02] sans fiche, le code tapé devient un client non enregistré', () => {
    expect(clientDeLaTransaction({ client: null, codeTape: ' 87654321 ', reseau: 'Orange' })).toEqual({
      id: 'manual-Orange-87654321',
      nom: 'Client',
      prenom: 'Non enregistré',
      orange: '87654321',
      codeAgent: '',
      numeroAgent: '87654321',
      isManual: true,
    })
  })

  it('[PT-03] ni fiche ni code : personne', () => {
    expect(clientDeLaTransaction({ client: null, codeTape: '   ', reseau: 'Orange' })).toBeNull()
  })
})

describe('TC-305 — evaluerTransaction', () => {
  it('[PT-04] un numéro qui hésite entre deux fiches bloque tout, et dit pourquoi', () => {
    const decision = evaluer({ client: null, ambigus: [FICHE, { ...FICHE, id: 'c-2' }] })
    const raison = 'Plusieurs clients portent ce numéro (2) : choisissez le bon dans la liste.'
    expect(decision.isFormValid).toBe(false)
    expect(decision.actionStates).toEqual({
      canMarkAsNonTermine: false,
      canValidate: false,
      nonTermineeReason: raison,
      validateReason: raison,
    })
  })

  it('[PT-05] un champ manquant bloque tout', () => {
    const decision = evaluer({ type: '' })
    expect(decision.isFormValid).toBe(false)
    expect(decision.actionStates.validateReason).toBe('Veuillez remplir tous les champs requis')
  })

  it('[PT-06] un client sans compte sur le réseau ne passe pas', () => {
    const decision = evaluer({ client: { ...FICHE, orange: '' } })
    expect(Boolean(decision.isFormValid)).toBe(false)
    expect(decision.networkValidation.message).toBe(
      "Ce client n'a aucun code réseau configuré. Veuillez d'abord configurer au moins un réseau.",
    )
    expect(decision.actionStates.canValidate).toBeFalsy()
  })

  it('[PT-07] un retrait au-delà des espèces se met en attente, mais ne se valide pas', () => {
    const decision = evaluer({ type: 'Retrait', montant: '600000' })
    expect(decision.isFormValid).toBeTruthy()
    expect(decision.actionStates.canMarkAsNonTermine).toBeTruthy()
    expect(decision.actionStates.canValidate).toBe(false)
    expect(decision.actionStates.validateReason).toBe(
      `Liquidité insuffisante. Disponible: ${(500000).toLocaleString('fr-FR')} FCFA`,
    )
  })

  it('[PT-08] le contrôle de stock est celui qu’on lui passe', () => {
    const validateAmount = vi.fn(() => ({ isValid: false, message: 'Stock insuffisant pour Orange.' }))
    const decision = evaluer({ validateAmount })
    expect(validateAmount).toHaveBeenCalledWith('Orange', '5000', 'Dépôt')
    expect(decision.isFormValid).toBe(false)
    expect(decision.stockValidation.message).toBe('Stock insuffisant pour Orange.')
  })

  it('[PT-09] un dépôt couvert se valide et se met en attente', () => {
    const decision = evaluer()
    expect(decision.isFormValid).toBeTruthy()
    expect(decision.actionStates.canMarkAsNonTermine).toBeTruthy()
    expect(decision.actionStates.canValidate).toBeTruthy()
  })
})

describe('TC-305 — preparerTransaction', () => {
  it('[PT-10] rend l’opération exacte et ce que la confirmation affiche', () => {
    const preparation = preparerTransaction({
      client: FICHE, reseau: 'Orange', montant: '5 000', type: 'Dépôt', statut: 'Non Terminées',
    })
    expect(preparation).toEqual({
      ok: true,
      transactionData: {
        client: FICHE,
        clientId: 'c-1',
        type: 'Dépôt',
        reseau: 'Orange',
        code: '45441020',
        montant: 5000,
        statut: 'Non Terminées',
      },
      details: {
        clientName: 'Guafarou BANABA',
        type: 'Dépôt',
        amount: (5000).toLocaleString('fr-FR'),
        network: 'Orange',
        statut: 'Non Terminées',
      },
    })
  })

  it('[PT-11] refuse sans client, sans compte réseau, ou sur un montant non entier', () => {
    const base = { reseau: 'Orange', montant: '5000', type: 'Dépôt', statut: 'Validée' }
    expect(preparerTransaction({ ...base, client: null })).toEqual({
      ok: false, raison: 'Veuillez sélectionner un client ou saisir un numéro/code agent',
    })
    expect(preparerTransaction({ ...base, client: { ...FICHE, orange: ' ' } })).toEqual({
      ok: false, raison: "BANABA Guafarou n'a pas de code Orange",
    })
    expect(preparerTransaction({ ...base, client: FICHE, montant: '12,5' })).toEqual({
      ok: false, raison: 'Le montant doit être un entier strictement positif en FCFA',
    })
  })

  it('[PT-12] « Validée » est une validation directe, quelle que soit la graphie', () => {
    expect(estValidationDirecte('Validée')).toBe(true)
    expect(estValidationDirecte(' validee ')).toBe(true)
    expect(estValidationDirecte('Non Terminées')).toBe(false)
  })

  it('[PT-13] un client non enregistré a tous les réseaux ; une fiche, ceux qu’elle porte', () => {
    expect(reseauxDisponibles(null)).toEqual([])
    expect(reseauxDisponibles({ ...FICHE, orange: '' })).toEqual([])
    expect(reseauxDisponibles(FICHE)).toContain('Orange')
  })
})

describe('TC-305 — preparerRavitaillement', () => {
  it('[RV-01] rend la commande envoyée au serveur', () => {
    expect(preparerRavitaillement({ montant: '200000', vase: 'stock', expediteur: 'Patron', note: '  ' })).toEqual({
      ok: true,
      valeur: 200000,
      commande: { action: 'replenish', amount: 200000, balanceType: 'stock', expediteur: 'Patron', note: undefined },
    })
    // Toujours du stock (2026-11-10) : une réserve passée par erreur est ignorée.
    expect(preparerRavitaillement({ montant: '1000', vase: 'liquidite', expediteur: ' Maï ', note: ' matin ' }).commande)
      .toMatchObject({ balanceType: 'stock', expediteur: 'Maï', note: 'matin' })
  })

  it('[RV-02] refuse un montant invalide, un expéditeur absent', () => {
    expect(preparerRavitaillement({ montant: '0', vase: 'stock', expediteur: 'Patron' })).toEqual({
      ok: false, motif: 'montant', raison: 'Montant invalide (entier supérieur à 0).',
    })
    expect(preparerRavitaillement({ montant: '1000', vase: 'stock', expediteur: '  ' })).toMatchObject({
      ok: false, motif: 'expediteur',
    })
    // La réserve n'est plus un choix : rien à refuser de ce côté.
    expect(preparerRavitaillement({ montant: '1000', vase: 'coffre', expediteur: 'Patron' })).toMatchObject({
      ok: true, commande: { balanceType: 'stock' },
    })
  })
})

describe('TC-305 — preparerRetour', () => {
  const LIVRAISON = { id: 'r-1', expediteur: 'Patron', remainingAmount: 300000, balanceType: 'stock' }

  it('[RT-01] rend la commande envoyée au serveur', () => {
    expect(preparerRetour({ ravitaillement: LIVRAISON, montant: '100000', vase: 'liquidite', disponible: 150000 })).toEqual({
      ok: true,
      valeur: 100000,
      commande: { action: 'returnReplenishment', replenishmentId: 'r-1', amount: 100000, balanceType: 'liquidite' },
    })
  })

  it('[RT-02] distingue les deux plafonds : le reste dû, puis la réserve', () => {
    expect(preparerRetour({ ravitaillement: LIVRAISON, montant: '400000', vase: 'stock', disponible: 900000 }))
      .toMatchObject({ ok: false, motif: 'reste' })
    expect(preparerRetour({ ravitaillement: LIVRAISON, montant: '200000', vase: 'liquidite', disponible: 150000 }))
      .toMatchObject({ ok: false, motif: 'reserve' })
    expect(preparerRetour({ ravitaillement: LIVRAISON, montant: 'abc', vase: 'stock', disponible: 900000 }))
      .toMatchObject({ ok: false, motif: 'montant' })
  })

  it('[RT-03] nomme la réserve', () => {
    expect(libelleVase('stock')).toBe('Stock')
    expect(libelleVase('liquidite')).toBe('Espèce')
  })
})
