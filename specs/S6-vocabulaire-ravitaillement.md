# S6 — Le vocabulaire : « ravitaillement »

```
Statut     : à faire
Périmètre  : MVP (détachable — voir Hors périmètre)
Dépend de  : S5
```

---

## Objectif

L'interface dit « demande » ; le métier dit « ravitaillement ». Un mot d'action
garde le même nom d'un bout à l'autre du flux : le lien de navigation, le bouton,
le titre de l'écran et le message de retour disent tous la même chose.

---

## Critères d'acceptation

- [ ] Le mot « ravitaillement » remplace « demande » dans : l'entrée de navigation,
      les titres d'écran, les libellés de bouton, les états vides, les messages de
      retour et les noms accessibles.
- [ ] Le bouton « Vérifier » devient le nom de ce qui va se passer ; le message qui
      suit l'envoi emploie **le même mot** que le bouton.
- [ ] Les en-têtes de colonnes et les libellés de statut sont alignés.
- [ ] **L'export Excel** est mis à jour, et son changement d'en-têtes est annoncé
      dans le message de commit — un fichier exporté est consommé ailleurs.
- [ ] Les identifiants techniques ne changent pas : `dealerRequests`,
      `requestType`, `stock_add`, `liquidity_add`, `DEALER_REQUEST_STATUSES`
      restent tels quels. Aucun champ Firestore n'est renommé.
- [ ] Les tests de S1 sont mis à jour **explicitement** là où ils portent sur un
      libellé visible, et le commit dit lesquels et pourquoi.
- [ ] Aucune occurrence de « demande » ne subsiste dans l'espace dealer, sauf là où
      le mot désigne réellement une demande faite au dealer par une boutique.

---

## Hors périmètre

- Le renommage « clients » → « agents », signalé dans `REFONTE.md` §5.2. Même
  nature, autre lot, autre écran.
- L'espace boutique et l'espace admin : ils voient les mêmes objets sous l'angle du
  destinataire, et leur vocabulaire se décide séparément.

**Détachable.** Cette spec n'apporte aucune capacité nouvelle. Si le calendrier se
tend, elle sort du MVP sans rien casser : elle est volontairement placée en dernier
et ne dépend de rien d'autre que S5.

---

## Notes techniques

⚠ **Ce n'est pas un restyle.** C'est un changement déclaré : il touche des chaînes
visibles, des en-têtes d'export et donc des tests. Il ne se mélange à aucun commit
de dessin (`REFONTE.md` §7).

Le vocabulaire est une donnée, pas une constante éparpillée : passer par
`constants/dealerConstants.js`, où `DEALER_REQUEST_TYPE_LABELS` et
`DEALER_REQUEST_STATUS_LABELS` vivent déjà. Un libellé qui change doit se changer
à un seul endroit.

Vérifier `src/utils/` pour la génération du fichier `xlsx` : les en-têtes y sont
probablement écrits en dur.
