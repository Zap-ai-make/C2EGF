/**
 * Sérialisation / désérialisation de documents Firestore pour sauvegarde NDJSON.
 *
 * Utilisé par resetDataToZero.mjs (export avant purge) et restoreFromBackup.mjs
 * (restauration). Aucune connexion Firebase ici hormis la détection de types :
 * les valeurs spéciales sont reconnues structurellement (duck-typing) pour rester
 * testable sans SDK.
 *
 * Format d'une ligne NDJSON : {"path":"clients/S1/drafts/d1","data":{...}}
 * Types spéciaux encodés :
 *   Timestamp          → { "__type": "timestamp", "seconds": n, "nanoseconds": n }
 *   DocumentReference  → { "__type": "docref", "path": "..." }
 *   GeoPoint           → { "__type": "geopoint", "latitude": n, "longitude": n }
 */

import { createWriteStream } from 'node:fs'
import { once } from 'node:events'

function isTimestampLike(value) {
  return typeof value.toDate === 'function' &&
    typeof value.seconds === 'number' &&
    typeof value.nanoseconds === 'number'
}

function isDocRefLike(value) {
  return typeof value.path === 'string' && value.firestore !== undefined && typeof value.get === 'function'
}

function isGeoPointLike(value) {
  return typeof value.latitude === 'number' && typeof value.longitude === 'number' &&
    typeof value.isEqual === 'function'
}

/** Convertit récursivement les valeurs Firestore en JSON pur restaurable. */
export function serializeValue(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(serializeValue)
  if (isTimestampLike(value)) {
    return { __type: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds }
  }
  if (isDocRefLike(value)) {
    return { __type: 'docref', path: value.path }
  }
  if (isGeoPointLike(value)) {
    return { __type: 'geopoint', latitude: value.latitude, longitude: value.longitude }
  }
  const out = {}
  for (const [k, v] of Object.entries(value)) out[k] = serializeValue(v)
  return out
}

/**
 * Reconvertit le JSON du backup vers des valeurs Firestore.
 * @param {object} value valeur désérialisée depuis le NDJSON
 * @param {{ Timestamp: object, GeoPoint: object, db: object }} sdk classes du SDK Admin + instance Firestore
 */
export function reviveValue(value, sdk) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => reviveValue(v, sdk))
  if (value.__type === 'timestamp') {
    return new sdk.Timestamp(value.seconds, value.nanoseconds)
  }
  if (value.__type === 'docref') {
    return sdk.db.doc(value.path)
  }
  if (value.__type === 'geopoint') {
    return new sdk.GeoPoint(value.latitude, value.longitude)
  }
  const out = {}
  for (const [k, v] of Object.entries(value)) out[k] = reviveValue(v, sdk)
  return out
}

/** Écrit des documents en flux NDJSON, une ligne { path, data } par document. */
export class NdjsonWriter {
  constructor(filePath) {
    this.filePath = filePath
    this.stream = createWriteStream(filePath, { flags: 'wx', encoding: 'utf8' })
    this.count = 0
  }

  async writeDoc(path, data) {
    const line = JSON.stringify({ path, data: serializeValue(data) }) + '\n'
    this.count += 1
    if (!this.stream.write(line)) {
      await once(this.stream, 'drain')
    }
  }

  async close() {
    this.stream.end()
    await once(this.stream, 'close')
    return this.count
  }
}

/** Lit un fichier NDJSON et retourne la liste { path, data } (data non revivée). */
export async function readNdjson(filePath) {
  const { readFile } = await import('node:fs/promises')
  const content = await readFile(filePath, 'utf8')
  return content
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
}
