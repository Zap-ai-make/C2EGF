/**
 * importerAgentsCommerciaux.mjs — compléter l'« Agent commercial » des fiches.
 *
 * APERÇU PAR DÉFAUT. Sans `--execute`, ce script ne touche à rien : il lit le
 * fichier, lit la base, et décrit ligne par ligne ce qui se passerait.
 *
 * LE FICHIER ATTENDU : DEUX COLONNES
 * ──────────────────────────────────
 *   · « Code agent »      — sert à RETROUVER la fiche. Jamais modifié.
 *   · « Agent commercial » — le nom du commercial C2EGF qui suit ce client.
 *
 * CE QU'IL FAIT, ET RIEN D'AUTRE
 * ──────────────────────────────
 *   · retrouve la fiche par CORRESPONDANCE EXACTE du code agent, zéros compris ;
 *   · remplit l'agent commercial SEULEMENT s'il est vide ;
 *   · ne crée aucune fiche, ne rapproche jamais par le nom du client ;
 *   · ne touche à aucun autre champ — ni numéro agent, ni code agent, ni `orange` ;
 *   · signale conflits, codes introuvables, codes répétés et codes ambigus.
 *
 * CE QU'IL AJOUTE PAR RAPPORT À L'IMPORT DE NUMÉROS
 * ─────────────────────────────────────────────────
 * Un nom n'a pas de forme qui le valide : « KONE » et « OUEDRAOGO W. J.-B. » sont
 * tous deux justes, et une faute de frappe est un nom valide. Deux contrôles la
 * rattrapent, et ils sont dans l'aperçu :
 *
 *   · L'ALIGNEMENT SUR LA BASE. Quand une orthographe DOMINE STRICTEMENT en base,
 *     le fichier est aligné dessus. Le tableau de bord groupe les commerciaux par
 *     la chaîne exacte : écrire « ouedraogo s. » à côté de 300 « OUEDRAOGO S. »
 *     créerait un second commercial, avec une part du portefeuille de l'autre.
 *   · LA RÉPARTITION ET LES NOMS NOUVEAUX. Ligne par ligne, « OUEDRAGO S. » passe
 *     tous les contrôles. Au regroupement, il apparaît comme un commercial de
 *     plus, avec une fiche au compteur : c'est là, et seulement là, qu'il se voit.
 *
 * Usage :
 *   node scripts/importerAgentsCommerciaux.mjs --dossier=commerciaux
 *   node scripts/importerAgentsCommerciaux.mjs --fichier=commerciaux.xlsx --csv=apercu.csv
 *   node scripts/importerAgentsCommerciaux.mjs --dossier=commerciaux --execute --allow-production
 *   node scripts/importerAgentsCommerciaux.mjs --annuler=backups/import-commerciaux-... --execute --allow-production
 *
 * Options, verrous et annulation : voir `scripts/lib/executerImportAgent.mjs`.
 */

import { executerImportAgent } from './lib/executerImportAgent.mjs'
import { CHAMP_COMMERCIAL } from './lib/champsImportables.mjs'

await executerImportAgent(CHAMP_COMMERCIAL)
