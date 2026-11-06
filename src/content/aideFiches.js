/**
 * Les fiches d'aide, en DONNÉE et non en JSX.
 *
 * POURQUOI CETTE SÉPARATION
 * ─────────────────────────
 * Ce texte va être corrigé par des gens qui ne lisent pas de React : le gérant,
 * et les franchises elles-mêmes au fil de ce qui les bloque. Une formulation qui
 * se change dans un tableau de chaînes se corrige en trente secondes ; la même
 * noyée dans du balisage demande de distinguer ce qui est du texte de ce qui est
 * de la mise en page, et on n'y touche plus.
 *
 * LES LIBELLÉS D'ÉCRAN SONT BALISÉS `{{ainsi}}`
 * ─────────────────────────────────────────────
 * `AidePanel` les rend sous la forme du bouton réel. C'est le seul effet du
 * panneau, et c'est celui qui travaille : l'œil retrouve dans la fiche la forme
 * qu'il cherche à l'écran. Les accolades plutôt que du Markdown parce qu'il n'y
 * a qu'une seule chose à marquer — y mettre un analyseur complet serait payer
 * une grammaire pour un mot.
 *
 * LE VOCABULAIRE EST CELUI DE LA BOUTIQUE, PAS CELUI DU CODE
 * ────────────────────────────────────────────────────
 * Le fournisseur se dit « le dealer » — jamais « la centrale », qui est un mot
 * de documentation que personne ne prononce au comptoir. On ne le désigne pas
 * non plus par un nom propre : chaque franchise a le sien, et une fiche qui
 * nommerait quelqu'un ne servirait qu'à une boutique.
 *
 * ⚠ TOUT LIBELLÉ ENTRE ACCOLADES EXISTE À L'ÉCRAN, MOT POUR MOT.
 *   Une fiche qui nomme un bouton inexistant est pire que pas de fiche : elle
 *   fait douter la caissière d'elle-même au lieu de la débloquer. TC-225 relit
 *   ces libellés contre les composants ; il échouera si l'un d'eux est renommé
 *   sans que la fiche suive.
 *
 * MISE À JOUR DU 31 OCTOBRE 2026
 * ──────────────────────────────
 * Relues contre l'écran : « Supprimer » s'appelle « Annuler » depuis longtemps,
 * « Vider les soldes » n'existe plus, et une dizaine de gestes n'avaient pas de
 * fiche — le règlement partiel et le code agent, la modification d'une
 * opération qui attend, le chrono, le regroupement par client, l'onglet
 * Ravitaillement de l'historique, le règlement en deux moyens, l'historique
 * d'un client, et l'assistant.
 */

export const GROUPES = Object.freeze({
  TRANSACTIONS: 'transactions',
  HISTORIQUE: 'historique',
  RESERVES: 'reserves',
  CLIENTS: 'clients',
  ASSISTANT: 'assistant',
  HORS_LIGNE: 'hors-ligne',
})

/**
 * L'ordre de lecture par défaut, quand on n'est nulle part en particulier.
 *
 * Les réserves suivent la saisie parce qu'elles vivent sur le MÊME onglet : un
 * ravitaillement se fait depuis Transactions. Les clients viennent ensuite —
 * on les consulte, on n'y échoue pas. L'assistant ferme la marche : il est sur
 * tous les écrans, et il sait lui-même lire ces fiches. Le hors-ligne vient en
 * dernier : il ne dépend d'aucun onglet, et les fiches se citent par leur
 * numéro, qu'une insertion plus haut décalerait toutes.
 */
const ORDRE_GROUPES = Object.freeze([
  GROUPES.TRANSACTIONS,
  GROUPES.RESERVES,
  GROUPES.HISTORIQUE,
  GROUPES.CLIENTS,
  GROUPES.ASSISTANT,
  GROUPES.HORS_LIGNE,
])

/**
 * Le groupe à présenter en premier, selon l'endroit où l'on se tient.
 *
 * C'est tout ce qui sépare « rapide » de « encore un truc à fouiller ». Une
 * caissière bloquée dans l'historique ne doit pas commencer par faire défiler
 * les fiches de saisie.
 *
 * Transactions reste le défaut : c'est l'écran de la journée, et une adresse
 * inattendue vaut mieux d'y retomber que nulle part.
 */
export function groupePourChemin(chemin = '') {
  if (chemin.startsWith('/historique')) return GROUPES.HISTORIQUE
  if (chemin.startsWith('/clients')) return GROUPES.CLIENTS
  return GROUPES.TRANSACTIONS
}

/** Les groupes, celui de l'endroit où l'on se tient en tête. */
export function groupesOrdonnes(chemin = '') {
  const premier = groupePourChemin(chemin)
  return [premier, ...ORDRE_GROUPES.filter((groupe) => groupe !== premier)]
}

export const TITRES_GROUPES = Object.freeze({
  [GROUPES.TRANSACTIONS]: { titre: 'Enregistrer une opération', ou: 'onglet Transactions' },
  [GROUPES.HISTORIQUE]: { titre: 'Relire et corriger', ou: 'onglet Historique' },
  [GROUPES.RESERVES]: { titre: 'Stock et espèces', ou: 'onglet Transactions' },
  [GROUPES.CLIENTS]: { titre: 'Les clients', ou: 'onglet Clients' },
  [GROUPES.ASSISTANT]: { titre: 'L’assistant', ou: 'bouton rond, en bas à droite' },
  [GROUPES.HORS_LIGNE]: { titre: 'Sans internet', ou: 'partout' },
})

export const FICHES = Object.freeze([
  {
    id: 1,
    groupe: GROUPES.TRANSACTIONS,
    titre: "Le client te remet de l'argent — un dépôt",
    etapes: [
      'Onglet {{Transactions}}, bouton {{Enregistrer une transaction}}.',
      "Dans la barre de recherche, tape le numéro ou le code agent. S'il n'est pas dans tes clients, {{Enregistrer ce client}} crée sa fiche ; {{Utiliser ce code sans client enregistré}} passe sans fiche.",
      'Choisis {{Dépôt}}.',
      'Tape la somme dans {{Montant (FCFA)}}.',
      'Deux boutons se présentent : {{Valider}} ou {{Non Terminées}}. Lis la fiche 3 avant de choisir.',
    ],
    retenir: {
      titre: 'Il faut du stock',
      texte: "Un dépôt envoie du stock au client. S'il n'y en a pas assez, le logiciel refuse et dit combien il en reste : il faut d'abord un ravitaillement (fiche 10).",
    },
  },
  {
    id: 2,
    groupe: GROUPES.TRANSACTIONS,
    titre: "Le client vient prendre de l'argent — un retrait",
    texte: 'Exactement les mêmes étapes que la fiche 1, en choisissant {{Retrait}}.',
    retenir: {
      titre: 'Si le bouton ne répond pas',
      texte: "Pour {{Valider}} un retrait, il faut assez d'espèces en caisse. Si le bouton reste gris, pose le doigt dessus : le logiciel écrit pourquoi. Tu peux toujours le mettre en {{Non Terminées}} et le payer plus tard.",
    },
  },
  {
    id: 3,
    groupe: GROUPES.TRANSACTIONS,
    titre: '{{Valider}} ou {{Non Terminées}} : lequel choisir ?',
    texte: 'C’est la seule chose à bien comprendre. Tout le reste en découle.',
    etapes: [
      "{{Valider}} — l'argent a **déjà** changé de main, des deux côtés. L'opération est finie, elle part directement dans l'historique.",
      "{{Non Terminées}} — il **manque** encore quelque chose : le client n'a pas payé, ou tu ne lui as pas encore remis les espèces. L'opération reste dans la liste du bas, en attente.",
    ],
    retenir: {
      titre: 'Dans le doute',
      texte: "Choisis {{Non Terminées}}. Une opération en attente se termine en deux clics (fiche 4). Une opération validée trop tôt se corrige aussi, mais c'est plus long.",
    },
  },
  {
    id: 4,
    groupe: GROUPES.TRANSACTIONS,
    titre: 'Terminer une opération qui attend',
    etapes: [
      'Dans la liste {{Non Terminées}}, trouve la ligne.',
      'Pour un dépôt, clique {{Encaisser}}. Pour un retrait, {{Payer par}}.',
      'Choisis {{Orange Money}} ou {{Cash}}.',
      'Le montant proposé est **tout ce qui reste dû**. Pour ne régler qu’une partie, change-le : les boutons − et + avancent de 500 en 500.',
      "Si l'argent part sur un compte agent, tape ce code dans {{Envoyé sur le code agent}}. Remis en main propre, laisse vide.",
      'Clique {{Confirmer}}.',
    ],
    texteFin: "Réglée en entier, la ligne rejoint l'historique. Réglée en partie, elle reste dans la liste avec ce qu'il reste à payer. Pour payer un retrait en {{Cash}}, il faut assez d'espèces : sinon le logiciel refuse et dit combien il y a.",
    retenir: {
      titre: 'Payer en deux moyens',
      texte: "Une partie en {{Orange Money}}, le reste en {{Cash}} : refais simplement les étapes pour chaque partie. L'historique montre ensuite chaque montant avec son moyen et son code (fiche 18).",
    },
  },
  {
    id: 5,
    groupe: GROUPES.TRANSACTIONS,
    titre: 'Corriger une opération qui attend',
    etapes: [
      'Dans la liste {{Non Terminées}}, sur la ligne, clique {{Modifier}}.',
      'Le formulaire s’ouvre avec l’opération : corrige le client, le type ou le montant.',
      'Confirme comme à la saisie.',
    ],
    retenir: {
      titre: 'Elle reste en attente',
      texte: "Corrigée, l'opération reste dans les {{Non Terminées}}, à terminer comme d'habitude (fiche 4). Une opération dont une partie est **déjà réglée** ne se corrige plus : termine-la.",
    },
  },
  {
    id: 6,
    groupe: GROUPES.TRANSACTIONS,
    titre: 'Annuler une opération qui attend',
    etapes: [
      'Sur la ligne, clique {{Annuler}}.',
      'Relis ce qui s’affiche, puis {{Annuler la transaction}}. {{Garder}} referme sans rien faire.',
    ],
    retenir: {
      titre: 'Ce que ça fait',
      texte: "Le stock engagé est rendu, et la ligne va dans la {{Corbeille}} de l'historique, où elle reste lisible. **Elle n'en revient pas** : pour la remettre, il faut la ressaisir. Une opération dont une partie est déjà réglée ne s'annule plus.",
    },
  },
  {
    id: 7,
    groupe: GROUPES.TRANSACTIONS,
    titre: 'Lire la liste des opérations qui attendent',
    etapes: [
      'Chaque ligne dit **depuis combien de temps** elle attend. Au-delà de 30 minutes, elle se colore : le client attend trop.',
      'Plusieurs opérations du même client et du même type se replient sur une seule ligne, avec leur **total**. Le bouton « Voir les … » les déplie, {{Masquer}} les replie.',
      "Une opération réglée en partie montre ce qu'il reste à payer.",
    ],
  },
  {
    id: 8,
    groupe: GROUPES.TRANSACTIONS,
    titre: 'Les deux cases au-dessus de la liste',
    etapes: [
      "{{Dépôts}} — tout ce qu'il te reste à **encaisser**.",
      "{{Retraits}} — tout ce qu'il te reste à **payer**.",
      'Le petit chiffre au-dessus de chaque case dit **combien d’opérations** composent ce total.',
    ],
  },
  {
    id: 9,
    groupe: GROUPES.TRANSACTIONS,
    titre: '{{Total caisse}}, en haut de l’écran',
    texte: "C'est le chiffre à comparer avec ce que tu as réellement en main le soir.",
    formule: 'Total = Stock + Liquidité + Dépôts en attente − Retraits en attente',
    retenir: {
      titre: 'Pourquoi les opérations en attente comptent',
      texte: "Un dépôt en attente est sorti du stock mais l'argent est à toi : il s'ajoute. Un retrait en attente est rentré au stock mais l'argent revient au client : il se retranche.",
    },
  },

  {
    id: 10,
    groupe: GROUPES.RESERVES,
    titre: 'Le dealer t’a envoyé du stock ou des espèces',
    etapes: [
      'Onglet {{Transactions}}, bouton {{Ravitaillement}}, puis {{Nouveau ravitaillement}}.',
      'Dans {{Reçu de}}, choisis qui te l’a envoyé. Si le nom n’y est pas, prends {{Ajouter un nom}}.',
      'Tape ce que tu as reçu dans {{Montant (FCFA)}}.',
      'Sous {{Réserve ravitaillée}}, choisis {{Stock}} si c’est du stock électronique, {{Espèce}} si c’est de l’argent liquide.',
      'La {{Note}} est facultative : elle sert à retrouver l’envoi plus tard.',
    ],
    retenir: {
      titre: 'Pourquoi le nom compte',
      texte: 'Tu devras rendre à **cette personne-là** ce qu’elle t’a envoyé. Une livraison sans nom ne se retrouve dans aucun compte du soir.',
    },
  },
  {
    id: 11,
    groupe: GROUPES.RESERVES,
    titre: 'Rendre au dealer ce qu’il t’a envoyé',
    etapes: [
      'Onglet {{Transactions}}, bouton {{Ravitaillement}}. Le chiffre à côté du bouton dit combien de livraisons tu dois encore.',
      'La liste montre ce que tu dois, **personne par personne**.',
      'Sur la livraison concernée, clique {{Retour}}.',
      'Tape le montant, puis choisis si tu rends en {{Stock}} ou en {{Espèce}}.',
    ],
    texteFin: 'Il faut que la réserve choisie contienne le montant. Un retour fait par erreur s’annule depuis l’historique (fiche 17).',
    retenir: {
      titre: 'Tu peux rendre en plusieurs fois',
      texte: 'Chaque retour se retranche du reste dû. Quand il tombe à zéro, la livraison quitte la liste et le chiffre baisse. Tu peux aussi rendre en espèces ce que tu avais reçu en stock.',
    },
  },

  {
    id: 12,
    groupe: GROUPES.HISTORIQUE,
    titre: "Corriger le montant d'une opération déjà validée",
    etapes: [
      'Onglet {{Historique}}, puis {{Transactions clients}}.',
      'Sur la ligne, clique {{Modifier}}.',
      "Tu reviens dans le formulaire. Le montant a déjà été rendu aux soldes : tu repars d'une caisse juste.",
      'Corrige le montant, puis {{Valider}}.',
    ],
    retenir: {
      titre: 'Où la retrouver ensuite',
      texte: "Elle **repart dans l'historique**, à sa place. Ne la cherche pas dans les non terminées : elle n'y passe pas.",
    },
  },
  {
    id: 13,
    groupe: GROUPES.HISTORIQUE,
    titre: 'Voir les corrections déjà faites sur une ligne',
    texte: 'Sur une ligne déjà corrigée, un bouton {{Modification}} apparaît — le chiffre à côté dit combien de fois.',
    texteFin: 'Il ouvre la liste de toutes les corrections : ancien montant, nouveau montant, la date, l’heure et qui l’a faite.',
  },
  {
    id: 14,
    groupe: GROUPES.HISTORIQUE,
    titre: "Annuler une opération de l'historique",
    etapes: [
      'Sur la ligne, clique {{Annuler}}.',
      'Relis, puis {{Annuler la transaction}}.',
    ],
    retenir: {
      titre: 'Ce que ça fait',
      texte: "Le montant est rendu aux soldes et la ligne part en {{Corbeille}}. Comme pour la fiche 6 : **elle n'en revient pas**.",
    },
  },
  {
    id: 15,
    groupe: GROUPES.HISTORIQUE,
    titre: 'Retrouver une opération annulée',
    texte: "Onglet {{Historique}}, puis {{Corbeille}}. Ce qui a été annulé s'y trouve — venu des non terminées comme de l'historique —, de la plus récente à la plus ancienne, avec qui l'a fait et quand.",
    texteFin: 'La liste montre ce qui a été annulé aujourd’hui. Pour une opération saisie un autre jour, choisis ses dates sous la liste, puis {{Filtrer}}. On y **lit**. On n’y restaure pas : pour la remettre, ressaisis-la.',
  },
  {
    id: 16,
    groupe: GROUPES.HISTORIQUE,
    titre: 'Pourquoi {{Modifier}} ou {{Annuler}} est parfois gris',
    texte: "Pose le doigt sur le bouton gris : **la raison s'affiche**. Ce n'est pas une panne, c'est un refus expliqué.",
    texteFin: "Le cas le plus courant : une opération payée en plusieurs fois, dont il reste une partie à régler. Celle-là se termine en réglant le reste, pas en l'annulant.",
  },
  {
    id: 17,
    groupe: GROUPES.HISTORIQUE,
    titre: 'Les ravitaillements et les retours',
    texte: "Onglet {{Historique}}, puis {{Ravitaillement}}. Ce que le dealer t'a envoyé et ce que tu lui as rendu, dans l'ordre : **+** ce qui est entré, **−** ce qui est sorti, avec la personne et la réserve. Ils ne se mélangent pas aux opérations des clients.",
    etapes: [
      'Un retour fait par erreur : sur sa ligne, clique {{Annuler}}.',
      'Relis, puis {{Annuler le retour}}. Le montant revient dans la réserve, et la livraison **redevient due** d’autant.',
    ],
    texteFin: 'Un ravitaillement, lui, ne s’annule pas : il se solde en rendant (fiche 11). Les livraisons encore dues sont toujours toutes là ; pour un mouvement ou une clôture d’un autre jour, choisis ses dates sous la liste, puis {{Filtrer}}. Les demandes au dealer sont dessous.',
  },
  {
    id: 18,
    groupe: GROUPES.HISTORIQUE,
    titre: 'Une opération réglée en plusieurs fois, ou par deux moyens',
    texte: 'Le statut cite tous les moyens employés — par exemple « Payé par Orange Money et Cash ».',
    texteFin: 'Juste en dessous, chaque montant avec son moyen : « 50 000 FCFA par Orange Money → 7777777 », puis « 50 000 FCFA par Cash ». La flèche donne le code agent sur lequel l’argent est parti. L’export de l’historique porte le même détail.',
  },
  {
    id: 19,
    groupe: GROUPES.HISTORIQUE,
    titre: 'Retrouver une opération plus ancienne, et exporter',
    etapes: [
      'Onglet {{Historique}}, puis {{Transactions clients}}.',
      'Choisis les dates, ou tape le nom ou le code du client dans la recherche.',
      'Seule la journée en cours est chargée. {{Filtrer}} relit les dates choisies, 31 jours au plus ; la phrase sous les filtres dit lesquels. {{Aujourd\'hui}} y revient.',
      'La navigation par jour saute d’une journée chargée à l’autre.',
      'Les opérations d’un même client et d’un même type se replient sur une ligne avec leur total, comme dans la liste qui attend (fiche 7).',
      '{{Exporter XLSM}} enregistre ce qui est affiché dans un fichier Excel.',
    ],
  },

  {
    id: 20,
    groupe: GROUPES.CLIENTS,
    titre: 'Ajouter un client, un par un ou par fichier',
    etapes: [
      'Onglet {{Clients}}. Pour un seul, bouton {{Ajouter un client}}.',
      'Pour toute une liste, bouton {{Importer (XLSM)}} et choisis ton fichier Excel.',
      'Le fichier attend ces colonnes : {{Nom}}, {{Prénom}}, {{Numéro d\'identité}}, {{Numéro personnel}}, {{Code agent}}, {{Numéro agent}}.',
      'Un ancien fichier qui n’a qu’une colonne {{Numéro agent / Code agent}} reste accepté : 8 chiffres partent dans le numéro, 7 dans le code.',
    ],
    texteFin: 'Un code agent ne sert qu’à **un seul** client, toutes boutiques confondues. S’il est déjà pris, le logiciel refuse et dit à quelle fiche il appartient.',
    retenir: {
      titre: 'Les clients importés sont à TA boutique',
      texte: 'Peu importe ce que contient le fichier : c’est la boutique connectée qui est inscrite sur chaque client importé. Tu ne peux pas verser par erreur tes clients chez une autre franchise.',
    },
  },
  {
    id: 21,
    groupe: GROUPES.CLIENTS,
    titre: 'Retrouver un client',
    texte: 'La barre de recherche de l’onglet {{Clients}} cherche dans **tout** à la fois : le nom, le prénom, le numéro ou code agent, et le numéro personnel.',
    texteFin: 'Tape les quelques chiffres dont tu te souviens, la liste se réduit au fur et à mesure.',
  },
  {
    id: 22,
    groupe: GROUPES.CLIENTS,
    titre: 'Tout ce qu’un client a fait',
    texte: 'Sur la ligne du client, bouton {{Historique}}. Toutes ses opérations s’affichent, **dans toutes les boutiques**, avec le nombre par boutique.',
    texteFin: 'Celles qui attendent encore sont en tête. On y lit seulement : pour agir sur une opération, va dans {{Transactions}} ou {{Historique}}.',
  },

  {
    id: 23,
    groupe: GROUPES.ASSISTANT,
    titre: 'Poser une question à l’assistant',
    etapes: [
      'Clique le bouton rond, en bas à droite de l’écran. Le volet s’ouvre sur la droite.',
      'Choisis une des questions proposées, ou écris la tienne : « fais le point de la journée », « qui me doit encore de l’argent ? », « combien j’ai en espèces ? », « comment encaisser un dépôt à distance ? ».',
    ],
    texteFin: 'Il lit les chiffres de **ta** boutique au moment où tu demandes, et les fiches de cette aide. Il ne voit pas les autres boutiques.',
  },
  {
    id: 24,
    groupe: GROUPES.ASSISTANT,
    titre: 'Lui faire préparer une opération',
    etapes: [
      'Dis-lui ce qu’il faut faire : « dépôt à distance de 50 000 pour Salif », « paie le retrait de Salif en cash », « annule le dépôt de Awa ».',
      'Une carte s’affiche sous sa réponse : client, montant, moyen. **Relis-la.**',
      '{{Confirmer}} l’enregistre. {{Écarter}} la laisse tomber.',
    ],
    retenir: {
      titre: 'Rien ne part sans toi',
      texte: 'Tant que tu n’as pas cliqué {{Confirmer}}, rien n’est enregistré. Il vérifie la caisse avant de préparer : s’il manque des espèces ou du stock, il le dit et propose une autre façon de faire. Une opération à la fois.',
    },
  },
  {
    id: 25,
    groupe: GROUPES.ASSISTANT,
    titre: 'Dicter au lieu d’écrire',
    etapes: [
      'Clique le micro, à gauche de la zone de texte, et parle.',
      'Ce que tu dis s’écrit dans la zone. **Relis**, corrige si besoin, puis envoie avec la flèche.',
    ],
    texteFin: 'Rien ne part tant que tu n’as pas envoyé. Pas de micro affiché ? Le navigateur ne sait pas dicter : prends Chrome ou Edge.',
  },
  {
    id: 26,
    groupe: GROUPES.ASSISTANT,
    titre: 'Reprendre une ancienne conversation',
    etapes: [
      'En haut du volet, l’horloge ouvre tes conversations passées. Clique celle que tu veux : l’assistant reprend le fil.',
      'Le **+** repart d’une conversation vide.',
    ],
    texteFin: 'Elles restent sur cet appareil, à ton nom et pour ta boutique : une autre caissière ne les voit pas.',
  },

  {
    id: 27,
    groupe: GROUPES.HORS_LIGNE,
    titre: 'Travailler sans internet',
    texte: 'Sans internet, le logiciel continue. Tu peux saisir une opération, l’encaisser ou la payer, régler par tranche, rembourser et ajouter un client : **tout est gardé sur cet appareil et part tout seul** au retour de la connexion, même si la machine a été éteinte entre-temps.',
    etapes: [
      'La ligne porte « En attente d’envoi », et le haut de l’écran affiche {{Soldes provisoires}} : ces chiffres comptent déjà ce qui attend.',
      'Le bandeau du bas dit combien d’opérations attendent. {{Voir}} les liste une par une.',
      'Modifier ou annuler une opération demande internet : attends qu’elle soit partie.',
    ],
    retenir: {
      titre: 'Une opération peut être refusée au retour',
      texte: 'Si le stock a fondu entre-temps, le serveur la refuse : elle affiche « Refusée » et la raison, et les soldes ne bougent pas. {{Retirer}} l’enlève de la liste ; ressaisis-la si besoin. Et **ne te déconnecte pas le soir** : sans internet, tu ne pourrais plus te reconnecter.',
    },
  },
])
