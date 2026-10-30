import { repartirValeurAgent } from './agentFields.js'
import { NETWORK_OPTIONS } from './constants.js'
import { validateTransactionForm, validateTransactionAction } from './helpers.js'
import { parseFcfaAmount } from './fcfaAmount.js'

/**
 * La préparation d'une transaction client, hors de tout écran.
 *
 * POURQUOI CES RÈGLES ONT QUITTÉ LE FORMULAIRE
 * ────────────────────────────────────────────
 * L'assistant prépare des transactions que la caissière confirme. S'il avait
 * ses propres règles, elles finiraient par diverger de celles du formulaire :
 * il proposerait un retrait que le formulaire aurait refusé, ou l'inverse. Les
 * deux appellent donc ces fonctions, et rien d'autre.
 *
 * Rien ici ne lit ni n'écrit Firestore. Les soldes arrivent en paramètre
 * (`validateAmount`, `liquidite`), l'enregistrement reste à l'appelant.
 */

export const normaliserLibelle = (value) => String(value || '')
  .trim()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()

/** « Validée » part directement à l'historique ; le reste attend. */
export const estValidationDirecte = (statut) => normaliserLibelle(statut) === 'validee'

/**
 * Le client sur lequel porte la transaction : la fiche désignée, sinon le code
 * tapé, sans fiche.
 *
 * `orange` reste le COMPTE RÉSEAU : c'est lui que lit la validation réseau, et
 * lui qui devient le code écrit sur la transaction. Les deux champs d'identité
 * s'y ajoutent pour que l'écran nomme correctement ce qui vient d'être tapé,
 * sans rien changer au chemin financier.
 */
export function clientDeLaTransaction({ client, codeTape, reseau }) {
  if (client) return client
  const code = String(codeTape ?? '').trim()
  if (!code) return null
  return {
    id: `manual-${reseau}-${code}`,
    nom: 'Client',
    prenom: 'Non enregistré',
    orange: code,
    ...repartirValeurAgent(code),
    isManual: true,
  }
}

/** Les réseaux sur lesquels ce client a un compte. Un client non enregistré les a tous. */
export function reseauxDisponibles(client) {
  if (client?.isManual) return NETWORK_OPTIONS
  if (!client) return []
  return NETWORK_OPTIONS.filter((option) => client[option.toLowerCase()]?.trim())
}

function aUnCompteSur(client, reseau) {
  if (client?.isManual) return Boolean(client.orange?.trim())
  if (!client || !reseau) return false
  return Boolean(client[reseau.toLowerCase()]?.trim())
}

const toutBloque = (raison, networkValidation = { isValid: true, message: '' }) => ({
  isFormValid: false,
  stockValidation: { isValid: true, message: '' },
  networkValidation,
  actionStates: {
    canMarkAsNonTermine: false,
    canValidate: false,
    nonTermineeReason: raison,
    validateReason: raison,
  },
})

/**
 * Ce que le formulaire permet, et pourquoi il refuse le reste.
 *
 * @param {object} p
 * @param {object|null} p.client          `clientDeLaTransaction(...)`
 * @param {object[]} [p.ambigus]          les fiches entre lesquelles un numéro tapé hésite
 * @param {string} p.montant              la saisie brute
 * @param {string} p.type                 Dépôt, Retrait, Crédit
 * @param {string} p.reseau
 * @param {Function} p.validateAmount     le contrôle de stock (`useSimpleNetworkData`)
 * @param {number} p.liquidite            les espèces disponibles
 */
export function evaluerTransaction({ client, ambigus, montant, type, reseau, validateAmount, liquidite }) {
  if (ambigus?.length) {
    const raison = `Plusieurs clients portent ce numéro (${ambigus.length}) : choisissez le bon dans la liste.`
    return toutBloque(raison, { isValid: false, message: raison })
  }

  if (!client || !montant || !type || !reseau) {
    return toutBloque('Veuillez remplir tous les champs requis')
  }

  const isNetworkValid = aUnCompteSur(client, reseau)
  const availableNetworks = reseauxDisponibles(client)

  const networkValidation = {
    isValid: isNetworkValid,
    message: isNetworkValid ? '' :
      availableNetworks.length > 0
        ? `Ce client n'a pas de code ${reseau}. Réseaux disponibles: ${availableNetworks.join(', ')}`
        : `Ce client n'a aucun code réseau configuré. Veuillez d'abord configurer au moins un réseau.`,
  }

  const stockValidation = validateAmount(reseau, montant, type)
  const basicFormValid = validateTransactionForm(client, montant, type)
  const amountValue = parseFcfaAmount(montant) || 0
  // Le stock se contrôle au dépôt, les espèces au retrait : un retrait au-delà
  // de la caisse peut attendre, il ne peut pas se valider.
  const isWithdrawal = normaliserLibelle(type) === 'retrait'
  const directValidation = {
    isValid: !isWithdrawal || amountValue <= liquidite,
    reason: isWithdrawal && amountValue > liquidite
      ? `Liquidité insuffisante. Disponible: ${liquidite.toLocaleString('fr-FR')} FCFA`
      : '',
  }

  const hasStock = stockValidation.isValid && isNetworkValid
  const context = { hasStock, amount: amountValue }

  const nonTermineeValidation = validateTransactionAction(type, 'nonTerminee', context)
  const validateValidation = validateTransactionAction(type, 'valider', context)

  // Le réseau manquant prime : c'est lui qu'il faut corriger d'abord.
  const adaptReason = (originalReason) => (isNetworkValid ? originalReason : networkValidation.message)

  return {
    isFormValid: basicFormValid && stockValidation.isValid && networkValidation.isValid,
    stockValidation,
    networkValidation,
    actionStates: {
      canMarkAsNonTermine: nonTermineeValidation.allowed && networkValidation.isValid,
      canValidate: validateValidation.allowed && networkValidation.isValid && directValidation.isValid,
      nonTermineeReason: adaptReason(nonTermineeValidation.reason || ''),
      validateReason: adaptReason(directValidation.reason || validateValidation.reason || ''),
    },
  }
}

/**
 * L'opération exacte à enregistrer, et ce que la confirmation en affiche — ou
 * la raison du refus.
 *
 * @returns {{ok: true, transactionData: object, details: object} | {ok: false, raison: string}}
 */
export function preparerTransaction({ client, reseau, montant, type, statut }) {
  if (!client) {
    return { ok: false, raison: 'Veuillez sélectionner un client ou saisir un numéro/code agent' }
  }

  const code = client[String(reseau).toLowerCase()]?.trim()
  if (!code) {
    return { ok: false, raison: `${client.nom} ${client.prenom} n'a pas de code ${reseau}` }
  }

  const valeur = parseFcfaAmount(montant)
  if (valeur === null) {
    return { ok: false, raison: 'Le montant doit être un entier strictement positif en FCFA' }
  }

  return {
    ok: true,
    transactionData: {
      client,
      clientId: client.id,
      type,
      reseau,
      code,
      montant: valeur,
      statut,
    },
    details: {
      clientName: `${client.prenom || ''} ${client.nom || ''}`.trim(),
      type,
      amount: valeur.toLocaleString('fr-FR'),
      network: reseau,
      statut,
    },
  }
}
