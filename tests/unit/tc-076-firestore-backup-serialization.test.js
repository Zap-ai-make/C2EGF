// @vitest-environment node
/**
 * TC-076 — Sérialisation NDJSON du backup de remise à zéro.
 *
 * Vérifie l'aller-retour serializeValue/reviveValue (Timestamps, imbrication,
 * tableaux, docrefs, geopoints) et l'écriture/lecture NDJSON sur disque.
 */

import { describe, it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  serializeValue,
  reviveValue,
  NdjsonWriter,
  readNdjson,
} from '../../scripts/lib/firestoreBackup.mjs'

// Doubles structurels des types Firestore (duck-typing, sans SDK).
class FakeTimestamp {
  constructor(seconds, nanoseconds) {
    this.seconds = seconds
    this.nanoseconds = nanoseconds
  }
  toDate() { return new Date(this.seconds * 1000) }
}

class FakeGeoPoint {
  constructor(latitude, longitude) {
    this.latitude = latitude
    this.longitude = longitude
  }
  isEqual() { return false }
}

function fakeDocRef(path) {
  return { path, firestore: {}, get: () => {} }
}

const sdk = {
  Timestamp: FakeTimestamp,
  GeoPoint: FakeGeoPoint,
  db: { doc: (path) => fakeDocRef(path) },
}

describe('TC-076 — serializeValue / reviveValue', () => {
  it('préserve les scalaires et null', () => {
    expect(serializeValue(42)).toBe(42)
    expect(serializeValue('abc')).toBe('abc')
    expect(serializeValue(null)).toBeNull()
    expect(serializeValue(true)).toBe(true)
  })

  it('encode un Timestamp et le restaure à l’identique', () => {
    const ts = new FakeTimestamp(1752932733, 21000000)
    const encoded = serializeValue(ts)
    expect(encoded).toEqual({ __type: 'timestamp', seconds: 1752932733, nanoseconds: 21000000 })

    const revived = reviveValue(encoded, sdk)
    expect(revived).toBeInstanceOf(FakeTimestamp)
    expect(revived.seconds).toBe(1752932733)
    expect(revived.nanoseconds).toBe(21000000)
  })

  it('encode un document imbriqué complet (solde réseau) aller-retour', () => {
    const doc = {
      balances: {
        Orange: { stock: 150000, liquidite: 75000 },
        Moov: { stock: 0, liquidite: 0 },
      },
      updatedAt: new FakeTimestamp(1700000000, 0),
      tags: ['a', 'b'],
      ref: fakeDocRef('stores/S1'),
      position: new FakeGeoPoint(12.37, -1.53),
    }

    const encoded = serializeValue(doc)
    // Le résultat doit être du JSON pur (sérialisable sans perte).
    const roundTrippedJson = JSON.parse(JSON.stringify(encoded))
    expect(roundTrippedJson).toEqual(encoded)

    const revived = reviveValue(roundTrippedJson, sdk)
    expect(revived.balances).toEqual({ Orange: { stock: 150000, liquidite: 75000 }, Moov: { stock: 0, liquidite: 0 } })
    expect(revived.updatedAt).toBeInstanceOf(FakeTimestamp)
    expect(revived.tags).toEqual(['a', 'b'])
    expect(revived.ref.path).toBe('stores/S1')
    expect(revived.position).toBeInstanceOf(FakeGeoPoint)
    expect(revived.position.latitude).toBe(12.37)
  })

  it('gère les tableaux de Timestamps', () => {
    const encoded = serializeValue([new FakeTimestamp(1, 2), new FakeTimestamp(3, 4)])
    const revived = reviveValue(encoded, sdk)
    expect(revived).toHaveLength(2)
    expect(revived[0].seconds).toBe(1)
    expect(revived[1].nanoseconds).toBe(4)
  })
})

describe('TC-076 — NdjsonWriter / readNdjson', () => {
  it('écrit et relit des documents, compte exact', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'akayis-backup-test-'))
    try {
      const file = join(dir, 'drafts.ndjson')
      const writer = new NdjsonWriter(file)
      await writer.writeDoc('clients/S1/drafts/d1', { montant: 5000, createdAt: new FakeTimestamp(10, 0) })
      await writer.writeDoc('clients/S1/drafts/d2', { montant: 7000 })
      const count = await writer.close()
      expect(count).toBe(2)

      const lines = await readNdjson(file)
      expect(lines).toHaveLength(2)
      expect(lines[0].path).toBe('clients/S1/drafts/d1')
      expect(lines[0].data.createdAt).toEqual({ __type: 'timestamp', seconds: 10, nanoseconds: 0 })
      expect(lines[1].data.montant).toBe(7000)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuse d’écraser un fichier existant (flag wx)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'akayis-backup-test-'))
    try {
      const file = join(dir, 'dup.ndjson')
      const w1 = new NdjsonWriter(file)
      await w1.writeDoc('x/y', { a: 1 })
      await w1.close()

      const w2 = new NdjsonWriter(file)
      await expect(w2.writeDoc('x/z', { a: 2 }).then(() => w2.close())).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
