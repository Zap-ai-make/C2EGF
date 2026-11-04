import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  CHAMPS_ANNUAIRE,
  NOMBRE_TRANCHES,
  construireTranches,
  entreeAnnuaire,
  trancheDe,
} from '../../functions/src/clients/annuaireClients.js'
import { champsAgent } from '../../src/utils/agentFields.js'

/**
 * TC-340 — l'annuaire des clients, partie pure (docs/rester-dans-le-quota-gratuit.md §A1).
 *
 * ⚠ [TC-340-06] ET [TC-340-07] LISENT LE CODE SOURCE, ET C'EST VOULU. Le
 *   formulaire de modification se pré-remplit depuis la fiche de la liste puis
 *   réécrit chaque champ : un champ oublié dans l'annuaire serait EFFACÉ à la
 *   prochaine modification. Recopier la liste des champs ici la laisserait
 *   diverger en silence ; la lire dans `ClientForm.jsx` et `excelUtils.js` fait
 *   échouer ce test dès qu'un champ y est ajouté sans l'être à l'annuaire.
 */

/** Des identifiants à la façon de Firestore (20 caractères), reproductibles. */
function identifiants(nombre) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let graine = 42
  const hasard = () => {
    graine = (Math.imul(graine, 1103515245) + 12345) >>> 0
    return graine / 2 ** 32
  }
  return Array.from({ length: nombre }, () =>
    Array.from({ length: 20 }, () => alphabet[Math.floor(hasard() * alphabet.length)]).join(''))
}

describe('TC-340 — une fiche a toujours la même tranche', () => {
  it('[TC-340-01] la tranche est stable et nommée t00 à t63', () => {
    expect(trancheDe('abc')).toBe(trancheDe('abc'))
    for (const id of identifiants(500)) {
      expect(trancheDe(id)).toMatch(/^t\d{2}$/)
      expect(Number(trancheDe(id).slice(1))).toBeLessThan(NOMBRE_TRANCHES)
    }
  })

  it('[TC-340-02] 15 679 fiches se répartissent sans tranche démesurée', () => {
    const effectifs = new Map()
    for (const id of identifiants(15679)) {
      const t = trancheDe(id)
      effectifs.set(t, (effectifs.get(t) ?? 0) + 1)
    }
    expect(effectifs.size).toBe(NOMBRE_TRANCHES)
    // Moyenne attendue : 245. Une tranche au double serait renvoyée deux fois
    // plus lourde à chaque modification.
    expect(Math.max(...effectifs.values())).toBeLessThan(330)
    expect(Math.min(...effectifs.values())).toBeGreaterThan(170)
  })
})

describe('TC-340 — ce qu’une entrée garde d’une fiche', () => {
  it('[TC-340-03] les champs lus, vides et nuls compris ; rien d’autre', () => {
    const entree = entreeAnnuaire({
      nom: 'OUEDRAOGO', prenom: 'Salif', codeAgent: '', numeroAgent: null,
      localite: undefined, registeredBy: 'uid-x', registeredByEmail: 'x@y', updatedAt: 'hier',
    })
    expect(entree).toEqual({ nom: 'OUEDRAOGO', prenom: 'Salif', codeAgent: '', numeroAgent: null })
  })

  it('[TC-340-04] une clé vide reste là : `champsAgent` ne relit pas l’ancien `orange`', () => {
    const fiche = { nom: 'KABORE', prenom: 'Awa', codeAgent: '', orange: '1234567' }
    expect(champsAgent(entreeAnnuaire(fiche))).toEqual(champsAgent(fiche))
    expect(champsAgent(entreeAnnuaire(fiche)).codeAgent).toBe('')
  })

  it('[TC-340-05] toutes les tranches existent, et chaque fiche est dans la sienne', () => {
    const fiches = identifiants(300).map((id, i) => ({ id, donnees: { nom: `N${i}`, prenom: 'P' } }))
    const tranches = construireTranches(fiches)
    expect(tranches.size).toBe(NOMBRE_TRANCHES)
    for (const { id } of fiches) expect(tranches.get(trancheDe(id))[id]).toBeDefined()
    const total = [...tranches.values()].reduce((n, t) => n + Object.keys(t).length, 0)
    expect(total).toBe(300)
  })
})

describe('TC-340 — l’annuaire porte tout ce que l’application lit', () => {
  it('[TC-340-06] chaque champ du formulaire de fiche', () => {
    const source = readFileSync('src/components/ClientForm.jsx', 'utf8')
    const vide = source.match(/const EMPTY_CLIENT_FORM = \{([\s\S]*?)\n\}/)
    expect(vide, 'EMPTY_CLIENT_FORM introuvable dans ClientForm.jsx').not.toBeNull()
    const champsVides = [...vide[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1])
    const champsPreremplis = [...source.matchAll(/initialData\.(\w+)/g)].map((m) => m[1])
      .filter((c) => c !== 'id')
    expect(champsVides.length).toBeGreaterThan(5)
    for (const champ of new Set([...champsVides, ...champsPreremplis])) {
      expect(CHAMPS_ANNUAIRE, `« ${champ} » manque à l’annuaire`).toContain(champ)
    }
  })

  it('[TC-340-07] chaque champ de l’export Excel, et ceux du tri et du code agent', () => {
    const source = readFileSync('src/utils/excelUtils.js', 'utf8')
    const debut = source.indexOf('export const exportClientsToXLSM')
    const corps = source.slice(debut, source.indexOf('\n}', debut))
    const champsExport = [...corps.matchAll(/client\.(\w+)/g)].map((m) => m[1])
    expect(champsExport.length).toBeGreaterThan(5)
    // `resolveClientStoreName`, le tri par date d'enregistrement
    // (`ClientsContext.jsx`) et `champsAgent` lisent aussi ceux-ci.
    for (const champ of new Set([...champsExport, 'registeredStoreName', 'registeredStoreId', 'createdAt', 'dateAjout', 'orange', 'codeAgent', 'numeroAgent'])) {
      expect(CHAMPS_ANNUAIRE, `« ${champ} » manque à l’annuaire`).toContain(champ)
    }
  })

  it('[TC-340-08] une tranche pleine reste loin du plafond de 1 Mio d’un document', () => {
    const fiches = identifiants(15679).map((id, i) => ({
      id,
      donnees: {
        nom: 'TIENDREBEOGO-OUEDRAOGO', prenom: 'Marie-Bernadette', numeroIdentite: 'B12345678',
        numeroPersonnel: '70 12 34 56 / 76 54 32 10', codeAgent: String(1000000 + i), numeroAgent: '70123456',
        orange: String(1000000 + i), localite: 'Ouagadougou secteur 30', agentCommercial: 'SAWADOGO Issouf',
        registeredStoreId: 'boutique-ouaga-centre-0001', registeredStoreName: 'Boutique Ouaga Centre', dateAjout: '12/10/2026',
      },
    }))
    const plusLourde = Math.max(...[...construireTranches(fiches).values()].map((t) => JSON.stringify(t).length))
    expect(plusLourde).toBeLessThan(200 * 1024)
  })
})
