# S6 — Le vocabulaire : « ravitaillement »

```
Statut     : terminée
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

- [x] Le mot « ravitaillement » remplace « demande » dans : l'entrée de navigation,
      les titres d'écran, les libellés de bouton, les états vides, les messages de
      retour et les noms accessibles.
      *(La navigation disait déjà « Ravitaillements » depuis S3.)*
- [x] Le bouton « Vérifier » devient le nom de ce qui va se passer ; le message qui
      suit l'envoi emploie **le même mot** que le bouton.
      *(« Vérifier le ravitaillement » → « Confirmer le ravitaillement » →
      « Ravitaillement confirmé : … ». Un verbe sans objet est tout ce qu'entend
      un lecteur d'écran qui parcourt les boutons d'un formulaire.)*
- [x] Les en-têtes de colonnes et les libellés de statut sont alignés.
      *(En-têtes : ils ne portaient déjà aucun « demande ».*
      *⚠ **Les libellés de statut ne sont volontairement PAS touchés.**
      `DEALER_REQUEST_STATUS_LABELS` est partagé avec les espaces boutique et
      admin, que cette spec met hors périmètre — un seul dictionnaire ne peut
      pas porter deux genres, et le scinder pour préserver l'accord dans un
      espace hors chantier aurait créé exactement la duplication que S6 existe
      pour supprimer. Là où le nom et le statut se croisent dans une même
      phrase — le vide filtré — le libellé est **cité entre guillemets**, ce
      qui l'isole de l'accord : « Aucun ravitaillement avec le statut
      « Rejetée » ». Figé par tc-207 [ID-02] et [MOT-06].)*
- [~] **L'export Excel** est mis à jour, et son changement d'en-têtes est annoncé
      dans le message de commit — un fichier exporté est consommé ailleurs.
      *⚠ **SANS OBJET : il n'existe aucun export Excel de ravitaillements.**
      Vérifié — `src/utils/excelUtils.js` est l'import/export des **clients**
      (`exportClientsToXLSM`), appelé par `useExcelOperations`, et aucun écran
      de l'espace dealer ne propose de téléchargement. Le critère supposait un
      export qui n'a jamais été écrit. Rien n'a donc changé ici, et rien ne
      devait changer ; c'est consigné plutôt que coché.*
- [x] Les identifiants techniques ne changent pas : `dealerRequests`,
      `requestType`, `stock_add`, `liquidity_add`, `DEALER_REQUEST_STATUSES`
      restent tels quels. Aucun champ Firestore n'est renommé.
- [x] Les tests de S1 sont mis à jour **explicitement** là où ils portent sur un
      libellé visible, et le commit dit lesquels et pourquoi.
      *(`tc-200` — les tests de S1 — n'ont pas eu à bouger. **Une seule**
      assertion change dans tout le lot : `tc-080` [ET-03]. Elle avait été
      délibérément laissée intacte par le lot de restyle `c6a915f`, pour
      prouver que le redessin n'avait pas troqué la précision du vide filtré
      contre une jolie phrase ; elle change ici, d'UN mot, dans un lot de
      vocabulaire déclaré.)*
- [x] Aucune occurrence de « demande » ne subsiste dans l'espace dealer, sauf là où
      le mot désigne réellement une demande faite au dealer par une boutique.
      *(Relevé final : deux occurrences, toutes deux le VERBE « demander ».)*

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
