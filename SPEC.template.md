# S`<n>` — `<titre de la spec>`

> Gabarit. Copier ce fichier vers `specs/S<n>-<slug>.md` (cf. `WORKFLOW.md` §3) et remplacer les champs entre chevrons.

```
Statut     : à faire · en cours · terminée
Périmètre  : MVP · post-MVP
Dépend de  : <IDs des specs qui doivent exister avant, ou « aucune »>
```

---

## Objectif

Une à deux phrases, du point de vue de l'utilisateur : qui fait quoi, et quelle valeur il en tire. Pas de vocabulaire technique interne ici.

---

## Critères d'acceptation

Liste de conditions vérifiables qui disent quand la spec est réussie. Formulées de façon testable.

- [ ] `<condition observable 1>`
- [ ] `<condition observable 2>`
- [ ] les états sont couverts (vide, chargement, erreur) — cf. `DESIGN.md` §10
- [ ] les points de sécurité applicables sont respectés — cf. `SECURITY.md`

---

## Hors périmètre

Ce que cette spec ne fait pas (pour éviter le débordement et les ajouts improvisés). Ce qui est repoussé va au backlog.

---

## Notes techniques

Brèves : approche envisagée, composants/existant à réutiliser, points de sécurité ou de données sensibles à surveiller, décisions structurantes éventuelles. Le détail vit dans le code, pas ici.

---

Une fois la spec terminée : critères cochés, code vérifié (tests + rendu), revue des trois contrats passée, commit effectué, statut mis à jour dans `specs/ROADMAP.md`.
