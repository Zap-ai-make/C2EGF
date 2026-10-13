/**
 * importerNumerosAgent.mjs — compléter le « Numéro agent » des fiches existantes.
 *
 * APERÇU PAR DÉFAUT. Sans `--execute`, ce script ne touche à rien : il lit le
 * fichier, lit la base, et décrit ligne par ligne ce qui se passerait.
 *
 * CE QU'IL FAIT, ET RIEN D'AUTRE
 * ──────────────────────────────
 *   · retrouve la fiche par CORRESPONDANCE EXACTE du code agent, zéros compris ;
 *   · remplit le numéro agent SEULEMENT s'il est vide ;
 *   · ne crée aucune fiche, ne rapproche jamais par le nom ;
 *   · n'efface rien — `numeroPersonnel` et l'ancien `orange` restent intacts ;
 *   · signale conflits, codes introuvables, codes répétés et codes ambigus.
 *
 * ⚠ CE SCRIPT GARDE SON NOM ALORS QUE SA MÉCANIQUE A ÉTÉ MISE EN COMMUN avec
 *   `importerAgentsCommerciaux.mjs` : les imports déjà passés en production ont
 *   affiché « Pour annuler : node scripts/importerNumerosAgent.mjs --annuler=… »,
 *   et cette ligne doit continuer de marcher telle quelle.
 *
 * Usage :
 *   node scripts/importerNumerosAgent.mjs --dossier=numeros-agent
 *   node scripts/importerNumerosAgent.mjs --fichier=numeros.xlsx
 *   node scripts/importerNumerosAgent.mjs --fichier=lot1.xlsx --fichier=lot2.xlsx
 *   node scripts/importerNumerosAgent.mjs --fichier=numeros.csv --csv=apercu.csv
 *   node scripts/importerNumerosAgent.mjs --dossier=numeros-agent --execute --allow-production
 *   node scripts/importerNumerosAgent.mjs --annuler=backups/import-numeros-... --execute --allow-production
 *
 * Options, verrous et annulation : voir `scripts/lib/executerImportAgent.mjs`.
 */

import { executerImportAgent } from './lib/executerImportAgent.mjs'
import { CHAMP_NUMERO } from './lib/champsImportables.mjs'

await executerImportAgent(CHAMP_NUMERO)
