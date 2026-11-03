/**
 * TC-325 — `check:audit` ne déclare pas périmée une exception sur un seul audit
 * qui ne l'a pas vue.
 *
 * Constat du 3 novembre 2026 (audit QUA-08) : deux fois sur deux, la première
 * passe de `check:audit` après un `npm install` a annoncé l'exception
 * `@grpc/grpc-js` « devenue inutile — à RETIRER ». Les passes suivantes l'ont
 * trouvée active, et six réponses brutes de `npm audit` capturées contenaient
 * bien l'avis. Une réponse a donc manqué l'avis une fois. Le script échouait,
 * ce qui est prudent, mais son message poussait à retirer une exception
 * encore nécessaire.
 *
 * La logique vit dans `scripts/lib/analyseAudit.mjs`, sans `npm` : l'audit est
 * une fonction passée en paramètre, que ces tests remplacent.
 */

import { describe, it, expect } from 'vitest'
import { analyserAudit, confirmerAudit, lireRapport } from '../../scripts/lib/analyseAudit.mjs'

const GRPC = {
  avis: 'GHSA-m9gg-hp2v-232j',
  paquet: '@grpc/grpc-js',
  repertoires: ['.'],
  depuis: '2026-10-23',
  retirer: 'dès que @firebase/firestore déclarera @grpc/grpc-js >= 1.13.6',
}

/** La forme réelle d'un rapport `npm audit --json` (v2), relevée le 3 novembre 2026. */
const rapportAvecGrpc = () => ({
  auditReportVersion: 2,
  vulnerabilities: {
    '@firebase/firestore': { name: '@firebase/firestore', severity: 'high', via: ['@grpc/grpc-js'] },
    '@grpc/grpc-js': {
      name: '@grpc/grpc-js',
      severity: 'high',
      via: [
        { url: 'https://github.com/advisories/GHSA-m9gg-hp2v-232j', severity: 'high', title: 'getAuthContext' },
        { url: 'https://github.com/advisories/GHSA-f596-whhp-79r4', severity: 'low', title: 'messages d’erreur' },
      ],
    },
  },
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0, total: 2 } },
})

const rapportVide = () => ({
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
})

/** Un audit simulé qui rend, dans l'ordre, les rapports donnés. */
const auditSuccessif = (...rapports) => {
  const appels = []
  const auditer = () => {
    appels.push(appels.length + 1)
    return rapports[Math.min(appels.length, rapports.length) - 1]
  }
  return { auditer, appels }
}

describe('TC-325 — exceptions d’audit', () => {
  it('[AE-01] un avis listé est une exception active, son avis « low » voisin ne bloque pas', () => {
    const analyse = analyserAudit(rapportAvecGrpc(), [GRPC])

    expect(analyse.actives.map((e) => e.avis)).toEqual(['GHSA-m9gg-hp2v-232j'])
    expect(analyse.perimees).toEqual([])
    expect(analyse.bloquants).toEqual([])
    expect(analyse.recus).toBe(2)
  })

  it('[AE-02] un avis haut sans exception bloque', () => {
    const analyse = analyserAudit(rapportAvecGrpc(), [])

    expect(analyse.bloquants).toHaveLength(1)
    expect(analyse.bloquants[0]).toContain('GHSA-m9gg-hp2v-232j')
  })

  it('[AE-03] un audit qui manque l’avis une fois est relancé, et l’exception reste active', () => {
    const { auditer, appels } = auditSuccessif(rapportVide(), rapportAvecGrpc())

    const resultat = confirmerAudit(auditer, [GRPC])

    expect(appels).toHaveLength(2)
    expect(resultat.perimees).toEqual([])
    expect(resultat.actives.map((e) => e.avis)).toEqual(['GHSA-m9gg-hp2v-232j'])
  })

  it('[AE-04] absente de deux audits de suite, l’exception est périmée, et le compte reçu est rendu', () => {
    const { auditer, appels } = auditSuccessif(rapportVide(), rapportVide())

    const resultat = confirmerAudit(auditer, [GRPC])

    expect(appels).toHaveLength(2)
    expect(resultat.perimees.map((e) => e.avis)).toEqual(['GHSA-m9gg-hp2v-232j'])
    expect(resultat.recus).toBe(0)
  })

  it('[AE-05] un audit complet du premier coup n’est pas relancé', () => {
    const { auditer, appels } = auditSuccessif(rapportAvecGrpc())

    confirmerAudit(auditer, [GRPC])

    expect(appels).toHaveLength(1)
  })

  it('[AE-06] une sortie vide, illisible ou sans `metadata` est refusée, jamais lue comme « aucun avis »', () => {
    expect(lireRapport('').erreur).toMatch(/aucune sortie/)
    expect(lireRapport('{ pas du json').erreur).toMatch(/illisible/)
    expect(lireRapport(JSON.stringify({ error: { code: 'ENOAUDIT' } })).erreur).toMatch(/incomplet/)
    expect(lireRapport(JSON.stringify(rapportAvecGrpc())).rapport.metadata.vulnerabilities.total).toBe(2)
  })
})
