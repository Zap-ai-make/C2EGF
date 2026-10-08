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
 */

export const GROUPES = Object.freeze({
  TRANSACTIONS: 'transactions',
  HISTORIQUE: 'historique',
  RESERVES: 'reserves',
  CLIENTS: 'clients',
})

/**
 * L'ordre de lecture par défaut, quand on n'est nulle part en particulier.
 *
 * Les réserves suivent la saisie parce qu'elles vivent sur le MÊME onglet : un
 * ravitaillement se fait depuis Transactions. Les clients ferment la marche —
 * on les consulte, on n'y échoue pas.
 */
const ORDRE_GROUPES = Object.freeze([
  GROUPES.TRANSACTIONS,
  GROUPES.RESERVES,
  GROUPES.HISTORIQUE,
  GROUPES.CLIENTS,
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
  [GROUPES.HISTORIQUE]: { titre: 'Rattraper une erreur', ou: 'onglet Historique' },
  [GROUPES.RESERVES]: { titre: 'Stock et espèces', ou: 'onglet Transactions' },
  [GROUPES.CLIENTS]: { titre: 'Les clients', ou: 'onglet Clients' },
})

export const FICHES = Object.freeze([
  {
    id: 1,
    groupe: GROUPES.TRANSACTIONS,
    titre: "Le client te remet de l'argent — un dépôt",
    etapes: [
      'Onglet {{Transactions}}, bouton {{Enregistrer une transaction}}.',
      "Dans la barre de recherche, tape le numéro ou le code agent. S'il n'est pas dans tes clients, clique {{Utiliser ce code sans client enregistré}}.",
      'Choisis {{Dépôt}}.',
      'Tape la somme dans {{Montant (FCFA)}}.',
      'Deux boutons se présentent : {{Valider}} ou {{Non Terminées}}. Lis la fiche 3 avant de choisir.',
    ],
  },
  {
    id: 2,
    groupe: GROUPES.TRANSACTIONS,
    titre: "Le client vient prendre de l'argent — un retrait",
    texte: 'Exactement les mêmes étapes que la fiche 1, en choisissant {{Retrait}}.',
    retenir: {
      titre: 'Si le bouton ne répond pas',
      texte: "Pour un retrait, il faut assez d'espèces en caisse. Si {{Valider}} reste gris, pose le doigt dessus : le logiciel écrit pourquoi.",
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
      'Indique comment : {{Orange Money}} ou {{Cash}}.',
    ],
    texteFin: "La ligne quitte la liste et rejoint l'historique.",
  },
  {
    id: 5,
    groupe: GROUPES.TRANSACTIONS,
    titre: 'Effacer une opération qui attend',
    etapes: [
      'Sur la ligne, clique {{Supprimer}}.',
      'Confirme.',
    ],
    retenir: {
      titre: 'Ce que ça fait',
      texte: "Le stock engagé est rendu, et la ligne va dans la {{Corbeille}} de l'historique, où elle reste lisible. **Elle n'en revient pas** : pour la remettre, il faut la ressaisir.",
    },
  },
  {
    id: 6,
    groupe: GROUPES.TRANSACTIONS,
    titre: 'Les deux cases au-dessus de la liste',
    etapes: [
      "{{Dépôts}} — tout ce qu'il te reste à **encaisser**.",
      "{{Retraits}} — tout ce qu'il te reste à **payer**.",
      'Le petit chiffre au-dessus de chaque case dit **combien d’opérations** composent ce total.',
    ],
  },
  {
    id: 7,
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
    id: 8,
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
    id: 9,
    groupe: GROUPES.RESERVES,
    titre: 'Rendre au dealer ce qu’il t’a envoyé',
    etapes: [
      'Onglet {{Transactions}}, bouton {{Ravitaillement}}. Le chiffre à côté du bouton dit combien de livraisons tu dois encore.',
      'La liste montre ce que tu dois, **personne par personne**.',
      'Sur la livraison concernée, clique {{Retour}}.',
      'Tape le montant, puis choisis si tu rends en {{Stock}} ou en {{Espèce}}.',
    ],
    retenir: {
      titre: 'Tu peux rendre en plusieurs fois',
      texte: 'Chaque retour se retranche du reste dû. Quand il tombe à zéro, la livraison quitte la liste et le chiffre baisse. Tu peux aussi rendre en espèces ce que tu avais reçu en stock.',
    },
  },
  {
    id: 10,
    groupe: GROUPES.RESERVES,
    titre: '{{Vider les soldes}} — à ne faire qu’en connaissance de cause',
    texte: 'Ce bouton ramène **stock et espèces à zéro** d’un seul geste. Le logiciel te montre d’abord le {{Total soldé}} : lis-le, c’est ta dernière relecture.',
    retenir: {
      titre: 'C’est sans retour',
      texte: 'Les montants restent inscrits dans l’historique sous une ligne de clôture, mais **ils ne s’annulent pas depuis l’application**. En cas de doute, ne clique pas : appelle avant.',
    },
  },

  {
    id: 11,
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
    id: 12,
    groupe: GROUPES.HISTORIQUE,
    titre: 'Voir les corrections déjà faites sur une ligne',
    texte: 'Sur une ligne déjà corrigée, un bouton {{Modification}} apparaît — le chiffre à côté dit combien de fois.',
    texteFin: 'Il ouvre la liste de toutes les corrections : ancien montant, nouveau montant, la date, l’heure et qui l’a faite.',
  },
  {
    id: 13,
    groupe: GROUPES.HISTORIQUE,
    titre: "Effacer une opération de l'historique",
    etapes: [
      'Sur la ligne, clique {{Supprimer}}, puis confirme.',
    ],
    retenir: {
      titre: 'Ce que ça fait',
      texte: "Le montant est rendu aux soldes et la ligne part en {{Corbeille}}. Comme pour la fiche 5 : **elle n'en revient pas**.",
    },
  },
  {
    id: 14,
    groupe: GROUPES.HISTORIQUE,
    titre: 'Retrouver une opération supprimée',
    texte: "Onglet {{Historique}}, puis {{Corbeille}}. Tout ce qui a été supprimé s'y trouve — venu des non terminées comme de l'historique —, de la plus récente à la plus ancienne, avec qui l'a supprimée et quand.",
    texteFin: 'On y **lit**. On n’y restaure pas : pour la remettre, ressaisis-la.',
  },
  {
    id: 15,
    groupe: GROUPES.HISTORIQUE,
    titre: 'Pourquoi {{Modifier}} ou {{Supprimer}} est parfois gris',
    texte: "Pose le doigt sur le bouton gris : **la raison s'affiche**. Ce n'est pas une panne, c'est un refus expliqué.",
    texteFin: "Le cas le plus courant : une opération payée en plusieurs fois, dont il reste une partie à régler. Celle-là se corrige par un remboursement, pas par une suppression.",
  },

  {
    id: 16,
    groupe: GROUPES.CLIENTS,
    titre: 'Ajouter un client, un par un ou par fichier',
    etapes: [
      'Onglet {{Clients}}. Pour un seul, bouton {{Ajouter un client}}.',
      'Pour toute une liste, bouton {{Importer (XLSM)}} et choisis ton fichier Excel.',
      'Le fichier attend ces colonnes : {{Nom}}, {{Prénom}}, {{Numéro d\'identité}}, {{Numéro personnel}}, {{Code agent}}, {{Numéro agent}}.',
      'Un ancien fichier qui n’a qu’une colonne {{Numéro agent / Code agent}} reste accepté : 8 chiffres partent dans le numéro, 7 dans le code.',
    ],
    retenir: {
      titre: 'Les clients importés sont à TA boutique',
      texte: 'Peu importe ce que contient le fichier : c’est la boutique connectée qui est inscrite sur chaque client importé. Tu ne peux pas verser par erreur tes clients chez une autre franchise.',
    },
  },
  {
    id: 17,
    groupe: GROUPES.CLIENTS,
    titre: 'Retrouver un client',
    texte: 'La barre de recherche de l’onglet {{Clients}} cherche dans **tout** à la fois : le nom, le prénom, le numéro ou code agent, et le numéro personnel.',
    texteFin: 'Tape les quelques chiffres dont tu te souviens, la liste se réduit au fur et à mesure.',
  },
])
