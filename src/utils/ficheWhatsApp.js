import { champsAgent } from './agentFields.js'
import { dureeDe } from './attente.js'

const francs = (montant) => (
  typeof montant === 'number' && Number.isFinite(montant)
    ? montant.toLocaleString('fr-FR')
    : null
)

/** Un accord au pluriel, pour les phrases comptées de ce fichier. */
const s = (n) => (n > 1 ? 's' : '')

/**
 * Ce que la fiche dit du délai — la MÊME phrase que l'écran, pas une variante.
 *
 * ⚠ CES TROIS BRANCHES SONT CELLES DE `PatronHistoriqueClient.jsx`. Si l'une
 *   d'elles diverge, le patron lit un chiffre à l'écran et en envoie un autre.
 *   Toute correction de l'un des deux textes doit toucher l'autre. (La branche
 *   « aucune opération chargée » reprend même le « pour l'instant » de l'écran
 *   — l'omettre rendrait le message PLUS catégorique que ce que le patron a
 *   sous les yeux, exactement ce que ce fichier interdit.)
 *
 * ⚠ `jours === null` VEUT DIRE « AUCUN DÉPÔT MESURABLE », PAS « IL N'A JAMAIS
 *   FAIT ATTENDRE ». Depuis la tâche 5 (I-2), seuls les dépôts entrent dans la
 *   moyenne : un agent avec vingt retraits impayés et zéro dépôt tombe ici. Une
 *   phrase du genre « aucune de ses opérations n'a attendu de règlement »
 *   blanchirait exactement le client que le patron appelle pour se plaindre.
 */
function phraseDelai(delai) {
  const jours = delai?.jours ?? null
  const mesurees = delai?.mesurees ?? 0
  const total = delai?.total ?? 0

  if (jours === null) {
    return total > 0
      ? `Jamais mesuré — aucun dépôt mesurable parmi les ${total} opération${s(total)} chargée${s(total)}.`
      : "Jamais mesuré — aucune opération chargée pour l'instant."
  }

  // ⚠ « 0 j » DIT L'INVERSE DE CE QU'IL VEUT DIRE : `delaiMoyen` arrondit au
  //   jour, donc tout règlement sous 12 h donne zéro. Même traitement qu'à
  //   l'écran (tâche 5, M-1).
  const combien = jours === 0 ? "moins d'un jour" : `${jours} j`

  return `Ramène l'argent en ${combien} en moyenne `
    + `(sur ${mesurees} dépôt${s(mesurees)} mesuré${s(mesurees)} `
    + `sur ${total} opération${s(total)} chargée${s(total)}).`
}

/**
 * La fiche d'un client en texte simple, pour WhatsApp.
 *
 * ⚠ TEXTE SIMPLE, PAS DE MISE EN FORME. Le message est lu sur n'importe quel
 *   téléphone, dans n'importe quelle version de WhatsApp. Des balises ou du
 *   Markdown s'afficheraient tels quels.
 *
 * ⚠ AUCUN IDENTIFIANT TECHNIQUE. Ni l'identifiant Firestore du client, ni ceux
 *   des opérations : ils ne servent à personne dans une conversation, et ils
 *   racontent la structure de la base à qui reçoit le message.
 *
 * ⚠ LA RÉSERVE VOYAGE AVEC LE CHIFFRE. `useHistoriqueClient` pagine par 50, et
 *   `delaiMoyen` ne voit que les lignes reçues. À l'écran, le patron peut
 *   charger la suite et voir le chiffre se préciser ; celui qui reçoit le
 *   message ne le peut pas. La dernière ligne le dit, et elle n'est pas
 *   facultative.
 */
export function texteFiche({ client, lignes = [], delai } = {}) {
  const agent = champsAgent(client ?? {})
  const dernieres = (Array.isArray(lignes) ? lignes : []).slice(0, 4)

  return [
    'FICHE CLIENT — C2EGF',
    '--------------------',
    `${client?.nom ?? ''} ${client?.prenom ?? ''}`.trim(),
    agent.codeAgent ? `Code agent : ${agent.codeAgent}` : null,
    agent.numeroAgent ? `Numero agent : ${agent.numeroAgent}` : null,
    client?.localite ? `Localite : ${client.localite}` : null,
    client?.registeredStoreName ? `Boutique : ${client.registeredStoreName}` : null,
    '',
    phraseDelai(delai),
    ...(dernieres.length
      ? ['', 'DERNIERES OPERATIONS', ...dernieres.map((o) => {
          const duree = dureeDe(o)
          const montant = francs(o?.montant)
          return [
            '-',
            o?.date ?? '',
            o?.type ?? '',
            montant ? `${montant} FCFA` : '',
            duree ? `(${duree.texte})` : '',
          ].filter(Boolean).join(' ')
        })]
      : []),
    '',
    "Délai calculé sur les opérations déjà chargées, pas sur tout l'historique.",
  ].filter((l) => l !== null).join('\n')
}

/**
 * Le lien d'envoi.
 *
 * ⚠ SANS NUMÉRO DE DESTINATAIRE. `wa.me` sans numéro ouvre le sélecteur de
 *   contacts, et le patron choisit. Pré-remplir le numéro du client
 *   supposerait qu'on lui envoie toujours sa propre fiche — ce qui est faux
 *   quand il s'agit de la montrer à un gérant.
 */
export const lienWhatsApp = (texte) => `https://wa.me/?text=${encodeURIComponent(texte)}`
