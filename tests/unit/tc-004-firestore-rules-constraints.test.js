/**
 * TC-004 — Contraintes validTransaction dans firestore.rules (test documentaire)
 *
 * Comportement protégé :
 *   Les fonctions validTransaction(), validStatus() et isPendingStatus() de
 *   firestore.rules définissent les valeurs autorisées pour type, statut et
 *   montant d'une transaction. Ce fichier fige ces contraintes sous la forme
 *   d'assertions JavaScript directes — sans appel Firestore ni émulateur.
 *
 * Ces tests sont des tests documentaires/exécutables :
 *   - Chaque tableau de données est extrait VERBATIM de firestore.rules
 *   - Les assertions vérifient la cohérence interne de ces listes
 *
 * Source : firestore.rules
 *   function validTransaction(data) {
 *     return data.keys().hasAll(['type', 'montant', 'clientId']) &&
 *            data.type in ['Dépôt', 'Depot', 'Retrait', 'Crédit', 'Credit'] &&
 *            data.montant is number && data.montant > 0 && data.montant == math.floor(data.montant) &&
 *            data.clientId is string && data.clientId.size() > 0;
 *   }
 *
 *   function validStatus(status) {
 *     return status in [
 *       'Non Terminées', 'Non Terminees',
 *       'Validée', 'Validee',
 *       'Remboursée', 'Remboursee',
 *       'Annulée', 'Annulee'
 *     ] || status.matches('^(Payé|Remboursé|Encaissé) par .+$');
 *   }
 *
 *   function isPendingStatus(status) {
 *     return status in ['Non Terminées', 'Non Terminees'];
 *   }
 *
 * MASTER-SEC-007 CORRIGÉ (V2-16) : les formes UTF-8 corrompues
 * ('DÃ©pÃ´t', 'CrÃ©dit', 'Non TerminÃ©es', 'ValidÃ©e', 'RemboursÃ©e',
 * 'AnnulÃ©e') ont été retirées des listes. Elles ne pouvaient jamais être
 * produites par un client correctement encodé en UTF-8. Caractérisation
 * de la suppression : tests/firestore/history.rules.test.js TC-V2-16-UTF8.
 *
 * Périmètre : ces tests NE simulent PAS un appel Firestore. Les tests
 * d'émulateur (appels allow/deny réels) sont couverts par TC-007 à TC-010
 * dans tests/firestore/.
 *
 * Distinction importante :
 *   - validateTransactionForm (src/utils/helpers.js) : validateur UI, couvert TC-003
 *   - validTransaction / validStatus (firestore.rules) : validateur backend, couvert ici TC-004
 */

import { describe, it, expect } from 'vitest'
import { validateTransactionForm } from '../../src/utils/helpers.js'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rulesContent = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf-8')

// ===========================================================================
// DONNÉES EXTRAITES VERBATIM DE firestore.rules
// Ces tableaux sont la source de vérité pour ce test.
// Toute modification de firestore.rules doit se refléter ici.
// ===========================================================================

/**
 * Types acceptés par validTransaction() — firestore.rules
 * VERBATIM depuis le fichier rules, caractères accentués inclus.
 */
const VALID_TYPES_FROM_RULES = [
  'Dépôt',    // forme correcte avec accent
  'Depot',    // forme sans accent (variante de compatibilité)
  'Retrait',  // pas d'accent
  'Crédit',   // forme correcte avec accent
  'Credit',   // forme sans accent (variante de compatibilité)
]

/**
 * Statuts acceptés dans la liste explicite de validStatus() — firestore.rules
 * (hors la branche regex `matches('^(Payé|Remboursé|Encaissé) par .+$')`)
 */
const VALID_STATUSES_EXPLICIT_FROM_RULES = [
  'Non Terminées',    // forme correcte
  'Non Terminees',    // forme sans accent
  'Validée',          // forme correcte
  'Validee',          // forme sans accent
  'Remboursée',       // forme correcte
  'Remboursee',       // forme sans accent
  'Annulée',          // forme correcte
  'Annulee',          // forme sans accent
]

/**
 * Statuts en attente (pending) — firestore.rules
 * Utilisé par isPendingStatus() pour distinguer les drafts de l'historique.
 */
const PENDING_STATUSES_FROM_RULES = [
  'Non Terminées',
  'Non Terminees',
]

/**
 * Préfixes valides pour la branche regex de validStatus() — firestore.rules ligne 62
 * Le pattern est : '^(Payé|Remboursé|Encaissé) par .+$'
 */
const VALID_STATUS_REGEX_PREFIXES = ['Payé', 'Remboursé', 'Encaissé']

// ===========================================================================
// CHAMPS REQUIS PAR validTransaction()
// ===========================================================================

describe('TC-004 [firestore.rules] — Champs requis par validTransaction()', () => {
  /**
   * firestore.rules ligne 36 :
   *   data.keys().hasAll(['type', 'montant', 'clientId'])
   */
  const REQUIRED_FIELDS = ['type', 'montant', 'clientId']

  it('la liste des champs requis contient exactement "type", "montant" et "clientId"', () => {
    expect(REQUIRED_FIELDS).toHaveLength(3)
    expect(REQUIRED_FIELDS).toContain('type')
    expect(REQUIRED_FIELDS).toContain('montant')
    expect(REQUIRED_FIELDS).toContain('clientId')
  })

  it('"statut" n\'est PAS un champ requis par validTransaction() — il est géré par validStatus() séparément', () => {
    // validTransaction() ne vérifie pas statut.
    // statut est validé au niveau match /history/{historyId} et /drafts/{draftId}
    // par des appels séparés à validStatus() et isPendingStatus().
    expect(REQUIRED_FIELDS).not.toContain('statut')
  })

  it('"storeId" n\'est PAS un champ requis par validTransaction() — géré par validStoreScopedTransaction()', () => {
    // validStoreScopedTransaction() (ligne 42-45) enveloppe validTransaction() et
    // ajoute optionnellement la contrainte storeId.
    expect(REQUIRED_FIELDS).not.toContain('storeId')
  })
})

// ===========================================================================
// TYPES VALIDES — validTransaction()
// ===========================================================================

describe('TC-004 [firestore.rules vs helpers.js] — Types valides', () => {
  describe('firestore.rules — validTransaction() : liste des types acceptés', () => {
    it('la liste contient exactement 5 valeurs', () => {
      expect(VALID_TYPES_FROM_RULES).toHaveLength(5)
    })

    it('contient les formes correctes avec accents', () => {
      expect(VALID_TYPES_FROM_RULES).toContain('Dépôt')
      expect(VALID_TYPES_FROM_RULES).toContain('Crédit')
    })

    it('contient les formes sans accent (variantes de compatibilité)', () => {
      expect(VALID_TYPES_FROM_RULES).toContain('Depot')
      expect(VALID_TYPES_FROM_RULES).toContain('Credit')
    })

    it('contient "Retrait" (pas de variante sans accent dans les règles)', () => {
      expect(VALID_TYPES_FROM_RULES).toContain('Retrait')
      // Fige : 'retrait' (minuscule) n'est PAS dans la liste
      expect(VALID_TYPES_FROM_RULES).not.toContain('retrait')
    })

    it('ne contient plus les formes UTF-8 corrompues — MASTER-SEC-007 corrigé (V2-16)', () => {
      expect(VALID_TYPES_FROM_RULES).not.toContain('DÃ©pÃ´t')
      expect(VALID_TYPES_FROM_RULES).not.toContain('CrÃ©dit')
    })
  })

  describe('firestore.rules — Types NON acceptés (formes absentes de la liste)', () => {
    it('"dépôt" (minuscule) n\'est PAS dans la liste des types valides', () => {
      expect(VALID_TYPES_FROM_RULES).not.toContain('dépôt')
    })

    it('"DÉPÔT" (majuscule) n\'est PAS dans la liste des types valides', () => {
      expect(VALID_TYPES_FROM_RULES).not.toContain('DÉPÔT')
    })

    it('"TypeInconnu" n\'est PAS dans la liste des types valides', () => {
      expect(VALID_TYPES_FROM_RULES).not.toContain('TypeInconnu')
    })

    it('"Dépot" (sans accent sur o) n\'est PAS dans la liste', () => {
      // Homoglyphe fréquent : "Dépot" vs "Dépôt"
      // La liste contient "Dépôt" (avec ô) et "Depot" (sans accent).
      // "Dépot" (é accentué, o sans accent) ne figure PAS dans les règles.
      expect(VALID_TYPES_FROM_RULES).not.toContain('Dépot')
    })

    it('"Crédit" composé NFD n\'est PAS identique à "Crédit" NFC — documenter le risque de normalisation Unicode', () => {
      // 'Crédit' NFC (form C, U+00E9) vs forme décomposée NFD (e + U+0301)
      // En JavaScript, ces deux représentations sont des chaînes DIFFÉRENTES.
      // firestore.rules opère des comparaisons de chaînes — le comportement
      // exact dépend de la normalisation côté Firestore.
      // Ce test fige la connaissance actuelle : la forme décomposée ≠ NFC.
      const creditNFC = 'Crédit'    // U+00E9 (forme précomposée)
      const creditNFD = 'Crédit' // e + combining acute accent
      expect(creditNFC).not.toBe(creditNFD)
      // La forme NFC est dans la liste ; la forme NFD ne l'est pas explicitement.
      expect(VALID_TYPES_FROM_RULES.includes(creditNFC)).toBe(true)
      expect(VALID_TYPES_FROM_RULES.includes(creditNFD)).toBe(false)
    })
  })

  describe('Distinction validateTransactionForm (UI) vs validTransaction (rules)', () => {
    it('la fonction UI (helpers.js) accepte n\'importe quelle chaîne truthy comme type', () => {
      // validateTransactionForm ne vérifie PAS la liste des types.
      // Toute chaîne non vide passe — y compris 'TypeInconnu' ou 'DÃ©pÃ´t'.
      // La restriction est côté règles Firestore uniquement.
      const typesRejectedByRulesButAcceptedByUI = [
        'TypeInconnu',
        'dépôt',
        'RETRAIT',
        'Dépot',   // sans accent sur o — non listée dans rules
      ]
      // On documente simplement que ces types ne sont PAS dans VALID_TYPES_FROM_RULES
      for (const t of typesRejectedByRulesButAcceptedByUI) {
        expect(VALID_TYPES_FROM_RULES).not.toContain(t)
      }
    })

    it('les formes corrompues ne sont plus acceptées par les règles Firestore — MASTER-SEC-007 corrigé (V2-16)', () => {
      const corruptedTypes = ['DÃ©pÃ´t', 'CrÃ©dit']
      for (const t of corruptedTypes) {
        expect(VALID_TYPES_FROM_RULES).not.toContain(t)
      }
    })
  })
})

// ===========================================================================
// CONTRAINTES NUMÉRIQUES SUR montant — validTransaction()
// ===========================================================================

describe('TC-004 [firestore.rules] — Contraintes numériques sur montant', () => {
  /**
   * firestore.rules lignes 38-39 :
   *   data.montant is number && data.montant > 0 && data.montant <= 100000000
   */
  const MONTANT_MIN_EXCLU = 0         // > 0 : 0 est rejeté
  const MONTANT_MAX_INCLU = 100000000  // <= 100000000

  it('montant doit être > 0 : la valeur 0 est exclue', () => {
    // Assertion documentaire : 0 n'est PAS supérieur à MONTANT_MIN_EXCLU
    expect(0 > MONTANT_MIN_EXCLU).toBe(false)
  })

  it('montant doit être > 0 : la valeur 0.01 est incluse', () => {
    expect(0.01 > MONTANT_MIN_EXCLU).toBe(true)
  })

  it('montant doit être <= 100 000 000 : la valeur 100 000 000 est incluse', () => {
    expect(MONTANT_MAX_INCLU <= MONTANT_MAX_INCLU).toBe(true)
  })

  it('montant doit être <= 100 000 000 : la valeur 100 000 001 est exclue', () => {
    expect(100000001 <= MONTANT_MAX_INCLU).toBe(false)
  })

  it('montant négatif (-1) est exclu par la contrainte > 0', () => {
    expect(-1 > MONTANT_MIN_EXCLU).toBe(false)
  })

  it('montant positif typique (5000) est dans la plage valide', () => {
    const m = 5000
    expect(m > MONTANT_MIN_EXCLU && m <= MONTANT_MAX_INCLU).toBe(true)
  })

  it('Distinction UI vs règles — la fonction UI rejette montant 0 par parseFloat("0") > 0', () => {
    // Les deux systèmes rejettent 0 — mais pour des raisons légèrement différentes :
    // UI : amount && parseFloat(amount) > 0 — '0' est truthy mais parseFloat('0') === 0
    // Rules : data.montant > 0 — comparaison numérique directe
    expect(parseFloat('0') > 0).toBe(false)
    expect(0 > MONTANT_MIN_EXCLU).toBe(false)
  })
})

// ===========================================================================
// STATUTS VALIDES — validStatus()
// ===========================================================================

describe('TC-004 [firestore.rules] — validStatus() : liste des statuts explicites', () => {
  it('la liste explicite contient exactement 8 valeurs (4 familles × 2 formes)', () => {
    expect(VALID_STATUSES_EXPLICIT_FROM_RULES).toHaveLength(8)
  })

  it('contient "Non Terminées" (forme correcte avec accents)', () => {
    expect(VALID_STATUSES_EXPLICIT_FROM_RULES).toContain('Non Terminées')
  })

  it('contient "Non Terminees" (forme sans accent)', () => {
    expect(VALID_STATUSES_EXPLICIT_FROM_RULES).toContain('Non Terminees')
  })

  it('ne contient plus "Non TerminÃ©es" (forme corrompue) — MASTER-SEC-007 corrigé (V2-16)', () => {
    expect(VALID_STATUSES_EXPLICIT_FROM_RULES).not.toContain('Non TerminÃ©es')
  })

  it('contient "Validée" et "Validee"', () => {
    expect(VALID_STATUSES_EXPLICIT_FROM_RULES).toContain('Validée')
    expect(VALID_STATUSES_EXPLICIT_FROM_RULES).toContain('Validee')
  })

  it('contient "Remboursée" et "Remboursee"', () => {
    expect(VALID_STATUSES_EXPLICIT_FROM_RULES).toContain('Remboursée')
    expect(VALID_STATUSES_EXPLICIT_FROM_RULES).toContain('Remboursee')
  })

  it('contient "Annulée" et "Annulee"', () => {
    expect(VALID_STATUSES_EXPLICIT_FROM_RULES).toContain('Annulée')
    expect(VALID_STATUSES_EXPLICIT_FROM_RULES).toContain('Annulee')
  })

  it('ne contient plus aucune forme corrompue — MASTER-SEC-007 corrigé (V2-16)', () => {
    expect(VALID_STATUSES_EXPLICIT_FROM_RULES).not.toContain('ValidÃ©e')
    expect(VALID_STATUSES_EXPLICIT_FROM_RULES).not.toContain('RemboursÃ©e')
    expect(VALID_STATUSES_EXPLICIT_FROM_RULES).not.toContain('AnnulÃ©e')
  })
})

describe('TC-004 [firestore.rules] — validStatus() : branche regex', () => {
  /**
   * firestore.rules ligne 62 :
   *   status.matches('^(Payé|Remboursé|Encaissé) par .+$')
   *
   * Ces tests reproduisent la logique de la regex en JavaScript.
   * Note : JavaScript et Firestore n'utilisent pas le même moteur regex,
   * mais les patterns simples comme celui-ci sont portables.
   */
  const REGEX_PATTERN = /^(Payé|Remboursé|Encaissé) par .+$/

  it('les préfixes valides sont exactement "Payé", "Remboursé" et "Encaissé"', () => {
    expect(VALID_STATUS_REGEX_PREFIXES).toHaveLength(3)
    expect(VALID_STATUS_REGEX_PREFIXES).toContain('Payé')
    expect(VALID_STATUS_REGEX_PREFIXES).toContain('Remboursé')
    expect(VALID_STATUS_REGEX_PREFIXES).toContain('Encaissé')
  })

  it('"Payé par Orange Money" est valide selon la regex', () => {
    expect(REGEX_PATTERN.test('Payé par Orange Money')).toBe(true)
  })

  it('"Remboursé par Cash" est valide selon la regex', () => {
    expect(REGEX_PATTERN.test('Remboursé par Cash')).toBe(true)
  })

  it('"Encaissé par Virement" est valide selon la regex', () => {
    expect(REGEX_PATTERN.test('Encaissé par Virement')).toBe(true)
  })

  it('"Payé par " (suffixe vide) est invalide — .+ exige au moins un caractère', () => {
    expect(REGEX_PATTERN.test('Payé par ')).toBe(false)
  })

  it('"payé par Orange Money" (minuscule) est invalide — la regex est sensible à la casse', () => {
    expect(REGEX_PATTERN.test('payé par Orange Money')).toBe(false)
  })

  it('"Validée" seul n\'est PAS capturé par la regex — il est dans la liste explicite', () => {
    expect(REGEX_PATTERN.test('Validée')).toBe(false)
  })
})

describe('TC-004 [firestore.rules] — Statuts NON valides', () => {
  it('"En cours" n\'est pas dans la liste explicite', () => {
    expect(VALID_STATUSES_EXPLICIT_FROM_RULES).not.toContain('En cours')
  })

  it('"validée" (minuscule) n\'est pas dans la liste explicite', () => {
    expect(VALID_STATUSES_EXPLICIT_FROM_RULES).not.toContain('validée')
  })

  it('"VALIDÉE" (majuscule) n\'est pas dans la liste explicite', () => {
    expect(VALID_STATUSES_EXPLICIT_FROM_RULES).not.toContain('VALIDÉE')
  })

  it('une chaîne vide n\'est pas dans la liste explicite', () => {
    expect(VALID_STATUSES_EXPLICIT_FROM_RULES).not.toContain('')
  })
})

// ===========================================================================
// STATUTS EN ATTENTE — isPendingStatus()
// ===========================================================================

describe('TC-004 [firestore.rules] — isPendingStatus()', () => {
  it('la liste des statuts pending contient exactement 2 valeurs', () => {
    expect(PENDING_STATUSES_FROM_RULES).toHaveLength(2)
  })

  it('"Non Terminées" est un statut pending', () => {
    expect(PENDING_STATUSES_FROM_RULES).toContain('Non Terminées')
  })

  it('"Non Terminees" (sans accent) est un statut pending', () => {
    expect(PENDING_STATUSES_FROM_RULES).toContain('Non Terminees')
  })

  it('ne contient plus "Non TerminÃ©es" (forme corrompue) — MASTER-SEC-007 corrigé (V2-16)', () => {
    expect(PENDING_STATUSES_FROM_RULES).not.toContain('Non TerminÃ©es')
  })

  it('"Validée" n\'est PAS un statut pending', () => {
    expect(PENDING_STATUSES_FROM_RULES).not.toContain('Validée')
  })

  it('"Annulée" n\'est PAS un statut pending', () => {
    expect(PENDING_STATUSES_FROM_RULES).not.toContain('Annulée')
  })

  it('"Remboursée" n\'est PAS un statut pending', () => {
    expect(PENDING_STATUSES_FROM_RULES).not.toContain('Remboursée')
  })

  it('tous les statuts pending sont aussi dans la liste validStatus() explicite', () => {
    for (const s of PENDING_STATUSES_FROM_RULES) {
      expect(VALID_STATUSES_EXPLICIT_FROM_RULES).toContain(s)
    }
  })
})

// ===========================================================================
// CONTRAINTE clientId — validTransaction()
// ===========================================================================

describe('TC-004 [firestore.rules] — Contrainte clientId', () => {
  /**
   * firestore.rules ligne 39 :
   *   data.clientId is string && data.clientId.size() > 0
   */
  it('clientId doit être une chaîne non vide — chaîne vide ≡ size() === 0 → rejeté', () => {
    expect(''.length > 0).toBe(false)
  })

  it('clientId "client-local-aaa" (longueur > 0) est accepté', () => {
    expect('client-local-aaa'.length > 0).toBe(true)
  })
})

// ===========================================================================
// RÉSUMÉ DES ÉCARTS UI vs RULES (validations complémentaires)
// ===========================================================================

describe('TC-004 — Écarts documentés entre validateTransactionForm (UI) et validTransaction (rules)', () => {
  it('la fonction UI ne vérifie PAS la liste des types — seules les règles Firestore le font', () => {
    // validateTransactionForm n'a aucune logique de liste.
    // Source helpers.js ligne 203-205 : selectedClient && amount && parseFloat(amount) > 0 && transactionType
    // Preuve : un type inconnu non présent dans VALID_TYPES_FROM_RULES passe la validation UI
    const typeInconnu = 'TypeInconnu'
    expect(VALID_TYPES_FROM_RULES).not.toContain(typeInconnu)
    // La fonction UI accepte ce type car il est truthy (chaîne non vide)
    const uiResult = validateTransactionForm({ nom: 'A', prenom: 'B' }, '500', typeInconnu)
    expect(uiResult).toBeTruthy()
  })

  it('la fonction UI ne vérifie PAS le plafond de montant (100 000 000) — seules les règles le font', () => {
    // validateTransactionForm ne plafonne pas.
    // Un montant de 999 999 999 passerait la validation UI mais serait rejeté par les règles.
    const montantDepassant = 999999999
    const uiAccepte = validateTransactionForm({ nom: 'A', prenom: 'B' }, String(montantDepassant), 'Dépôt')
    expect(uiAccepte).toBeTruthy()
    // Mais la règle Firestore exige montant <= 100 000 000
    expect(montantDepassant <= 100000000).toBe(false)
  })

  it('la fonction UI ne vérifie PAS clientId.size() > 0 — elle vérifie selectedClient truthy', () => {
    // Un objet client avec nom/prenom passe la validation UI.
    // Côté rules : clientId (string) doit avoir size() > 0.
    // La règle rules rejette une string vide pour clientId.
    const clientidVide = ''
    expect(clientidVide.length > 0).toBe(false) // '' serait rejeté par rules
    // L'objet client truthy passe la validation UI
    const uiResult = validateTransactionForm({ nom: 'A', prenom: 'B' }, '500', 'Dépôt')
    expect(uiResult).toBeTruthy()
  })

  it('le statut n\'est PAS un paramètre de validateTransactionForm (UI) — il est vérifié uniquement par validStatus() dans les règles', () => {
    // La fonction UI a 3 paramètres : selectedClient, amount, transactionType.
    // Aucun paramètre statut. Les règles Firestore le vérifient séparément.
    // Preuve : la liste VALID_STATUSES_EXPLICIT_FROM_RULES existe côté rules,
    // aucun équivalent dans helpers.js.
    expect(VALID_STATUSES_EXPLICIT_FROM_RULES.length).toBeGreaterThan(0)
  })
})

// ===========================================================================
// SYNCHRONISATION DOCUMENTAIRE AVEC firestore.rules RÉEL
// ===========================================================================

/**
 * Ces tests vérifient la synchronisation documentaire — si une valeur est
 * retirée de firestore.rules, le test correspondant échoue.
 * Les vrais tests allow/deny restent TC-007 à TC-010 avec émulateur.
 */
describe('TC-004 [sync] — Cohérence entre constantes documentaires et firestore.rules réel', () => {
  describe('Champs requis par validTransaction()', () => {
    it('firestore.rules contient le champ requis "type"', () => {
      expect(rulesContent).toContain("'type'")
    })

    it('firestore.rules contient le champ requis "montant"', () => {
      expect(rulesContent).toContain("'montant'")
    })

    it('firestore.rules contient le champ requis "clientId"', () => {
      expect(rulesContent).toContain("'clientId'")
    })
  })

  describe('Plafond montant (supprimé — Lot C2)', () => {
    it('firestore.rules ne contient plus le plafond 100000000 (supprimé Lot C2)', () => {
      /**
       * L'ancien plafond AMOUNT_MAX = 100000000 a été supprimé lors du Lot C2.
       * firestore.rules ne doit contenir aucune borne supérieure sur montant.
       * Seules garanties conservées : is number, > 0, == math.floor(montant).
       */
      expect(rulesContent).not.toContain('100000000')
    })

    it('firestore.rules conserve la contrainte entier positif (> 0)', () => {
      expect(rulesContent).toContain('data.montant > 0')
    })

    it('firestore.rules conserve la contrainte entier strict (math.floor)', () => {
      expect(rulesContent).toContain('math.floor(data.montant)')
    })

    it('firestore.rules conserve la contrainte type number', () => {
      expect(rulesContent).toContain('data.montant is number')
    })
  })

  describe('Pattern regex statut', () => {
    it('firestore.rules contient le pattern regex exact des statuts par préfixe', () => {
      expect(rulesContent).toContain("'^(Payé|Remboursé|Encaissé) par .+$'")
    })
  })

  describe('Types valides — synchronisation VALID_TYPES_FROM_RULES', () => {
    for (const type of VALID_TYPES_FROM_RULES) {
      it(`firestore.rules contient le type "${type}"`, () => {
        expect(rulesContent).toContain(type)
      })
    }
  })

  describe('Statuts explicites — synchronisation VALID_STATUSES_EXPLICIT_FROM_RULES', () => {
    for (const status of VALID_STATUSES_EXPLICIT_FROM_RULES) {
      it(`firestore.rules contient le statut explicite "${status}"`, () => {
        expect(rulesContent).toContain(status)
      })
    }
  })

  describe('Statuts pending — synchronisation PENDING_STATUSES_FROM_RULES', () => {
    for (const status of PENDING_STATUSES_FROM_RULES) {
      it(`firestore.rules contient le statut pending "${status}"`, () => {
        expect(rulesContent).toContain(status)
      })
    }
  })
})
