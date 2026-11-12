/**
 * TC-375 — Axe OXYGEN du profil → config functions (oxygenProfile).
 *
 * La liaison d'un agent à l'app Oxygen (contrat C:\dev\oxygen\docs\contrats\liaison-agent.md,
 * version 3) répond pour UN distributeur : `distributeurId` et son nom sont des
 * données client, donc un axe du profil, jamais une constante écrite dans le
 * handler (AGENTS.md : « ajouter un axe = un champ nommé dans _pilot.js »).
 *
 * Ce test verrouille :
 *   • C2EGF : activé, distributeurId « c2egf », nom « C2EGF » ;
 *   • le pilote l'active (opt-out), TAOFIC le désactive — rien ne change chez un
 *     client qui n'a rien demandé (docs/client-profiles.md §8) ;
 *   • le refus d'un profil incomplet (aucun défaut silencieux) ;
 *   • ANTI-DÉRIVE : oxygenProfile.js commité == régénéré pour C2EGF.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveProfile } from '../../config/clients/index.js'
import { generateOxygenProfileFile } from '../../scripts/lib/generateOxygenProfile.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const oxygenProfilePath = resolve(__dirname, '../../functions/src/config/oxygenProfile.js')

const valide = { oxygen: { enabled: true, distributeurId: 'c2egf', nomDistributeur: 'C2EGF' } }

describe('TC-375 — profil Oxygen', () => {
  it('[TC-375-01] C2EGF répond pour lui-même, sous l’identifiant « c2egf »', () => {
    const genere = generateOxygenProfileFile(resolveProfile('c2egf_burkina'))
    expect(genere).toContain('export const OXYGEN_ENABLED = true')
    expect(genere).toContain("export const OXYGEN_DISTRIBUTEUR_ID = 'c2egf'")
    expect(genere).toContain("export const OXYGEN_NOM_DISTRIBUTEUR = 'C2EGF'")
  })

  it('[TC-375-02] le pilote l’active (opt-out)', () => {
    expect(resolveProfile('_pilot').oxygen.enabled).toBe(true)
  })

  it('[TC-375-03] TAOFIC ne le reçoit pas : aucun client ne change sans l’avoir demandé', () => {
    expect(resolveProfile('taofic_ajagbe').oxygen.enabled).toBe(false)
    expect(generateOxygenProfileFile(resolveProfile('taofic_ajagbe')))
      .toContain('export const OXYGEN_ENABLED = false')
  })

  it('[TC-375-04] refuse un drapeau qui n’est pas un booléen', () => {
    expect(() => generateOxygenProfileFile({ oxygen: { ...valide.oxygen, enabled: 'oui' } }))
      .toThrow(/oxygen\.enabled/)
  })

  it('[TC-375-05] refuse un distributeurId hors du format d’échange', () => {
    for (const distributeurId of ['', 'C2EGF', 'c2 egf', "c2'egf", undefined]) {
      expect(() => generateOxygenProfileFile({ oxygen: { ...valide.oxygen, distributeurId } }))
        .toThrow(/oxygen\.distributeurId/)
    }
  })

  it('[TC-375-06] refuse un nom vide ou porteur d’une apostrophe non échappable', () => {
    for (const nomDistributeur of ['', '  ', undefined, "L'Agence"]) {
      expect(() => generateOxygenProfileFile({ oxygen: { ...valide.oxygen, nomDistributeur } }))
        .toThrow(/oxygen\.nomDistributeur/)
    }
  })

  it('[TC-375-07] ANTI-DÉRIVE : le fichier commité est celui de C2EGF', () => {
    const commite = readFileSync(oxygenProfilePath, 'utf8').replace(/\r\n/g, '\n')
    expect(commite).toBe(generateOxygenProfileFile(resolveProfile('c2egf_burkina')))
  })
})
