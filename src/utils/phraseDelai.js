/** Un accord au pluriel, pour les phrases comptées de ce fichier. */
const s = (n) => (n > 1 ? 's' : '')

/**
 * Ce que l'écran ET le message WhatsApp disent du délai — UNE SEULE ÉCRITURE.
 *
 * CE QUE CE FICHIER RÉSOUT (ronde de correction 1, I-3)
 * ──────────────────────────────────────────────────────
 * `PatronHistoriqueClient.jsx` et `ficheWhatsApp.js` portaient chacun leur
 * propre copie de cette phrase, reliées par un commentaire disant « corrige
 * l'un, corrige l'autre ». C'est l'aveu que rien ne le garantissait : reformuler
 * l'écran demain aurait laissé les deux textes diverger en silence, et le test
 * `tc-269-12` recopiait la phrase attendue à la main — il serait resté vert
 * pendant la divergence. Toute correction de cette phrase se fait ICI, une
 * seule fois ; l'écran rend `titre`/`detail` dans deux `<p>`, le message les
 * joint par un tiret.
 *
 * ⚠ `jours === null` VEUT DIRE « AUCUN DÉPÔT MESURABLE », PAS « IL N'A JAMAIS
 *   FAIT ATTENDRE ». Depuis la tâche 5 (I-2), `delaiMoyen` ne mesure que les
 *   dépôts : un agent avec vingt retraits impayés et zéro dépôt tombe dans
 *   cette branche. Une phrase du genre « aucune de ses opérations n'a attendu
 *   de règlement » blanchirait exactement le client qu'on appelle pour se
 *   plaindre de lui.
 *
 * ⚠ « 0 j » DIT L'INVERSE DE CE QU'IL VEUT DIRE : `delaiMoyen` arrondit au
 *   jour, donc tout règlement sous 12 h donne zéro. Un agent réglé en 3 h
 *   afficherait « 0 j en moyenne », qui se lit comme un défaut et non comme
 *   une qualité (tâche 5, M-1).
 *
 * @param {{jours: number|null, mesurees: number, total: number}} [delai]
 * @returns {{titre: string, detail: string}}
 */
export function phraseDelai(delai) {
  const jours = delai?.jours ?? null
  const mesurees = delai?.mesurees ?? 0
  const total = delai?.total ?? 0

  if (jours === null) {
    return {
      titre: 'Jamais mesuré',
      // ⚠ « POUR L'INSTANT » N'EST PAS UNE FIORITURE. Sans lui, la phrase
      //   affirme plus que ce qu'on sait : la base peut porter de l'activité
      //   pas encore chargée (pagination), et seule cette réserve le dit.
      detail: total > 0
        ? `Aucun dépôt mesurable parmi les ${total} opération${s(total)} chargée${s(total)}.`
        : "Aucune opération chargée pour l'instant.",
    }
  }

  return {
    titre: jours === 0 ? "Moins d'un jour en moyenne" : `${jours} j en moyenne`,
    detail: `Sur ${mesurees} dépôt${s(mesurees)} mesuré${s(mesurees)} `
      + `sur ${total} opération${s(total)} chargée${s(total)}.`,
  }
}

export default phraseDelai
