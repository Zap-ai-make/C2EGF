/**
 * banc.mjs — le serveur Vite éphémère du banc d'essai visuel.
 *
 * Partagé par tous les scripts de capture. Il pose UNE chose que la config du
 * projet n'a pas : les doublures d'accès aux données. Certains écrans lisent
 * Firestore au montage ; sans substitution, le banc ne peut pas les afficher, et
 * ce sont justement les écrans qu'on aurait le plus besoin de regarder.
 *
 * L'alias vit ICI, et pas dans vite.config.js, pour une raison simple : un alias
 * de configuration s'appliquerait à TOUTE la construction, y compris celle qui
 * part en production. Ici, il ne peut atteindre que le serveur éphémère de la
 * capture — et `preview.html` n'est de toute façon pas une entrée de build.
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createServer } from 'vite'

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const DOUBLURES = [
  ['services/storeAdminDealerService', 'src/preview-doubles/storeAdminDealerService.js'],
  // Le poste dealer (?espace=dealer) : ses cuves, ses compteurs, ses 84 caisses.
  // Les trois règles sont disjointes — `services/dealerService` n'apparaît pas
  // dans le chemin de `services/storeAdminDealerService` —, donc l'ordre est
  // sans effet ici. Il le deviendrait si l'un devenait le préfixe d'un autre.
  ['services/storeTransferService', 'src/preview-doubles/storeTransferService.js'],
  ['services/dealerService', 'src/preview-doubles/dealerService.js'],
]

export async function ouvrirBanc() {
  const serveur = await createServer({
    root: racine,
    server: { port: 0 },
    logLevel: 'error',
    resolve: {
      alias: DOUBLURES.map(([cible, doublure]) => ({
        find: new RegExp(`.*${cible.replace('/', '\\/')}(\\.js)?$`),
        replacement: path.join(racine, doublure),
      })),
    },
  })
  await serveur.listen()
  const { port } = serveur.httpServer.address()
  return { serveur, url: `http://localhost:${port}/preview.html` }
}
