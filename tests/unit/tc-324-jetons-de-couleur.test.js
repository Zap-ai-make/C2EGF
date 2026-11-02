/**
 * TC-324 — Une classe de couleur C2EGF nomme un jeton qui existe.
 *
 * Constat du 2 novembre 2026, en traitant UI-02 : `text-brand-700`,
 * `border-brand-300` et `hover:bg-brand-700` figuraient dans dix fichiers,
 * vingt-deux fois. La rampe de `src/index.css` n'a ni 300 ni 700 : Tailwind v4
 * ne produit alors AUCUNE règle, sans erreur ni avertissement. Le texte
 * héritait de la couleur du parent, la bordure prenait `currentColor` (la
 * carte « À confirmer » de l'assistant était cerclée de noir), le survol ne
 * faisait rien. Rien ne le montrait, sinon le CSS construit.
 *
 * La garde a trouvé de plus `bg-surface-2`, huit fois dans cinq fichiers depuis
 * le 8 octobre, jamais défini : lignes de groupe, en-têtes et encarts restaient
 * transparents. Le jeton est désormais défini dans `index.css`.
 *
 * Deux gardes, qui lisent les sources à la manière de TC-320 [CN-01] :
 *   - [JC-01] toute couleur d'une famille C2EGF (brand, ink, warn…) est
 *     définie dans `index.css` ;
 *   - [JC-02] la rampe neutre est `gray`, retintée par `index.css` vers le
 *     bleu de marque. `slate` la contourne et garde le gris de Tailwind : le
 *     panneau de l'assistant en employait 46, le tableau des clients 2
 *     (audit UI-02).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, it, expect } from 'vitest'

const FAMILLES_C2EGF = ['brand', 'canvas', 'surface', 'line', 'ink', 'inflow', 'outflow', 'success', 'warn', 'danger', 'pending', 'net']

const PROPRIETE = String.raw`(?:bg|text|border(?:-[trblxy])?|ring(?:-offset)?|outline|decoration|divide|placeholder|from|via|to|fill|stroke|accent|caret|shadow)`

function sources(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) return sources(chemin)
    return /\.(jsx?|mjs)$/.test(nom) ? [chemin] : []
  })
}

const jetons = new Set([...readFileSync('src/index.css', 'utf8').matchAll(/--color-([a-z0-9-]+)\s*:/g)].map(([, nom]) => nom))
const fichiers = sources('src').map((chemin) => ({ chemin: relative('.', chemin).replaceAll('\\', '/'), texte: readFileSync(chemin, 'utf8') }))

describe('TC-324 — jetons de couleur', () => {
  it('lit bien les jetons de index.css', () => {
    expect(jetons.has('brand-500')).toBe(true)
    expect(jetons.has('warn-soft')).toBe(true)
    expect(fichiers.length).toBeGreaterThan(100)
  })

  it('[JC-01] toute couleur d’une famille C2EGF est définie dans index.css', () => {
    const motif = new RegExp(String.raw`\b${PROPRIETE}-((?:${FAMILLES_C2EGF.join('|')})(?:-[a-z0-9]+)*)(?:\/\d+)?\b`, 'g')
    const absentes = fichiers.flatMap(({ chemin, texte }) =>
      [...texte.matchAll(motif)].filter(([, jeton]) => !jetons.has(jeton)).map(([classe]) => `${chemin} : ${classe}`))

    expect(absentes).toEqual([])
  })

  it('[JC-02] aucun `slate` : la rampe neutre de C2EGF est `gray`', () => {
    const motif = new RegExp(String.raw`\b${PROPRIETE}-slate-\d+`, 'g')
    const trouvees = fichiers.flatMap(({ chemin, texte }) => [...texte.matchAll(motif)].map(([classe]) => `${chemin} : ${classe}`))

    expect(trouvees).toEqual([])
  })
})
