/**
 * importNumerosAgent.mjs — compléter le « Numéro agent » des fiches existantes.
 *
 * PUR : aucune I/O, aucun Firebase, aucun tableur. `scripts/importerNumerosAgent.mjs`
 * apporte les lignes du fichier et les fiches de la base ; ce module ne fait que
 * décider, ligne par ligne. Même séparation que `fusionClients.mjs`, et pour la
 * même raison : une décision qui écrit en production doit pouvoir être éprouvée
 * cas par cas sans base ni fichier.
 *
 * TROIS CHAMPS DISTINCTS, ET ILS NE SE CONFONDENT JAMAIS
 * ──────────────────────────────────────────────────────
 *   · Code agent      — 7 chiffres en général. Sert à RETROUVER la fiche.
 *   · Numéro agent    — 8 chiffres. C'est ce qu'on AJOUTE.
 *   · Numéro personnel — le téléphone du commerçant. JAMAIS touché, jamais lu
 *                        comme un numéro agent. C'est une colonne piège : un
 *                        fichier qui la contient ne doit pas la voir prise pour
 *                        l'autre, d'où le refus explicite dans `trouverColonnes`.
 *
 * ⚠ CE QUE CE MODULE NE FAIT JAMAIS
 *   · créer une fiche — un code inconnu est signalé, pas inséré ;
 *   · rapprocher par le nom — seul le code agent identifie, à l'exact ;
 *   · écraser une valeur — un numéro déjà présent et différent est un CONFLIT ;
 *   · effacer quoi que ce soit, `orange` et `numeroPersonnel` compris.
 */

import { champsAgent } from '../../src/utils/agentFields.js'
import { plier } from './doublonsClients.mjs'

/** Les intitulés du formulaire, à la lettre. */
export const COLONNE_CODE = 'Code agent'
export const COLONNE_NUMERO = 'Numéro agent'
export const COLONNE_INTERDITE = 'Numéro personnel'

/** La longueur d'un numéro agent, reprise de l'application. */
export const LONGUEUR_NUMERO = 8

export const STATUTS = Object.freeze({
  A_COMPLETER: 'a-completer',
  INCHANGE: 'inchange',
  CONFLIT: 'conflit',
  NUMERO_IGNORE: 'numero-ignore',
  INTROUVABLE: 'introuvable',
  CODE_REPETE: 'code-repete',
  PLUSIEURS_CLIENTS: 'plusieurs-clients',
})

/** Les quatre seuls statuts qui écrivent... enfin, le seul. */
const ECRIT = new Set([STATUTS.A_COMPLETER])

const texte = (valeur) => (valeur === null || valeur === undefined ? '' : String(valeur))

/**
 * Le code agent d'une ligne de fichier : du TEXTE, zéros initiaux compris.
 *
 * ⚠ AUCUN REMPLISSAGE À GAUCHE ICI, CONTRAIREMENT AU NUMÉRO. La consigne autorise
 *   à compléter un numéro de 7 chiffres par un zéro ; elle ne dit rien du code, et
 *   pour une bonne raison : le numéro est VALIDÉ par sa longueur (8), alors que le
 *   code n'a pas de longueur garantie — la base en contient de 1 à 10 chiffres.
 *   Compléter un code à l'aveugle le ferait pointer vers la fiche d'un autre
 *   commerce, et l'import écrirait un numéro sur le mauvais client.
 *
 *   Le cas « Excel a mangé le zéro » est donc traité autrement : on cherche le
 *   code tel quel, et si on ne le trouve pas, `planifierImport` REGARDE si une
 *   variante zéro-complétée existe — et le dit, au lieu de le deviner.
 */
export const normaliserCodeAgent = (valeur) => texte(valeur).trim()

/** Ce qui sépare visiblement deux numéros dans une même case. */
const SEPARATEURS = /[/,;|]|\bet\b|\bou\b|\n/i

/**
 * Le numéro agent d'une ligne, ou le motif du refus.
 *
 * @returns {{numero: string}|{refus: string, detail: string}}
 *
 * ⚠ POURQUOI LES ESPACES INTÉRIEURS DISPARAISSENT AUSSI. La consigne dit « retire
 *   les espaces autour ». Mais « 01 23 45 67 » est UN numéro écrit avec des
 *   espaces, et le refuser ferait rejeter une saisie parfaitement lisible. Les
 *   enlever tous est sans risque ici parce que la LONGUEUR tranche ensuite : deux
 *   numéros collés par un espace (« 1234567 7654321 ») donnent 14 chiffres et
 *   sont refusés. L'espace ne peut donc pas servir à faire passer un multiple.
 *
 * ⚠ LE CAS MULTIPLE EST RÉEL, PAS THÉORIQUE. La base contient « 06629924/55772628 »
 *   et « 07796503/66553459/75928339 » dans des champs de numéro. Un tel contenu
 *   ne désigne pas un numéro agent : on l'ignore plutôt que d'en choisir un.
 */
export function normaliserNumeroAgent(valeur) {
  const brut = texte(valeur).trim()
  if (brut === '') return { refus: 'vide', detail: 'case vide' }

  if (SEPARATEURS.test(brut)) {
    return { refus: 'multiple', detail: `plusieurs numéros : « ${brut} »` }
  }

  const sansEspaces = brut.replace(/\s+/g, '')
  if (!/^\d+$/.test(sansEspaces)) {
    return { refus: 'non-numerique', detail: `caractères non numériques : « ${brut} »` }
  }

  // 7 chiffres → un zéro devant. C'est la seule complétion autorisée.
  const numero = sansEspaces.length === LONGUEUR_NUMERO - 1 ? `0${sansEspaces}` : sansEspaces
  if (numero.length !== LONGUEUR_NUMERO) {
    return { refus: 'longueur', detail: `${sansEspaces.length} chiffre(s) au lieu de 7 ou 8 : « ${brut} »` }
  }

  return { numero }
}

/**
 * Les fiches de la base rangées par code agent.
 *
 * ⚠ LE CODE EST LU PAR `champsAgent`, LA FONCTION DE L'ÉCRAN. Une fiche d'avant
 *   la séparation porte son identifiant dans `orange` ; `champsAgent` la range à
 *   la lecture, par la longueur. Réécrire cette règle ici ferait deux vérités, et
 *   l'import chercherait dans une base que la boutique ne voit pas.
 *
 *   Conséquence voulue : une fiche dont `orange` fait 8 chiffres est rangée comme
 *   un NUMÉRO agent, pas un code. Elle n'est donc pas trouvable par code — et
 *   c'est juste, puisqu'elle a déjà un numéro.
 */
export function indexerParCodeAgent(fiches = []) {
  const parCode = new Map()
  for (const fiche of fiches) {
    const { codeAgent } = champsAgent(fiche)
    if (!codeAgent) continue
    if (!parCode.has(codeAgent)) parCode.set(codeAgent, [])
    parCode.get(codeAgent).push(fiche)
  }
  return parCode
}

/**
 * Les deux colonnes attendues, trouvées dans les en-têtes réels du fichier.
 *
 * Le rapprochement se fait sur l'en-tête PLIÉ (sans accents, sans casse, espaces
 * réduits) : « Numero agent », « NUMÉRO AGENT  » et « Numéro Agent » sont le même
 * intitulé mal tapé, et refuser le fichier pour ça n'aiderait personne.
 *
 * ⚠ MAIS « NUMÉRO PERSONNEL » N'EST PAS « NUMÉRO AGENT ». Ce sont les deux
 *   colonnes les plus faciles à confondre, et les confondre écrirait le téléphone
 *   du commerçant dans sa case numéro agent — sur des milliers de fiches, sans
 *   qu'aucune règle de longueur ne s'en plaigne (les deux font 8 chiffres). Le
 *   rapprochement est donc EXACT après pliage, jamais par inclusion.
 *
 * @returns {{code: string, numero: string}|{erreur: string}}
 */
export function trouverColonnes(entetes = []) {
  const vus = entetes.map((e) => ({ brut: e, plie: plier(e) }))
  const chercher = (attendu) => vus.filter((v) => v.plie === plier(attendu))

  for (const [attendu, nom] of [[COLONNE_CODE, 'code'], [COLONNE_NUMERO, 'numéro']]) {
    const trouves = chercher(attendu)
    if (trouves.length === 0) {
      const personnel = chercher(COLONNE_INTERDITE)
      const indice = nom === 'numéro' && personnel.length > 0
        ? `\nLe fichier contient « ${personnel[0].brut} » : ce n'est PAS le numéro agent,`
          + ' ce sont deux champs distincts et aucun des deux ne remplace l\'autre.'
        : ''
      return {
        erreur: `Colonne « ${attendu} » absente.\nEn-têtes lus : ${entetes.map((e) => `« ${e} »`).join(', ') || '(aucun)'}${indice}`,
      }
    }
    if (trouves.length > 1) {
      return { erreur: `Colonne « ${attendu} » présente ${trouves.length} fois. Ambiguïté : fichier refusé.` }
    }
  }

  return { code: chercher(COLONNE_CODE)[0].brut, numero: chercher(COLONNE_NUMERO)[0].brut }
}

/** Le nom affichable d'une fiche, pour l'aperçu. */
const nomDe = (fiche) => `${fiche?.nom ?? ''} ${fiche?.prenom ?? ''}`.trim() || '(sans nom)'

/**
 * Ce que l'import ferait, ligne par ligne — et rien de plus.
 *
 * @param {Array<{code: string, numero: string, ligne: number}>} lignes
 * @param {Array<object>} fiches  les fiches de `globalClients`
 */
export function planifierImport(lignes = [], fiches = []) {
  const parCode = indexerParCodeAgent(fiches)

  // ⚠ LES RÉPÉTITIONS SE COMPTENT AVANT DE DÉCIDER. Un code présent deux fois
  //   dans le fichier est une erreur de fabrication du fichier : même si les deux
  //   lignes proposent le même numéro, les traiter ferait dépendre le résultat de
  //   l'ordre des lignes. On les signale toutes les deux et on n'écrit ni l'une ni
  //   l'autre — c'est aussi ce qui rend un second passage identique au premier.
  const occurrences = new Map()
  for (const { code } of lignes) {
    const c = normaliserCodeAgent(code)
    if (c) occurrences.set(c, (occurrences.get(c) || 0) + 1)
  }

  const resultats = []

  for (const brute of lignes) {
    const code = normaliserCodeAgent(brute.code)
    const base = { ligne: brute.ligne, code, nom: '', actuel: '', propose: '' }

    if (!code) {
      resultats.push({ ...base, statut: STATUTS.NUMERO_IGNORE, detail: 'code agent vide' })
      continue
    }

    const numero = normaliserNumeroAgent(brute.numero)
    if (numero.refus) {
      resultats.push({ ...base, statut: STATUTS.NUMERO_IGNORE, detail: numero.detail })
      continue
    }
    base.propose = numero.numero

    if (occurrences.get(code) > 1) {
      resultats.push({
        ...base,
        statut: STATUTS.CODE_REPETE,
        detail: `code présent ${occurrences.get(code)} fois dans le fichier`,
      })
      continue
    }

    const candidates = parCode.get(code)
    if (!candidates || candidates.length === 0) {
      // ⚠ LA SIGNATURE D'EXCEL. Un code stocké en NOMBRE dans le tableur a perdu
      //   son zéro initial avant même d'arriver ici — le fichier ne le contient
      //   plus. On ne le devine pas : on regarde si la variante zéro-complétée
      //   existe en base, et on le DIT. Deviner écrirait sur une fiche voisine.
      const variante = `0${code}`
      const indice = parCode.has(variante)
        ? ` — mais « ${variante} » existe en base : le tableur a probablement mangé le zéro initial.`
          + ' Reformater la colonne en TEXTE et réexporter.'
        : ''
      resultats.push({ ...base, statut: STATUTS.INTROUVABLE, detail: `aucune fiche avec ce code${indice}` })
      continue
    }

    if (candidates.length > 1) {
      resultats.push({
        ...base,
        nom: candidates.map(nomDe).join(' · '),
        statut: STATUTS.PLUSIEURS_CLIENTS,
        detail: `${candidates.length} fiches portent ce code : ${candidates.map((f) => f.id).join(', ')}`,
      })
      continue
    }

    const fiche = candidates[0]
    const actuelBrut = champsAgent(fiche).numeroAgent
    base.nom = nomDe(fiche)
    base.actuel = actuelBrut

    if (actuelBrut !== '') {
      // ⚠ COMPARAISON SUR LA FORME NORMALISÉE, PAS SUR LA CHAÎNE BRUTE. Sinon un
      //   espace résiduel ou un zéro manquant en base ferait un « conflit » là où
      //   il n'y a qu'une écriture différente du même numéro — et la boutique
      //   partirait vérifier à la main des centaines de faux problèmes.
      const actuel = normaliserNumeroAgent(actuelBrut)
      if (!actuel.refus && actuel.numero === numero.numero) {
        resultats.push({
          ...base,
          statut: STATUTS.INCHANGE,
          fiche,
          detail: actuelBrut === numero.numero ? '' : `déjà présent, écrit « ${actuelBrut} »`,
        })
      } else {
        resultats.push({
          ...base,
          statut: STATUTS.CONFLIT,
          fiche,
          detail: `la fiche porte déjà « ${actuelBrut} », le fichier propose « ${numero.numero} »`,
        })
      }
      continue
    }

    resultats.push({ ...base, statut: STATUTS.A_COMPLETER, fiche, detail: '' })
  }

  return { lignes: resultats, bilan: compterBilan(resultats), ecritures: ecrituresDe(resultats) }
}

/**
 * Les quatre seaux du bilan, et leur détail.
 *
 * ⚠ LES QUATRE SEAUX COUVRENT 100 % DES LIGNES, et `total` le vérifie. Un bilan
 *   dont les parts ne font pas le tout laisse croire qu'on a tout vu alors qu'une
 *   catégorie a été oubliée en silence.
 */
export function compterBilan(resultats = []) {
  const parStatut = Object.fromEntries(Object.values(STATUTS).map((s) => [s, 0]))
  for (const r of resultats) parStatut[r.statut] += 1

  const ignores = parStatut[STATUTS.NUMERO_IGNORE]
    + parStatut[STATUTS.INTROUVABLE]
    + parStatut[STATUTS.CODE_REPETE]
    + parStatut[STATUTS.PLUSIEURS_CLIENTS]

  return {
    total: resultats.length,
    misAJour: parStatut[STATUTS.A_COMPLETER],
    inchanges: parStatut[STATUTS.INCHANGE],
    conflits: parStatut[STATUTS.CONFLIT],
    ignores,
    detailIgnores: {
      numeroIgnore: parStatut[STATUTS.NUMERO_IGNORE],
      introuvable: parStatut[STATUTS.INTROUVABLE],
      codeRepete: parStatut[STATUTS.CODE_REPETE],
      plusieursClients: parStatut[STATUTS.PLUSIEURS_CLIENTS],
    },
  }
}

/**
 * Les écritures à faire, et l'état d'AVANT de chacune.
 *
 * ⚠ ON ÉCRIT LES DEUX CHAMPS, PAS SEULEMENT LE NUMÉRO. C'est le point le plus
 *   dangereux de tout cet import, et il ne se voit pas.
 *
 *   `champsAgent` décide qu'une fiche est « déjà rangée » par la PRÉSENCE des
 *   clés `codeAgent`/`numeroAgent`, pas par leur valeur. Une fiche d'avant la
 *   séparation n'a aucune des deux : son identifiant est lu depuis `orange`.
 *   Écrire `numeroAgent` tout seul y ferait apparaître une clé — et dès lors
 *   l'application cesserait de lire `orange`, donc LE CODE AGENT DISPARAÎTRAIT
 *   DE L'ÉCRAN. Sur 15 000 fiches, un import censé ajouter une information en
 *   aurait effacé une autre, sans erreur et sans compteur.
 *
 *   On écrit donc le code tel que `champsAgent` le lit AUJOURD'HUI, en même temps
 *   que le numéro. La fiche se retrouve rangée pour de bon, ce que
 *   `agentFields.js` annonce déjà comme l'effet de « la première modification ».
 *   `orange` n'est pas touché : rien n'est effacé, et l'annulation reste possible.
 *
 * ⚠ `avant` NOTE LA PRÉSENCE DES CLÉS, pas seulement leur valeur. Annuler en
 *   remettant `codeAgent: ''` au lieu de SUPPRIMER la clé laisserait la fiche en
 *   mode « rangée puis vidée exprès » : son `orange` ne serait plus lu, et
 *   l'annulation aurait causé le dégât qu'elle venait réparer.
 */
export function ecrituresDe(resultats = []) {
  return resultats
    .filter((r) => ECRIT.has(r.statut) && r.fiche)
    .map((r) => ({
      id: r.fiche.id,
      storeId: r.fiche.registeredStoreId ?? null,
      nom: r.nom,
      maj: {
        codeAgent: champsAgent(r.fiche).codeAgent,
        numeroAgent: r.propose,
      },
      avant: {
        codeAgentPresent: Object.prototype.hasOwnProperty.call(r.fiche, 'codeAgent'),
        numeroAgentPresent: Object.prototype.hasOwnProperty.call(r.fiche, 'numeroAgent'),
        codeAgent: r.fiche.codeAgent ?? null,
        numeroAgent: r.fiche.numeroAgent ?? null,
      },
    }))
}
