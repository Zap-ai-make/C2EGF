import { champsAgent } from './agentFields.js'
import { dureeDe } from './attente.js'
import { phraseDelai } from './phraseDelai.js'

const francs = (montant) => (
  typeof montant === 'number' && Number.isFinite(montant)
    ? montant.toLocaleString('fr-FR')
    : null
)

/** Un accord au pluriel, pour les phrases comptées de ce fichier. */
const s = (n) => (n > 1 ? 's' : '')

/** Le statut d'une ligne, jamais vide : le serveur traite l'absence comme validée. */
const statutDe = (ligne) => String(ligne?.statut ?? '').trim() || 'Validée'

/**
 * Ce statut veut-il dire « c'est passé » ? — par SOUS-CHAÎNE, accents repliés.
 *
 * ⚠ « Validée » ET « Validee » COEXISTENT EN BASE, et ce n'est pas une
 *   hypothèse : `storeTransactionCommand.js:773` écrit `statut: 'Validee'` sans
 *   accent sur un retour de ravitaillement, là où `:169` écrit `'Validée'`
 *   avec. Une comparaison stricte accentuée faisait donc repartir une ligne
 *   parfaitement normale suffixée « — Validee » dans le message WhatsApp, ce
 *   qui se lit comme une anomalie — alors que l'écran l'affiche en vert, parce
 *   que `tonStatut` (`src/utils/helpers.js`) teste lui aussi par sous-chaîne,
 *   EXACTEMENT pour cette raison.
 *
 * ⚠ ON NE RÉUTILISE PAS `tonStatut` TEL QUEL, et c'est délibéré : il range
 *   aussi `'termin'` dans « confirmé », ce qui ferait passer un « Non
 *   Terminées » pour une opération aboutie. Ici la question est plus étroite —
 *   « faut-il nommer ce statut dans le message ? » — et seule la famille
 *   « valid » y répond oui.
 */
const estValide = (statut) => String(statut ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .includes('valid')

/**
 * Une ligne de l'historique, prête pour un message texte.
 *
 * ⚠ RONDE DE CORRECTION 1 (R23) — LE STATUT SE NOMME QUAND IL N'EST PAS
 *   « VALIDÉE ». `LigneHistorique.jsx` ne se contente jamais du montant et du
 *   type : une opération annulée s'y lit barrée, sous une pastille rouge
 *   (`StatusBadge`, `tonStatut`). Le texte simple n'a ni barré ni pastille — la
 *   seule façon de ne pas affirmer qu'une opération annulée a eu lieu comme les
 *   autres est de le dire en toutes lettres. Exemple qui a motivé ce correctif :
 *   un retrait de 500 000 FCFA annulé serait parti, sans cette ligne, identique
 *   à un retrait honoré — dans un message qui sert justement à trancher un
 *   litige d'argent.
 *
 * ⚠ RONDE DE CORRECTION 1 (R24) — LA DURÉE SE NOMME SELON LE SENS. `dureeDe`
 *   mesure `validatedAt − createdAt`, quel que soit le sens de l'opération
 *   (même filtre que `delaiMoyen.js`). Sur un RETRAIT, ce chrono est celui de
 *   LA BOUTIQUE à remettre l'argent ; sur un DÉPÔT, celui du CLIENT à être
 *   remboursé. Un `(3j 00:00)` nu, juste sous la seule autre phrase chiffrée du
 *   message — qui parle du temps de remboursement du client — ferait porter au
 *   client un retard qui est parfois celui de sa propre boutique. À l'écran,
 *   la plage début→fin et la couleur inflow/outflow évitent la confusion ; le
 *   texte simple n'a ni l'une ni l'autre, d'où l'étiquette explicite.
 */
function ligneTexte(o) {
  const duree = dureeDe(o)
  const montant = francs(o?.montant)
  const statut = statutDe(o)

  // ⚠ UNE DIRECTION INCONNUE NE S'ÉTIQUETTE PAS, ET DONC NE PUBLIE PAS SA
  //   DURÉE. Écrit `typePlie !== 'depot'`, le test de sens faisait repartir
  //   TOUT ce qui n'est pas un dépôt sous l'étiquette « remis par la
  //   boutique » — y compris un `typePlie` absent, vide ou inattendu.
  //   `plierType` (`functions/src/clients/historiqueClient.js`) rend « depot »
  //   ou « retrait » sur les variantes connues, mais rend la valeur pliée
  //   telle quelle sur tout autre type : un ravitaillement de 750 000 FCFA
  //   partait en accusant la boutique d'un retard de trois jours sur une
  //   opération qui n'est même pas un remboursement de client.
  //   C'est le défaut de R24 pris par l'autre bout : là, une durée nue se
  //   lisait comme celle du client ; ici, une durée mal étiquetée se lit comme
  //   celle de la boutique. Sur une direction inconnue, la seule réponse
  //   honnête est de taire la durée — le montant, la date et le statut, eux,
  //   restent exacts et partent.
  const sens = o?.typePlie === 'depot' || o?.typePlie === 'retrait' ? o.typePlie : null
  const dureeTexte = duree && sens
    ? (sens === 'retrait' ? `remis par la boutique en ${duree.texte}` : `réglé en ${duree.texte}`)
    : ''

  return [
    '-',
    o?.date ?? '',
    o?.type ?? '',
    montant ? `${montant} FCFA` : '',
    dureeTexte ? `(${dureeTexte})` : '',
    estValide(statut) ? '' : `— ${statut}`,
  ].filter(Boolean).join(' ')
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
 *
 * ⚠ RONDE DE CORRECTION 1 (R23) — LES LIGNES SUPPRIMÉES SONT ÉCARTÉES AVANT LE
 *   `slice(0, 4)`, PAS APRÈS. Le serveur ne filtre ni `deletedAt` ni `statut`
 *   (`listClientHistory.js`, et `reopenHistory` crée justement des lignes
 *   supprimées) : à l'écran, ces lignes se reconnaissent à l'opacité réduite,
 *   mais le CRM les considère hors d'usage. Filtrer APRÈS aurait fait manger
 *   une place à une ligne que le CRM ne compte plus, et la fiche aurait montré
 *   trois opérations réelles là où quatre tiennent.
 */
export function texteFiche({ client, lignes = [], delai } = {}) {
  const agent = champsAgent(client ?? {})
  const lignesValides = (Array.isArray(lignes) ? lignes : []).filter((o) => !o?.deletedAt)
  const dernieres = lignesValides.slice(0, 4)
  const { titre, detail } = phraseDelai(delai)

  // ⚠ RONDE DE CORRECTION 1 (M-6) — « N DES M DERNIÈRES », PAS UN TITRE NU.
  //   « DERNIERES OPERATIONS » ne disait pas si quatre lignes étaient TOUTES
  //   les opérations chargées ou seulement les quatre plus récentes d'un
  //   historique plus long — une ambiguïté qu'un titre sans chiffre entretient
  //   sans le vouloir.
  const entete = dernieres.length < lignesValides.length
    ? `${dernieres.length} des ${lignesValides.length} dernières opérations`
    : `${lignesValides.length} dernière${s(lignesValides.length)} opération${s(lignesValides.length)}`

  return [
    'FICHE CLIENT — C2EGF',
    '--------------------',
    // ⚠ RONDE DE CORRECTION 1 (M-2) — REPLI SUR « CLIENT », COMME L'ÉCRAN.
    //   Sans lui, une fiche sans nom ni prénom laissait deux lignes vides
    //   (`.filter(l => l !== null)` ne retire pas une chaîne vide) ; l'écran,
    //   lui, replie déjà sur « Client » (`PatronHistoriqueClient.jsx:138`).
    `${client?.nom ?? ''} ${client?.prenom ?? ''}`.trim() || 'Client',
    agent.codeAgent ? `Code agent : ${agent.codeAgent}` : null,
    agent.numeroAgent ? `Numéro agent : ${agent.numeroAgent}` : null,
    client?.localite ? `Localité : ${client.localite}` : null,
    client?.registeredStoreName ? `Boutique : ${client.registeredStoreName}` : null,
    '',
    `${titre} — ${detail}`,
    ...(dernieres.length
      ? ['', entete, ...dernieres.map(ligneTexte)]
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
