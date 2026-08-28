/**
 * tc-094 — aucune animation ne s'impose à qui a demandé le calme.
 *
 * `DESIGN.md` §9 : « `prefers-reduced-motion` respecté, TOUJOURS. » Le dépôt
 * avait déjà choisi son mécanisme — la variante `motion-safe:` de Tailwind, que
 * le compilateur traduit en `@media (prefers-reduced-motion: no-preference)`.
 * Quatre animations l'utilisaient ; SEIZE y échappaient, dont six dans des
 * zones que le bilan déclarait terminées. Une convention qu'on applique à la
 * main s'oublie — ce test la rend vérifiable.
 *
 * LA RÈGLE EST PLUS LARGE QU'ELLE N'EN A L'AIR, ET C'EST VOULU.
 * Elle interdit le nom nu de l'utilitaire PARTOUT — pas seulement sur un
 * élément : aussi dans une chaîne d'assertion, aussi dans un commentaire.
 *
 * Ce n'est pas du zèle. Tailwind v4 détecte ses classes en lisant le TEXTE BRUT
 * des fichiers du dépôt ; il ne sait pas distinguer une classe posée sur un
 * `<div>` d'une classe citée en prose. Trois mentions oubliées — une phrase de
 * documentation dans `SkeletonList.jsx`, deux `querySelector` dans les tests —
 * suffisaient à faire naître dans le CSS livré des règles d'animation
 * INCONDITIONNELLES, hors de toute media query, donc actives pour la personne
 * même qui avait demandé le calme.
 *
 * Le défaut était parfaitement invisible : les tests passaient, le lint aussi,
 * et il fallait lire le CSS construit pour le voir. D'où la portée du test — il
 * lit ce que Tailwind lit, commentaires compris, et il balaie `tests/` comme
 * `src/`, parce que Tailwind ne fait pas la différence.
 *
 * Écrire à propos d'une animation reste possible : on la nomme en français
 * (« la pulsation », « la rotation »), ou avec son préfixe. Ce qu'on ne peut
 * plus faire, c'est écrire le jeton nu — parce que l'écrire, c'est le créer.
 *
 * Ce test n'assère AUCUNE classe de présentation : il ne dit pas de quoi
 * l'interface a l'air.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BALAYES = ['src', 'tests']

/**
 * Un utilitaire d'animation Tailwind que ne précède pas la variante qui le rend
 * optionnel. On lit le texte brut, sans retirer les commentaires : Tailwind ne
 * les retire pas non plus.
 */
const NON_PROTEGEE = /(?<!motion-safe:)(?<!motion-reduce:)(?<![\w-])animate-[a-z][a-z-]*/g

/** Ce fichier se cite lui-même en exemple ; il ne peut donc pas se juger. */
const SOI_MEME = path.join(RACINE, 'tests', 'unit', path.basename(fileURLToPath(import.meta.url)))

function fichiersSource(racine) {
  return readdirSync(racine).flatMap((entree) => {
    const complet = path.join(racine, entree)
    if (statSync(complet).isDirectory()) return fichiersSource(complet)
    return /\.jsx?$/.test(entree) ? [complet] : []
  })
}

describe('tc-094 — couverture du mouvement réduit', () => {
  it('ne laisse aucun utilitaire d’animation hors de `motion-safe:`', () => {
    const echappees = []

    for (const dossier of BALAYES) {
      for (const fichier of fichiersSource(path.join(RACINE, dossier))) {
        if (fichier === SOI_MEME) continue

        readFileSync(fichier, 'utf8').split('\n').forEach((ligne, index) => {
          for (const trouvee of ligne.matchAll(NON_PROTEGEE)) {
            echappees.push(
              `${path.relative(RACINE, fichier).split(path.sep).join('/')}:${index + 1} → ${trouvee[0]}`
            )
          }
        })
      }
    }

    expect(
      echappees,
      `Utilitaires d’animation sans garde-fou :\n  ${echappees.join('\n  ')}\n`
    ).toEqual([])
  })
})
