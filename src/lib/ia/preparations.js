/**
 * preparations.js — l'assistant PRÉPARE une opération, la caissière la confirme.
 *
 * ⚠ RIEN ICI N'ENREGISTRE. Une préparation rend une CARTE : ce qui partira, dit
 *   dans les mots de l'écran, et la commande exacte que le composant exécutera
 *   si, et seulement si, la caissière appuie sur « Confirmer ». Le modèle reçoit
 *   « présentée, rien n'est enregistré » : il ne peut pas annoncer un
 *   enregistrement qui n'a pas eu lieu (INTERDITS, prompt.js).
 *
 * LES RÈGLES SONT CELLES DES ÉCRANS, PAS UNE COPIE
 * ────────────────────────────────────────────────
 * Chaque préparation passe par les fonctions qu'emploient les formulaires :
 * preparationTransaction.js, reglement.js, ravitaillement.js. L'assistant ne
 * peut donc pas proposer ce que l'écran aurait refusé, ni refuser ce qu'il
 * aurait permis. Le serveur reste le dernier garant.
 *
 * PUR : l'état de la boutique arrive en paramètre (`etat`), lu par le composant
 * dans les mêmes contextes que les écrans. Aucun React, aucun Firebase.
 *
 * ⚠ CE QUE LE SERVEUR REFUSERAIT, L'ASSISTANT LE REFUSE AVANT. Les écrans
 *   laissent certains refus au serveur (la réserve d'un règlement, l'annulation
 *   d'une ligne entamée) ; une carte, elle, se lit comme une promesse. Une
 *   carte qui échoue après « Confirmer » est le pire des deux mondes : la
 *   caissière a vérifié pour rien, et ne sait pas pourquoi. Ces refus-là se
 *   jugent donc ici, sur les soldes de l'écran (`etat.soldes`), avec les
 *   fonctions du serveur (reglement.js), et disent ce qui reste possible.
 *
 * Trois réponses, jamais confondues :
 *   - `presentee`  : une carte est affichée, en attente de confirmation ;
 *   - `a_preciser` : il manque un choix (deux clients, deux opérations…) ;
 *   - `erreur`     : l'opération ne peut pas se faire, et la raison est dite.
 */

import { NETWORK_OPTIONS, TRANSACTION_TYPES, PAYMENT_METHODS } from '../../utils/constants.js'
import { getClientName } from '../../utils/helpers.js'
import { formatCurrency } from '../../utils/formatCurrency.js'
import {
  chercherClients,
  chiffresSeuls,
  motsDuTerme,
  plierTexte,
  reconnaitreClient,
} from '../../utils/rechercheClients.js'
import {
  evaluerTransaction,
  estValidationDirecte,
  normaliserLibelle,
  preparerTransaction,
  reseauxDisponibles,
} from '../../utils/preparationTransaction.js'
import {
  actionDeReglement,
  MONTANT_MINIMUM_REGLEMENT,
  montantProposeDuReglement,
  reserveDuMoyen,
  verifierAnnulation,
  verifierMontantReglement,
  verifierReserveDuReglement,
} from '../../utils/reglement.js'
import { libelleVase, preparerRavitaillement, preparerRetour } from '../../utils/ravitaillement.js'

const CHOIX_MAX = 5
const NATURES = Object.freeze(TRANSACTION_TYPES.map((t) => t.value))
const STATUTS = Object.freeze(['Non Terminées', 'Validée'])
const RESERVES = Object.freeze(['Stock', 'Espèce'])

const GESTE_LISIBLE = Object.freeze({
  encaisser: 'Encaisser',
  payerPar: 'Payer par',
  rembourser: 'Rembourser',
})

/** Le geste dans une phrase : on « paie ce retrait », pas « payer par ce retrait ». */
const VERBE_DU_GESTE = Object.freeze({
  encaisser: 'Encaisser',
  payerPar: 'Payer',
  rembourser: 'Rembourser',
})

/** La phrase qui sert d'alibi à l'annulation : celle du dialogue du tableau. */
const EFFET_ANNULATION =
  'Le stock engagé sera rendu et la ligne ira dans la corbeille, où elle restera lisible. ' +
  'Elle ne pourra pas être restaurée.'

// ─────────────────────────────────────────────────────────────────────────────
// Déclarations lues par le modèle
// ─────────────────────────────────────────────────────────────────────────────

const PARAM_CLIENT = Object.freeze({ type: 'STRING', description: 'Nom, code agent ou numéro du client' })
const PARAM_OPERATION = Object.freeze({
  type: 'INTEGER',
  description: "Le numéro de l'opération, seulement après que je t'ai rendu une liste à choisir",
})
const PARAM_RESERVE = Object.freeze({
  type: 'STRING',
  enum: [...RESERVES],
  description: 'Stock (électronique) ou Espèce (liquide)',
})

export const DECLARATIONS_DE_PREPARATION = Object.freeze([
  {
    name: 'preparer_transaction',
    description:
      "PRÉPARE une transaction client. Une carte s'affiche, la caissière confirme : tu n'enregistres rien. " +
      'À employer quand on te demande de FAIRE une opération : « fais un dépôt à distance de 50 000 pour ' +
      'Salif », « retrait de 20 000 pour le 4544102, c\'est validé ». Statut : « Non Terminées » pour un ' +
      'dépôt à distance, un dépôt ou un retrait non terminé, « il paiera plus tard » ; « Validée » quand ' +
      "l'argent a déjà changé de main (« c'est réglé », « il a payé », « valide »). Si rien ne le dit, demande.",
    parameters: {
      type: 'OBJECT',
      properties: {
        client: PARAM_CLIENT,
        type: { type: 'STRING', enum: [...NATURES] },
        montant: { type: 'INTEGER', description: 'En FCFA' },
        statut: { type: 'STRING', enum: [...STATUTS] },
      },
      required: ['client', 'type', 'montant', 'statut'],
    },
  },
  {
    name: 'preparer_reglement',
    description:
      "PRÉPARE le règlement d'une opération NON TERMINÉE : « Encaisser » un dépôt, « Payer par » un " +
      'retrait, « Rembourser » un crédit. Une carte s\'affiche, la caissière confirme. Sans montant, le ' +
      `reste dû entier. Moyens : ${PAYMENT_METHODS.join(', ')} ; si la personne ne le dit pas, demande.`,
    parameters: {
      type: 'OBJECT',
      properties: {
        client: PARAM_CLIENT,
        type: { type: 'STRING', enum: [...NATURES], description: "La nature de l'opération à régler, si la personne la dit" },
        moyen: { type: 'STRING', enum: [...PAYMENT_METHODS] },
        montant: { type: 'INTEGER', description: 'En FCFA, seulement pour un règlement partiel' },
        code_agent: {
          type: 'STRING',
          description: "Seulement si l'argent part sur un compte agent et que la personne en donne le code",
        },
        operation: PARAM_OPERATION,
      },
      required: ['client'],
    },
  },
  {
    name: 'preparer_annulation',
    description:
      "PRÉPARE l'annulation d'une opération NON TERMINÉE (le bouton « Annuler » de la liste). La " +
      "caissière confirme sur une carte. Une opération validée ne s'annule pas ici.",
    parameters: {
      type: 'OBJECT',
      properties: {
        client: PARAM_CLIENT,
        type: { type: 'STRING', enum: [...NATURES] },
        operation: PARAM_OPERATION,
      },
      required: ['client'],
    },
  },
  {
    name: 'preparer_ravitaillement',
    description:
      'PRÉPARE un ravitaillement : du stock reçu de quelqu\'un qu\'il faudra rembourser le soir. ' +
      "Toujours du stock, jamais d'espèces. La caissière confirme sur une carte. Demande de qui il vient si ce n'est pas dit.",
    parameters: {
      type: 'OBJECT',
      properties: {
        expediteur: { type: 'STRING', description: "La personne qui a envoyé le stock" },
        montant: { type: 'INTEGER', description: 'En FCFA' },
        note: { type: 'STRING', description: 'Facultative' },
      },
      required: ['expediteur', 'montant'],
    },
  },
  {
    name: 'preparer_retour',
    description:
      'PRÉPARE un « Retour » : rendre à un expéditeur ce qu\'il a envoyé en ravitaillement, depuis le ' +
      'stock ou les espèces. La caissière confirme sur une carte. Sans réserve dite, celle qui a été reçue.',
    parameters: {
      type: 'OBJECT',
      properties: {
        expediteur: { type: 'STRING', description: 'La personne à qui on rend' },
        montant: { type: 'INTEGER', description: 'En FCFA' },
        reserve: PARAM_RESERVE,
        livraison: {
          type: 'INTEGER',
          description: "Le numéro de la livraison, seulement après que je t'ai rendu une liste à choisir",
        },
      },
      required: ['expediteur', 'montant'],
    },
  },
])

export const OUTILS_DE_PREPARATION = Object.freeze(DECLARATIONS_DE_PREPARATION.map((d) => d.name))

// ─────────────────────────────────────────────────────────────────────────────
// Les trois réponses
// ─────────────────────────────────────────────────────────────────────────────

const CONSIGNE_CARTE =
  "La carte est affichée sous ta réponse. La personne vérifie, puis appuie sur « Confirmer » : rien n'est " +
  "enregistré avant. Dis-le en une phrase, sans recopier le détail et sans dire que c'est fait."

function presenter(carte) {
  return { carte, reponse: { presentee: true, resume: carte.resume, consigne: CONSIGNE_CARTE } }
}

const refuser = (message) => ({ reponse: { erreur: true, message } })
const demander = (message, choix) => ({ reponse: { a_preciser: true, message, choix } })

// ─────────────────────────────────────────────────────────────────────────────
// Retrouver le client, l'opération, la livraison
// ─────────────────────────────────────────────────────────────────────────────

const identifiantDe = (client) =>
  client?.codeAgent || client?.numeroAgent || client?.orange || client?.numeroPersonnel || ''

const nomDe = (client) => getClientName(client) || 'Client sans nom'

function decrireClient(client) {
  const code = identifiantDe(client)
  return code ? { nom: nomDe(client), code: String(code) } : { nom: nomDe(client) }
}

const estNumerique = (terme) => {
  const tape = String(terme ?? '').replace(/\s/g, '')
  return tape.length > 0 && chiffresSeuls(tape).length === tape.length
}

/**
 * Le client que désigne ce qui a été dit : un code ou un numéro EN ENTIER, ou
 * un nom. LE CODE D'ABORD, LE NUMÉRO À DÉFAUT — la règle du formulaire
 * (`reconnaitreClient`). Un nom passe par la recherche de l'écran ; parmi
 * plusieurs fiches, celle qui porte exactement ces mots l'emporte.
 *
 * @returns {{client: object} | {ambigus: object[], total: number} | {refus: string}}
 */
export function trouverClient(clients = [], recherche = '') {
  const terme = String(recherche ?? '').trim()
  if (terme.length < 2) return { refus: 'Dites-moi le nom, le code agent ou le numéro du client.' }

  const reconnu = reconnaitreClient(clients, terme)
  if (reconnu?.client) return { client: reconnu.client }
  if (reconnu?.ambigus) return { ambigus: reconnu.ambigus, total: reconnu.ambigus.length }

  if (estNumerique(terme)) {
    return {
      refus:
        `Aucun client n'a le code ou le numéro ${terme}. S'il est nouveau, il s'enregistre depuis le ` +
        'formulaire de transaction, avec « + Enregistrer ce client ».',
    }
  }

  const { resultats, total } = chercherClients(clients, terme)
  if (total === 0) {
    return {
      refus:
        `Aucun client ne correspond à « ${terme} ». S'il est nouveau, il s'enregistre depuis le ` +
        'formulaire de transaction, avec « + Enregistrer ce client ».',
    }
  }
  if (total === 1) return { client: resultats[0] }

  const mots = motsDuTerme(terme)
  const exacts = resultats.filter((client) => {
    const nom = motsDuTerme(`${client?.prenom ?? ''} ${client?.nom ?? ''}`)
    return nom.length === mots.length && mots.every((mot) => nom.includes(mot))
  })
  if (exacts.length === 1) return { client: exacts[0] }
  return { ambigus: resultats, total }
}

function demanderLeClient(ambigus, total) {
  return demander(
    `Plusieurs clients correspondent (${total}) : lequel ? Redonne-moi son code agent.`,
    ambigus.slice(0, CHOIX_MAX).map(decrireClient),
  )
}

/** La ligne non terminée vue comme une fiche, pour la même recherche que l'écran. */
function ficheDeLaLigne(ligne) {
  const client = ligne?.client && typeof ligne.client === 'object' ? ligne.client : { nom: String(ligne?.client ?? '') }
  return {
    nom: client.nom,
    prenom: client.prenom,
    codeAgent: client.codeAgent,
    numeroAgent: client.numeroAgent,
    numeroPersonnel: client.numeroPersonnel,
    orange: client.orange || ligne?.code,
  }
}

const instant = (ligne) => {
  const brut = ligne?.createdAt
  if (typeof brut?.toMillis === 'function') return brut.toMillis()
  const date = brut instanceof Date ? brut : new Date(brut ?? 0)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function decrireLigne(ligne, numero) {
  return {
    numero,
    client: nomDe(ligne.client),
    type: ligne.type,
    montant: formatCurrency(ligne.montant),
    ...(ligne.remainingAmount != null && ligne.remainingAmount !== ligne.montant
      ? { reste_du: formatCurrency(ligne.remainingAmount) }
      : {}),
    ...(ligne.date ? { date: ligne.date } : {}),
  }
}

/**
 * L'opération non terminée que désigne ce qui a été dit.
 *
 * Un client peut en avoir plusieurs en attente, et c'est normal : il faut
 * alors choisir, jamais deviner. La liste se numérote de la plus ancienne à la
 * plus récente — l'ordre du chrono — pour que le numéro choisi désigne encore
 * la même ligne au tour suivant.
 *
 * @returns {{ligne: object} | {reponse: object}}
 */
export function trouverOperationEnAttente(enAttente = [], { client, type, operation } = {}) {
  const terme = String(client ?? '').trim()
  if (terme.length < 2) return refuser("Dites-moi le nom ou le code du client de l'opération.")

  const vues = new Set()
  const lignes = (Array.isArray(enAttente) ? enAttente : [])
    .filter((ligne) => ligne?.id && !ligne.deletedAt && !vues.has(ligne.id) && vues.add(ligne.id))
    .sort((a, b) => instant(a) - instant(b))

  let duClient
  if (estNumerique(terme)) {
    const chiffres = chiffresSeuls(terme)
    duClient = lignes.filter((ligne) => {
      const fiche = ficheDeLaLigne(ligne)
      return [fiche.codeAgent, fiche.numeroAgent, fiche.orange, fiche.numeroPersonnel]
        .map(chiffresSeuls)
        .includes(chiffres)
    })
  } else {
    // Les MÊMES objets des deux côtés : la recherche rend les fiches qu'on lui
    // a passées, et c'est par elles qu'on retrouve leurs lignes.
    const fiches = lignes.map(ficheDeLaLigne)
    const trouvees = new Set(chercherClients(fiches, terme).resultats)
    duClient = lignes.filter((_, i) => trouvees.has(fiches[i]))
  }

  const nature = type ? NATURES.find((n) => normaliserLibelle(n) === normaliserLibelle(type)) : null
  const candidates = nature ? duClient.filter((ligne) => normaliserLibelle(ligne.type) === normaliserLibelle(nature)) : duClient

  if (candidates.length === 0) {
    return refuser(
      nature
        ? `Aucun ${nature.toLowerCase()} non terminé pour « ${terme} ».`
        : `Aucune opération non terminée pour « ${terme} ».`,
    )
  }

  if (operation !== undefined && operation !== null) {
    const choisie = candidates[Number(operation) - 1]
    if (!choisie) return refuser(`Il n'y a pas d'opération ${operation} dans la liste.`)
    return { ligne: choisie }
  }

  if (candidates.length === 1) return { ligne: candidates[0] }
  return demander(
    `${candidates.length} opérations non terminées correspondent : laquelle ?`,
    candidates.slice(0, CHOIX_MAX).map((ligne, i) => decrireLigne(ligne, i + 1)),
  )
}

const plier = (texte) => plierTexte(texte).trim()

/**
 * Le nom connu que désigne ce qui a été dit, ou le nom tel quel s'il est
 * nouveau. Pas de rapprochement approximatif : « Mme S. » et « Mme Sawadogo »
 * deviendraient la même créancière sur une supposition. Un nom dont tous les
 * mots appartiennent à UN SEUL nom connu (« Sawadogo ») le désigne.
 */
export function resoudreExpediteur(connus = [], dit = '') {
  const nom = String(dit ?? '').trim()
  const exact = connus.find((connu) => plier(connu) === plier(nom))
  if (exact) return { nom: exact, nouveau: false }
  const mots = motsDuTerme(nom)
  const contenants = connus.filter((connu) => {
    const siens = motsDuTerme(connu)
    return mots.length > 0 && mots.every((mot) => siens.includes(mot))
  })
  if (contenants.length === 1) return { nom: contenants[0], nouveau: false }
  return { nom, nouveau: true }
}

/** « Espèce », « espèces », « cash », « liquide » → liquidite ; « stock » → stock. */
function lireVase(dit) {
  const mot = plier(dit)
  if (!mot) return null
  if (mot.startsWith('stock') || mot.startsWith('electron') || mot.startsWith('uv')) return 'stock'
  if (mot.startsWith('espece') || mot.startsWith('liquid') || mot === 'cash') return 'liquidite'
  return null
}

/** « om », « orange » → Orange Money ; « espèce » → Cash — seulement si le profil les a. */
function lireMoyen(dit) {
  const mot = plier(dit)
  if (!mot) return null
  const exact = PAYMENT_METHODS.find((m) => plier(m) === mot)
  if (exact) return exact
  const alias = mot === 'om' || mot.startsWith('orange') ? 'orange money'
    : mot.startsWith('espece') || mot.startsWith('liquid') ? 'cash'
      : null
  return PAYMENT_METHODS.find((m) => plier(m) === alias) ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// Les cinq préparations
// ─────────────────────────────────────────────────────────────────────────────

/** L'opération visée, et sa date sur sa propre ligne : collée au montant, elle se coupait à 390 px. */
const lignesDeLOperation = (ligne) => [
  { libelle: 'Opération', valeur: `${ligne.type} de ${formatCurrency(ligne.montant)}` },
  ...(ligne.date ? [{ libelle: 'Saisie le', valeur: String(ligne.date) }] : []),
]

function ligneClient(client) {
  const code = identifiantDe(client)
  return { libelle: 'Client', valeur: code ? `${nomDe(client)} · ${code}` : nomDe(client) }
}

function preparerTransactionClient({ client: recherche, type, montant, statut } = {}, etat) {
  const nature = NATURES.find((n) => normaliserLibelle(n) === normaliserLibelle(type))
  if (!nature) return demander(`Quelle opération : ${NATURES.join(' ou ')} ?`, [...NATURES])

  const direct = estValidationDirecte(statut)
  if (!direct && !normaliserLibelle(statut).startsWith('non termin')) {
    return demander(
      "Validée tout de suite, ou non terminée (l'argent n'a pas encore changé de main) ?",
      [...STATUTS],
    )
  }
  const statutVoulu = direct ? 'Validée' : 'Non Terminées'

  const trouve = trouverClient(etat.clients, recherche)
  if (trouve.refus) return refuser(trouve.refus)
  if (trouve.ambigus) return demanderLeClient(trouve.ambigus, trouve.total)
  const fiche = trouve.client

  // Le réseau que le formulaire choisirait : le premier sur lequel la fiche a un compte.
  const reseau = reseauxDisponibles(fiche)[0] ?? NETWORK_OPTIONS[0]
  const saisie = montant === undefined || montant === null ? '' : String(montant)

  const decision = evaluerTransaction({
    client: fiche,
    montant: saisie,
    type: nature,
    reseau,
    validateAmount: etat.validateAmount,
    liquidite: etat.liquidite,
  })
  const raisonDuBouton = direct ? decision.actionStates.validateReason : decision.actionStates.nonTermineeReason
  if (!decision.isFormValid) {
    // Un dépôt envoie du stock : sans stock, rien ne part, validé ou non.
    const sansStock = decision.networkValidation.isValid && !decision.stockValidation.isValid
    return refuser(
      sansStock
        ? `${decision.stockValidation.message}. Le dépôt envoie ce stock au client : il faut d'abord en recevoir, par un ravitaillement.`
        : decision.stockValidation.message || decision.networkValidation.message || raisonDuBouton ||
          'Le montant doit être un entier strictement positif en FCFA',
    )
  }
  if (direct ? !decision.actionStates.canValidate : !decision.actionStates.canMarkAsNonTermine) {
    // Un retrait que la caisse ne peut pas payer tout de suite peut attendre.
    const peutAttendre = direct && normaliserLibelle(nature) === 'retrait' && decision.actionStates.canMarkAsNonTermine
    return refuser(
      peutAttendre
        ? `${raisonDuBouton}. Le retrait peut être enregistré « Non Terminées », puis payé quand la caisse le permettra.`
        : raisonDuBouton,
    )
  }

  const preparation = preparerTransaction({ client: fiche, reseau, montant: saisie, type: nature, statut: statutVoulu })
  if (!preparation.ok) return refuser(preparation.raison)

  const { montant: valeur } = preparation.transactionData
  const titre = `${nature} ${direct ? 'validé' : 'non terminé'}`
  return presenter({
    genre: 'transaction',
    titre,
    lignes: [
      ligneClient(fiche),
      { libelle: 'Montant', valeur: formatCurrency(valeur) },
      ...(NETWORK_OPTIONS.length > 1 ? [{ libelle: 'Réseau', valeur: reseau }] : []),
      {
        libelle: 'Statut',
        valeur: direct ? 'Validée : part dans l’historique' : 'Non terminée : attend dans la liste',
      },
    ],
    execution: { genre: 'transaction', transactionData: preparation.transactionData },
    resume: `${titre} de ${formatCurrency(valeur)} pour ${nomDe(fiche)}`,
    succes: `${titre} enregistré : ${formatCurrency(valeur)} pour ${nomDe(fiche)}.`,
  })
}

function preparerReglement({ client, type, moyen, montant, code_agent: codeAgent, operation } = {}, etat) {
  const trouvee = trouverOperationEnAttente(etat.enAttente, { client, type, operation })
  if (!trouvee.ligne) return trouvee
  const ligne = trouvee.ligne

  const action = actionDeReglement(ligne.type)
  if (!action) return refuser(`Un ${String(ligne.type).toLowerCase()} ne se règle pas depuis la liste.`)

  const moyenRetenu = lireMoyen(moyen)
  if (!moyenRetenu) {
    return demander(`« ${GESTE_LISIBLE[action]} » par quel moyen : ${PAYMENT_METHODS.join(' ou ')} ?`, [...PAYMENT_METHODS])
  }

  const voulu = montant === undefined || montant === null ? montantProposeDuReglement(ligne) : montant
  const verification = verifierMontantReglement({ transaction: ligne, action, montant: voulu })
  if (!verification.ok) return refuser(verification.raison)
  const valeur = verification.valeur

  if (etat.soldes) {
    const reserve = verifierReserveDuReglement({ transaction: ligne, action, moyen: moyenRetenu, montant: valeur, soldes: etat.soldes })
    if (!reserve.ok) return refuser(expliquerLeManque({ ligne, action, moyen: moyenRetenu, montant: valeur, soldes: etat.soldes, raison: reserve.raison }))
  }

  const code = String(codeAgent ?? '').trim() || undefined
  const reste = action === 'rembourser' ? null : montantProposeDuReglement(ligne) - valeur
  const titre = `${GESTE_LISIBLE[action]} — ${moyenRetenu}`
  return presenter({
    genre: 'reglement',
    titre,
    lignes: [
      ligneClient(ligne.client),
      ...lignesDeLOperation(ligne),
      { libelle: action === 'rembourser' ? 'Remboursé' : 'Réglé', valeur: formatCurrency(valeur) },
      ...(reste !== null ? [{ libelle: 'Reste dû après', valeur: formatCurrency(reste) }] : []),
      ...(code ? [{ libelle: 'Code agent', valeur: code }] : []),
    ],
    execution: { genre: 'reglement', action, draftId: ligne.id, montant: valeur, moyen: moyenRetenu, codeAgent: code },
    resume: `${GESTE_LISIBLE[action]} ${formatCurrency(valeur)} en ${moyenRetenu} pour ${nomDe(ligne.client)}`,
    succes: `Règlement enregistré : ${formatCurrency(valeur)} en ${moyenRetenu} pour ${nomDe(ligne.client)}.`,
  })
}

/**
 * Le refus d'un règlement que la réserve ne couvre pas, et ce qui reste
 * possible : un autre moyen qui passe, une partie de ce qu'il y a, ou attendre.
 * Le modèle répète ce message ; c'est ce qui lui permet de proposer la suite
 * au lieu d'un simple « non ».
 */
function expliquerLeManque({ ligne, action, moyen, montant, soldes, raison }) {
  const nature = String(ligne.type).toLowerCase()
  const phrases = [`${VERBE_DU_GESTE[action]} ce ${nature} en ${moyen} est impossible. ${raison}`]

  const autres = PAYMENT_METHODS
    .filter((m) => m !== moyen)
    .filter((m) => verifierReserveDuReglement({ transaction: ligne, action, moyen: m, montant, soldes }).ok)
    .map((m) => `${m} (${reserveDuMoyen(m, soldes).nom} : ${formatCurrency(reserveDuMoyen(m, soldes).disponible)})`)
  if (autres.length) phrases.push(`C'est possible par ${autres.join(' ou par ')}.`)

  const disponible = reserveDuMoyen(moyen, soldes).disponible
  if (disponible >= MONTANT_MINIMUM_REGLEMENT) {
    phrases.push(`Un règlement partiel de ${formatCurrency(disponible)} au plus est possible en ${moyen}.`)
  }
  phrases.push(`Sinon, le ${nature} reste dans les non terminées jusqu'à ce que la caisse le permette.`)
  return phrases.join(' ')
}

function preparerAnnulation({ client, type, operation } = {}, etat) {
  const trouvee = trouverOperationEnAttente(etat.enAttente, { client, type, operation })
  if (!trouvee.ligne) return trouvee
  const ligne = trouvee.ligne

  const annulable = verifierAnnulation({ transaction: ligne, soldes: etat.soldes })
  if (!annulable.ok) return refuser(annulable.raison)

  return presenter({
    genre: 'annulation',
    titre: 'Annuler cette transaction',
    lignes: [
      ligneClient(ligne.client),
      ...lignesDeLOperation(ligne),
    ],
    avertissement: EFFET_ANNULATION,
    danger: true,
    execution: { genre: 'corbeille', id: ligne.id },
    resume: `Annulation du ${String(ligne.type).toLowerCase()} de ${formatCurrency(ligne.montant)} de ${nomDe(ligne.client)}`,
    succes: `Transaction annulée : ${String(ligne.type).toLowerCase()} de ${formatCurrency(ligne.montant)} pour ${nomDe(ligne.client)}.`,
  })
}

// Toujours du stock (`VASE_RAVITAILLEMENT`) : une réserve dite par le modèle
// est ignorée, et on ne la demande plus.
function preparerRavitaillementDit({ expediteur, montant, note } = {}, etat) {
  const connus = Array.isArray(etat.expediteurs) ? etat.expediteurs : []
  if (!String(expediteur ?? '').trim()) {
    return demander(`De qui vient ce ravitaillement ?${connus.length ? ` (${connus.join(', ')})` : ''}`, [...connus])
  }

  const { nom, nouveau } = resoudreExpediteur(connus, expediteur)
  const preparation = preparerRavitaillement({
    montant: montant === undefined || montant === null ? '' : String(montant),
    expediteur: nom,
    note,
  })
  if (!preparation.ok) return refuser(preparation.raison)

  const { commande, valeur } = preparation
  return presenter({
    genre: 'ravitaillement',
    titre: 'Ravitaillement',
    lignes: [
      { libelle: 'Reçu de', valeur: commande.expediteur },
      { libelle: 'Montant', valeur: formatCurrency(valeur) },
      { libelle: 'Réserve', valeur: libelleVase(commande.balanceType) },
      ...(commande.note ? [{ libelle: 'Note', valeur: commande.note }] : []),
    ],
    ...(nouveau ? { avertissement: `« ${commande.expediteur} » n'a encore rien envoyé : ce nom s'ajoutera à la liste.` } : {}),
    execution: { genre: 'commande', commande },
    resume: `Ravitaillement de ${formatCurrency(valeur)} en stock, reçu de ${commande.expediteur}`,
    succes: `Ravitaillement enregistré : ${formatCurrency(valeur)} en stock.`,
  })
}

function preparerRetourDit({ expediteur, montant, reserve, livraison } = {}, etat) {
  const dues = Array.isArray(etat.ravitaillements) ? etat.ravitaillements : []
  const noms = [...new Set(dues.map((l) => l.expediteur).filter(Boolean))]
  if (dues.length === 0) return refuser("Aucun ravitaillement n'est à rendre.")
  if (!String(expediteur ?? '').trim()) return demander('À qui rendez-vous ?', noms)

  const { nom } = resoudreExpediteur(noms, expediteur)
  const siennes = dues.filter((l) => plier(l.expediteur) === plier(nom))
  if (siennes.length === 0) {
    return refuser(`Rien n'est dû à « ${String(expediteur).trim()} ». Il reste à rendre à : ${noms.join(', ')}.`)
  }

  let choisie = siennes.length === 1 ? siennes[0] : null
  if (livraison !== undefined && livraison !== null) {
    choisie = siennes[Number(livraison) - 1]
    if (!choisie) return refuser(`Il n'y a pas de livraison ${livraison} dans la liste.`)
  }
  if (!choisie) {
    return demander(
      `${siennes.length} livraisons de ${nom} restent dues : laquelle ?`,
      siennes.slice(0, CHOIX_MAX).map((l, i) => ({
        numero: i + 1,
        recu: `${formatCurrency(l.montant)} en ${libelleVase(l.balanceType).toLowerCase()}`,
        reste_du: formatCurrency(l.remainingAmount),
        ...(l.date ? { date: l.date } : {}),
      })),
    )
  }

  const vase = lireVase(reserve) ?? choisie.balanceType ?? 'stock'
  const disponible = Number(etat.disponible?.(vase)) || 0
  const preparation = preparerRetour({
    ravitaillement: choisie,
    montant: montant === undefined || montant === null ? '' : String(montant),
    vase,
    disponible,
  })
  if (!preparation.ok) return refuser(preparation.raison)

  const { commande, valeur } = preparation
  return presenter({
    genre: 'retour',
    titre: 'Retour',
    lignes: [
      { libelle: 'Rendu à', valeur: choisie.expediteur },
      { libelle: 'Montant', valeur: formatCurrency(valeur) },
      { libelle: 'Depuis', valeur: libelleVase(vase) },
      { libelle: 'Reste dû après', valeur: formatCurrency((Number(choisie.remainingAmount) || 0) - valeur) },
    ],
    execution: { genre: 'commande', commande },
    resume: `Retour de ${formatCurrency(valeur)} à ${choisie.expediteur}, depuis ${libelleVase(vase).toLowerCase()}`,
    succes: `Retour enregistré : ${formatCurrency(valeur)} en ${libelleVase(vase).toLowerCase()}.`,
  })
}

const PREPARATEURS = Object.freeze({
  preparer_transaction: preparerTransactionClient,
  preparer_reglement: preparerReglement,
  preparer_annulation: preparerAnnulation,
  preparer_ravitaillement: preparerRavitaillementDit,
  preparer_retour: preparerRetourDit,
})

/**
 * Prépare l'opération demandée. NE LÈVE JAMAIS : un refus est une réponse que
 * le modèle doit pouvoir expliquer.
 *
 * @param {string} nom      le nom de l'outil
 * @param {object} args     les arguments donnés par le modèle
 * @param {object} etat     ce que voient les écrans :
 *   { clients, enAttente, ravitaillements, expediteurs, validateAmount, liquidite, disponible(vase), soldes }
 *   `soldes` : stock et liquidité PAR RÉSEAU, le document de soldes tel que
 *   l'écran le tient. Absent, la réserve n'est pas jugée ici (le serveur reste
 *   garant) — TC-309 vérifie que le panneau le fournit.
 * @returns {{carte?: object, reponse: object}}
 */
export function preparerOperation(nom, args = {}, etat = {}) {
  const preparateur = PREPARATEURS[nom]
  if (!preparateur) return refuser(`Je ne sais pas préparer « ${nom} ».`)
  try {
    return preparateur(args ?? {}, etat)
  } catch (cause) {
    console.error(`[assistant] préparation ${nom} impossible`, cause)
    return refuser("Je n'ai pas pu préparer cette opération.")
  }
}
