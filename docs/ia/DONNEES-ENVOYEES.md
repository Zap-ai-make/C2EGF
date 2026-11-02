# Ce qui part au modèle — décision du 2 novembre 2026

Décision prise par le responsable le **2 novembre 2026**, lot C de l'audit
(`audit/BILAN.md`, SEC-12 et SEC-13). La feuille de route l'exige pour tout
projet qui manie des données personnelles (`feuillederoute_assistant_ia.md`,
§10) : « Ajoutez une décision écrite sur ce qui part au modèle. »

Cette page dit ce qui part, vers qui, ce qui ne part pas, et ce que le
navigateur garde. Elle décrit le code du 2 novembre 2026. Un outil qui change
ce qu'il rend doit la mettre à jour.

---

## Vers qui

- **Firebase AI Logic**, backend **Agent Platform** de Google Cloud
  (`src/lib/ia/assistant.js`). Modèle `gemini-3.5-flash`, emplacement `global`
  par défaut (`VITE_AI_MODEL`, `VITE_AI_LOCATION`). L'usage est facturé sur le
  compte Google Cloud du projet et relève de ses conditions.
- Ce que Google en fait, d'après sa documentation lue le 2 novembre 2026
  ([zero data retention][zdr], [abuse monitoring][abus]) :
  - **pas d'entraînement** : « Google won't use your data to train or fine-tune
    any AI/ML models without your prior permission or instruction » ;
  - **un cache**, actif par défaut, effacé au plus tard **24 heures** après
    écriture ;
  - **une journalisation anti-abus** : quand ses classifieurs détectent une
    activité suspecte, Google peut garder la requête jusqu'à **90 jours**.
    Les clients sous contrat cadre (« Master Agreement ») en sont exemptés par
    défaut ; un projet aux conditions en ligne de Google Cloud ne l'est pas.
- L'assistant n'emploie **ni l'ancrage sur la recherche Google ni aucun autre
  outil de Google** : seuls nos outils sont déclarés, et ils s'exécutent dans le
  navigateur, avec le jeton de la personne connectée.

[zdr]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention
[abus]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/abuse-monitoring

---

## Ce qui part, à chaque question

| D'où | Ce qui part | Données personnelles |
|---|---|---|
| Prompt système (`prompt.js`) | Le nom de la personne connectée, son rôle, le nom de la boutique, la date | Le nom de la caissière. Sans nom au profil, le début de son adresse e-mail |
| La question | Ce que la caissière a tapé ou dicté, mot pour mot | Tout ce qu'elle y écrit |
| La mémoire de la conversation | Les échanges précédents. Pendant la conversation : avec les résultats des outils | Ceux des lignes suivantes |
| `bilan_du_jour` | Nombres d'opérations, totaux par type, total des créances, nombre de clients | Aucune |
| `etat_de_la_caisse` | Stock par réseau, espèces, non terminées, total caisse | Aucune |
| `chercher_client` | Jusqu'à 50 fiches, **de toute la base** : nom, prénom, code agent, numéro agent, **numéro personnel**, boutique qui a enregistré la fiche | Oui, voir les décisions 1 et 2 |
| `creances_en_cours`, `operations_recentes` | Jusqu'à 50 lignes **de la boutique** : nom du client, code agent, type, montant, réseau, statut, date | Noms et codes des clients |
| Préparations (`preparations.js`) | Le résumé de la carte, ou un choix à faire : nom du client et un identifiant, montants, dates ; pour un ravitaillement ou un retour, le nom de l'expéditeur | Noms, codes. L'identifiant est le code agent ; à défaut le numéro agent, l'ancien numéro Orange, puis le numéro personnel |
| `mode_d_emploi` | Le texte des fiches de l'onglet Aide | Aucune |
| Gestes d'écran | Rien que « fait » | Aucune |

## Ce qui ne part pas

- **Les données des autres boutiques**, sauf les fiches clients
  (décision 2) : leur historique, leurs créances, leurs soldes, leurs
  clôtures. Les règles Firestore refusent la lecture.
- L'adresse e-mail complète, l'uid, les jetons, les identifiants de documents :
  les outils retirent les champs d'audit (`nettoyer`).
- **La voix.** La dictée est transcrite par le navigateur
  (`dictee.js`), et le modèle ne reçoit le texte qu'à « Envoyer ». Le
  navigateur choisit son moteur : dans Chrome, la transcription demande
  internet (d'où le message d'erreur « La dictée a besoin d'internet »). Ce flux
  ne passe pas par le projet Firebase ; ce sont les conditions du navigateur
  qui s'y appliquent.
- **L'opération elle-même.** Le modèle reçoit le résumé de la carte ;
  l'enregistrement part du clic sur « Confirmer », par le même service que le
  formulaire.

---

## Les trois décisions

### 1. Le numéro personnel continue de partir

`chercher_client` rend le numéro personnel des fiches trouvées, comme la fiche
le montre à l'écran. **Choix du responsable : garder tel quel.**

Pour revenir dessus : retirer `numeroPersonnel` de la liste de `nettoyer` dans
`chercherClient` (`src/lib/ia/outils.js`) et du repli d'`identifiantDe`
(`src/lib/ia/preparations.js`). La recherche par numéro continuerait de
marcher : la correspondance se fait dans le navigateur. TC-301 [OL-06] échouera
et devra suivre.

### 2. La fiche d'un client d'une autre boutique part comme l'écran la montre

C'est l'issue (c), « statu quo », de `QUESTIONS-DU-COMPTOIR.md` §2, resté
ouvert depuis la préparation du lot. **Choix du responsable.**

La consigne du périmètre, « Aucune information de la boutique A ne parvient à
la boutique B », admet donc **une exception nommée : la fiche client**. Elle est
commune à toutes les boutiques par conception (`globalClients`, règle
`hasProfile()`), et l'onglet Clients la montre déjà en entier à chacune, avec
le nom de la boutique qui l'a enregistrée. C'est ce partage qui empêche de
créer une seconde fiche pour le même agent. Tout le reste reste cloisonné par
les règles.

Ce choix est figé par TC-301 [OL-06] : une fiche de Pissy, lue depuis
Gounghin, arrive entière.

### 3. Le navigateur garde le texte, pas les données lues par les outils

Les conversations restent sur l'appareil (`src/lib/ia/conversations.js`),
vingt au plus, par personne et par boutique. Avant la décision, la mémoire
rangée avec elles était l'historique brut du SDK : appels d'outils et
résultats compris, donc jusqu'à cinquante fiches par recherche, numéros
personnels inclus, en clair. **Choix du responsable : ne ranger que le texte
échangé.**

- `memoireSansDonnees` ne garde que les questions et les réponses écrites. Elle
  retire les appels, les résultats et la réflexion du modèle, et rend une
  mémoire que le SDK accepte à la reprise.
- Une conversation rouverte se poursuit ; elle a perdu les données lues, et le
  modèle reconsulte, comme le prompt le lui impose déjà.
- Pendant la conversation, rien ne change : la mémoire complète reste en
  mémoire vive, jamais sur le disque.
- Un rangement d'avant la décision est purgé à sa première relecture, quand
  la personne rouvre l'assistant sur ce poste. « Effacer l'historique » vide
  tout.
- La déconnexion n'efface pas les conversations : c'est ce qui permet de les
  reprendre (fiche d'aide 26). Ce qui reste est ce que l'écran a montré à
  cette personne.

Tests : TC-323 (MR-01 à MR-07), TC-313 [HI-02], TC-312 [VO-06], [VO-07].

---

## Ce qui reste possible, hors code

Deux réglages de Google Cloud, à décider par un humain, sans toucher au code :

- **couper le cache** de 24 heures (`cacheConfig`, `disableCache: true`, rôle
  `roles/aiplatform.admin`) ; à mesurer d'abord, le cache sert la rapidité ;
- **l'exemption de journalisation anti-abus**, qui dépend du contrat avec
  Google, pas d'un réglage du projet.
