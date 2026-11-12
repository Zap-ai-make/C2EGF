/**
 * genererCodeLiaison.js — le code que la caissière dicte à l'agent.
 *
 * Contrat : C:\dev\oxygen\docs\contrats\liaison-agent.md, version 3, §5.1.
 *
 * Depuis le panneau de l'agent, une boutique connectée obtient six chiffres
 * valables quinze minutes. L'agent les saisit dans Oxygen ; le point d'entrée
 * privé (`pointEntreeOxygen.js`) les consomme.
 *
 * ⚠ N'IMPORTE QUELLE BOUTIQUE, PAS SEULEMENT CELLE DE LA FICHE. La fiche client
 *   est commune (firestore.rules, `globalClients`) : l'agent se fait relier là
 *   où il passe. La caissière est la seule barrière, d'où la consigne « Vérifiez
 *   la SIM agent » sur son écran (règle 10 du contrat).
 *
 * ⚠ UN SEUL CODE PAR FICHE, ET C'EST L'IDENTIFIANT DU DOCUMENT. Un nouveau code
 *   écrase le précédent : la règle « un nouveau code annule l'ancien » tient
 *   dans le choix de la clé, sans requête. L'empreinte de l'ancien est gardée
 *   pour répondre « annulé » plutôt que « incorrect » à qui le saisit encore —
 *   et pour ne pas compter cette saisie comme un échec contre le nouveau.
 *
 * ⚠ LE JOURNAL TRACE LA BOUTIQUE ET LE COMPTE, PAS UNE PERSONNE. Le CRM n'a
 *   qu'un compte par boutique ; un nom tapé à la main ne prouverait rien
 *   (règle 7, décision du 2026-11-12).
 */

import { DealerRequestError } from '../errors.js'
import { readValidatedProfile, validateAuthUid, validateInputPayload } from '../dealerRequests/shared.js'
import { validerClientId } from '../clients/listClientHistory.js'
import { OXYGEN_ENABLED, OXYGEN_DISTRIBUTEUR_ID, OXYGEN_NOM_DISTRIBUTEUR } from '../config/oxygenProfile.js'
import { DUREE_CODE_MS, ECHECS_MAX, cleVerrou, enMs, genererCode, hacherCode } from './liaison.js'

export const COLLECTION_CODES = 'codesLiaisonOxygen'
export const COLLECTION_LIAISONS = 'liaisonsOxygen'
export const COLLECTION_JOURNAL = 'journalLiaisonsOxygen'

/** Ce que le profil dit de la liaison ; injectable pour les tests. */
export const OXYGEN_DU_PROFIL = Object.freeze({
  actif: OXYGEN_ENABLED,
  distributeurId: OXYGEN_DISTRIBUTEUR_ID,
  nom: OXYGEN_NOM_DISTRIBUTEUR,
})

/**
 * Les comptes de boutique, et eux seuls : c'est la caissière qui voit l'agent.
 * Liste blanche, pour la raison écrite dans `listClientHistory.js` : un rôle
 * ajouté plus tard ne doit pas hériter de ce pouvoir en silence.
 */
const ROLES_AUTORISES = Object.freeze(['store_admin', 'member'])

const validerProfilBoutique = (profile) => {
  if (!profile?.active) {
    throw new DealerRequestError('PROFILE_INACTIVE', 'Votre compte est désactivé.')
  }
  if (!ROLES_AUTORISES.includes(profile?.role)) {
    throw new DealerRequestError('ROLE_FORBIDDEN', 'Seule une boutique peut générer un code de liaison.')
  }
  if (typeof profile.storeId !== 'string' || !profile.storeId) {
    throw new DealerRequestError('STORE_ID_REQUIRED', 'Votre compte n’est rattaché à aucune boutique.')
  }
}

/** Un code précédent encore vivant : c'est lui qu'un nouveau code « remplace ». */
const encoreVivant = (code, maintenantMs) =>
  Boolean(code) && !code.utiliseLe && enMs(code.expireLe) > maintenantMs && (code.echecs ?? 0) < ECHECS_MAX

export async function genererCodeLiaisonHandler(
  request,
  { db, Timestamp, maintenant = Date.now, oxygen = OXYGEN_DU_PROFIL },
) {
  const uid = validateAuthUid(request.auth?.uid)
  validateInputPayload(request.data ?? {}, ['clientId'])
  const clientId = validerClientId(request.data?.clientId)
  // `globalClients/a/b/c` est un chemin de document valide : une barre oblique
  // ferait désigner un document hors de la collection, et le code s'écrirait
  // sous un identifiant qu'aucune fiche ne porte.
  if (clientId.includes('/')) {
    throw new DealerRequestError('INVALID_CLIENT_ID', 'Identifiant client invalide.')
  }

  if (!oxygen.actif) {
    throw new DealerRequestError('OXYGEN_DISABLED', 'La liaison Oxygen n’est pas ouverte ici.')
  }

  const { profile } = await readValidatedProfile(db, uid, validerProfilBoutique)
  const boutique = { storeId: profile.storeId, storeName: profile.storeName || profile.name || '', uid }

  const ficheRef = db.doc(`globalClients/${clientId}`)
  const codeRef = db.doc(`${COLLECTION_CODES}/${clientId}`)
  const journal = db.collection(COLLECTION_JOURNAL)

  return db.runTransaction(async (t) => {
    const [fiche, precedent] = await Promise.all([t.get(ficheRef), t.get(codeRef)])
    if (!fiche.exists) {
      throw new DealerRequestError('CLIENT_NOT_FOUND', 'Fiche introuvable.')
    }
    // Sans identifiant, l'agent n'aurait rien à saisir dans Oxygen : le code
    // serait généré pour rien, et tracé comme si de rien n'était.
    if (!cleVerrou(fiche.data())) {
      throw new DealerRequestError(
        'AGENT_SANS_IDENTIFIANT',
        'Cette fiche n’a ni code ni numéro agent. Ajoutez-en un d’abord.',
      )
    }

    const ms = maintenant()
    const heure = Timestamp.fromMillis(ms)
    const ancien = precedent.exists ? precedent.data() : null
    const code = genererCode()

    t.set(codeRef, {
      clientId,
      codeHache: hacherCode(clientId, code),
      hachePrecedent: ancien?.codeHache ?? null,
      creeLe: heure,
      expireLe: Timestamp.fromMillis(ms + DUREE_CODE_MS),
      echecs: 0,
      utiliseLe: null,
      utilisePar: null,
      objet: null,
      liaisonId: null,
      resultat: null,
      ...boutique,
    })
    if (encoreVivant(ancien, ms)) {
      t.set(journal.doc(), {
        issue: 'remplace', clientId,
        storeId: ancien.storeId ?? '', storeName: ancien.storeName ?? '', uid: ancien.uid ?? '', heure,
      })
    }
    t.set(journal.doc(), { issue: 'genere', clientId, ...boutique, heure })

    // `valableMs` en plus de `expireLe` : le poste compte à rebours sur sa propre
    // horloge, depuis la réception. Éteinte chaque soir, une machine de caisse
    // peut avoir des minutes d'écart avec le serveur.
    return { success: true, code, expireLe: ms + DUREE_CODE_MS, valableMs: DUREE_CODE_MS }
  })
}
