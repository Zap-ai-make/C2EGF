# S7 — La règle qui empêche l'arc-en-ciel de revenir

```
Statut     : à faire
Périmètre  : post-MVP
Dépend de  : S6
```

---

## Objectif

Une fois les 144 couleurs hors palette retirées de l'espace dealer, empêcher qu'un
composant distrait les réintroduise. Le lint dit non avant la revue, pas après.

---

## Critères d'acceptation

- [ ] Une règle `no-restricted-syntax` (ou équivalent) refuse les familles de
      couleurs Tailwind brutes — `green`, `red`, `blue`, `orange`, `teal`, `amber`,
      `purple`, `indigo`, `yellow`, `emerald`, `pink` — dans `src/`.
- [ ] Le message d'erreur **nomme le jeton à employer à la place**. Une règle qui
      dit seulement « interdit » se contourne ; une règle qui dit « utilise
      `inflow` » enseigne.
- [ ] `constants/networkConfig.js` est excepté tant que ses couleurs d'opérateur y
      vivent : ce sont des données d'identité, pas du chrome
      (`REFONTE.md` §4 C et F).
- [ ] `npm run lint` est propre sur l'ensemble du dépôt après la règle — sinon la
      règle est posée trop tôt.

---

## Hors périmètre

Corriger les espaces que la règle ferait crier. Si `src/pages/admin/` sort du lint
avec 121 violations, **la règle attend** : elle se pose après le dernier lot de
restyle, pas avant. C'est exactement pourquoi cette spec est post-MVP et dépend
de S6.

Le sort des 42 couleurs de `networkConfig.js` : il se décide avec le sujet
« multi-réseau », pas dans un lot de restyle.

---

## Notes techniques

`REFONTE.md` §4 F pose la règle et son exception ; cette spec ne fait que l'exécuter.

Si l'espace admin n'est pas encore repris au moment de poser la règle, la restreindre
d'abord à `src/pages/dealer/`, `src/components/dealer/` et `src/layouts/` par une
surcharge de configuration, puis l'élargir quand l'admin suivra. Une règle partielle
qui tient vaut mieux qu'une règle totale désactivée.
