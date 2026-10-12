/**
 * lireTableur.mjs — lire un .xlsx ou un CSV en TEXTE, sans perdre un zéro.
 *
 * PUR : prend une chaîne ou un buffer, rend des lignes. Aucun accès disque, donc
 * éprouvable sans fichier.
 *
 * LES DEUX FORMATS SONT TRAITÉS AVEC LE MÊME SOIN, PAR DEUX CHEMINS DIFFÉRENTS
 * ────────────────────────────────────────────────────────────────────────────
 * Le fichier de travail de la boutique est un classeur Excel. Le CSV n'est qu'un
 * cas plus simple — et aucun des deux n'a le droit d'abîmer un code agent.
 *
 * CSV : la bibliothèque `xlsx` sait le lire, mais elle l'INTERPRÈTE — « 0123456 »
 * y devient le nombre 123456, alors que le fichier contient bien le zéro. On
 * l'analyse donc ici, caractère par caractère, en texte de bout en bout.
 *
 * .XLSX : on lit les cellules UNE PAR UNE au lieu de passer par `sheet_to_json`,
 * parce qu'une cellule porte trois informations et qu'il faut les trois :
 *
 *   t  le type      — « s » texte, « n » nombre, « d » date…
 *   v  la valeur    — ce qu'Excel a réellement stocké
 *   w  l'affichage  — la valeur passée par le format de la cellule
 *
 * ⚠ AUCUNE DES DEUX NE SUFFIT, ET VOICI POURQUOI :
 *
 *   | cellule                    | t | v         | w           | à retenir     |
 *   |----------------------------|---|-----------|-------------|---------------|
 *   | texte « 0123456 »          | s | "0123456" | "0123456"   | w             |
 *   | nombre, format « 0000000 » | n | 123456    | "0123456"   | w ← le zéro !  |
 *   | nombre, format Général     | n | 123456    | "123456"    | v, zéro perdu |
 *   | nombre, format milliers    | n | 1234567   | "1,234,567" | v             |
 *   | nombre, scientifique       | n | 123456    | "1.23E+05"  | v             |
 *
 *   Se fier à `w` casse les deux derniers cas ; se fier à `v` jette le zéro que
 *   le format « 0000000 » avait conservé. La règle retenue : prendre `w` quand il
 *   n'est QUE des chiffres et au moins aussi long que `v` — sinon prendre `v`.
 *
 * ⚠ ET QUAND LE ZÉRO EST VRAIMENT PERDU, ON LE DIT. Une cellule de type « n » a
 *   traversé Excel comme un nombre : ses zéros de tête ont pu disparaître du
 *   fichier lui-même, et aucune lecture ne les inventera. `numeriques` marque ces
 *   cellules, pour que l'appelant puisse les rattraper EN S'APPUYANT SUR LA BASE
 *   plutôt qu'en devinant. Une cellule TEXTE, elle, n'est jamais rattrapée : son
 *   contenu est ce que la boutique a écrit exprès.
 */

/** Les séparateurs candidats pour un CSV. */
const SEPARATEURS = [';', ',', '\t']

/**
 * Le séparateur d'un CSV, déduit de sa première ligne.
 *
 * On compte les occurrences HORS GUILLEMETS : un nom contenant une virgule
 * (« OUEDRAOGO, ALI ») ferait sinon élire la virgule sur un fichier
 * point-virgule. Les exports de ce dépôt utilisent « ; » ; un fichier venu
 * d'ailleurs utilise souvent « , ». Deviner vaut mieux qu'imposer.
 */
export function detecterSeparateur(premiereLigne = '') {
  let meilleur = SEPARATEURS[0]
  let maximum = -1

  for (const separateur of SEPARATEURS) {
    let compte = 0
    let dansGuillemets = false
    for (const caractere of premiereLigne) {
      if (caractere === '"') dansGuillemets = !dansGuillemets
      else if (caractere === separateur && !dansGuillemets) compte += 1
    }
    if (compte > maximum) {
      maximum = compte
      meilleur = separateur
    }
  }

  return meilleur
}

/**
 * Assemble des rangées de chaînes en `{ entetes, lignes, numeriques }`.
 *
 * `numeriques` suit `lignes` rangée par rangée et colonne par colonne : c'est ce
 * qui permet à l'appelant de savoir QUELLE case a traversé Excel en nombre.
 */
function enTableau(rangees, numeriquesParRangee) {
  const garder = rangees
    .map((r, i) => ({ r, n: numeriquesParRangee[i] ?? [] }))
    // Une rangée entièrement vide n'est pas une ligne : les tableurs en laissent
    // en fin de fichier, et les compter ferait un « ignoré » par ligne blanche.
    .filter(({ r }) => r.some((v) => String(v ?? '').trim() !== ''))

  if (garder.length === 0) return { entetes: [], lignes: [], numeriques: [] }

  const entetes = garder[0].r.map((e) => String(e ?? '').trim())
  const lignes = []
  const numeriques = []

  for (const { r, n } of garder.slice(1)) {
    const valeurs = {}
    const types = {}
    entetes.forEach((entete, index) => {
      valeurs[entete] = String(r[index] ?? '')
      types[entete] = Boolean(n[index])
    })
    lignes.push(valeurs)
    numeriques.push(types)
  }

  return { entetes, lignes, numeriques }
}

/**
 * Les cellules d'un CSV, en texte brut.
 *
 * Gère les guillemets (séparateur et saut de ligne inclus dedans), le doublement
 * `""` pour un guillemet littéral, le BOM d'Excel et les fins de ligne CRLF.
 *
 * `numeriques` est toujours faux ici : un CSV n'a pas de type de cellule, donc ce
 * qu'il contient est ce que la boutique a écrit — et se lit tel quel.
 */
export function analyserCsv(contenu = '', separateurImpose = null) {
  // Le BOM se reconnait par son code, et non par un caractere invisible glisse
  // dans une expression reguliere, ou personne ne le relira jamais.
  const sansBom = contenu.charCodeAt(0) === 0xFEFF ? contenu.slice(1) : contenu
  if (sansBom.trim() === '') return { entetes: [], lignes: [], numeriques: [] }

  const separateur = separateurImpose ?? detecterSeparateur(sansBom.split(/\r?\n/, 1)[0] ?? '')

  const rangees = []
  let rangee = []
  let cellule = ''
  let dansGuillemets = false

  const finCellule = () => { rangee.push(cellule); cellule = '' }
  const finRangee = () => { finCellule(); rangees.push(rangee); rangee = [] }

  for (let i = 0; i < sansBom.length; i += 1) {
    const c = sansBom[i]

    if (dansGuillemets) {
      if (c === '"') {
        if (sansBom[i + 1] === '"') { cellule += '"'; i += 1 }
        else dansGuillemets = false
      } else cellule += c
      continue
    }

    if (c === '"') { dansGuillemets = true; continue }
    if (c === separateur) { finCellule(); continue }
    if (c === '\r') continue
    if (c === '\n') { finRangee(); continue }
    cellule += c
  }
  // La dernière rangée n'est close par aucun saut de ligne.
  if (cellule !== '' || rangee.length > 0) finRangee()

  const tableau = enTableau(rangees, rangees.map((r) => r.map(() => false)))
  return { ...tableau, separateur }
}

/**
 * Ce qu'une cellule de classeur contient réellement, et si Excel l'a vue comme
 * un nombre. Voir le tableau de l'en-tête : c'est la règle qu'on applique ici.
 */
export function valeurCellule(cellule) {
  if (!cellule) return { texte: '', numerique: false }

  if (cellule.t === 'n' && typeof cellule.v === 'number' && Number.isFinite(cellule.v)) {
    const brut = String(cellule.v)
    const affiche = String(cellule.w ?? '')
    // `w` ne gagne que s'il est entièrement numérique ET au moins aussi
    // informatif : c'est le seul cas où il porte un zéro que `v` a perdu. Un
    // format à séparateur de milliers ou scientifique est ainsi écarté.
    const texte = /^\d+$/.test(affiche) && affiche.length >= brut.length ? affiche : brut
    return { texte, numerique: true }
  }

  // ⚠ UNE DATE N'EST PAS UN CODE, ET NE DOIT PAS ÊTRE RATTRAPÉE. Excel
  //   transforme volontiers une saisie comme « 01-23456 » en date. On rend
  //   l'affichage tel quel : il ne passera pas le contrôle numérique, et la
  //   ligne sera SIGNALÉE au lieu d'être silencieusement réinterprétée.
  return { texte: String(cellule.w ?? cellule.v ?? ''), numerique: false }
}

/**
 * Les cellules d'une feuille de classeur, en texte, avec le type d'origine.
 *
 * @param {Buffer} buffer      le .xlsx lu depuis le disque par l'appelant
 * @param {string|null} voulue le nom de la feuille ; la première par défaut
 */
export async function lireClasseur(buffer, voulue = null) {
  const XLSX = await import('xlsx')
  // ⚠ `cellNF` EST NÉCESSAIRE. C'est le format de la cellule qui fait exister
  //   `w`, et c'est `w` qui porte le zéro d'un format « 0000000 ». Sans cette
  //   option, le seul cas de zéro RÉCUPÉRABLE côté Excel serait perdu.
  const classeur = XLSX.read(buffer, { type: 'buffer', cellNF: true })
  const feuilles = classeur.SheetNames

  if (feuilles.length === 0) {
    return { entetes: [], lignes: [], numeriques: [], feuilles: [] }
  }

  const nom = voulue ?? feuilles[0]
  if (!feuilles.includes(nom)) {
    return {
      erreur: `Feuille « ${nom} » absente du classeur.\n`
        + `Feuilles disponibles : ${feuilles.map((f) => `« ${f} »`).join(', ')}.`,
      feuilles,
    }
  }

  const feuille = classeur.Sheets[nom]
  if (!feuille['!ref']) return { entetes: [], lignes: [], numeriques: [], feuille: nom, feuilles }

  const plage = XLSX.utils.decode_range(feuille['!ref'])
  const rangees = []
  const numeriquesParRangee = []

  for (let r = plage.s.r; r <= plage.e.r; r += 1) {
    const textes = []
    const numeriques = []
    for (let c = plage.s.c; c <= plage.e.c; c += 1) {
      const { texte, numerique } = valeurCellule(feuille[XLSX.utils.encode_cell({ r, c })])
      textes.push(texte)
      numeriques.push(numerique)
    }
    rangees.push(textes)
    numeriquesParRangee.push(numeriques)
  }

  return { ...enTableau(rangees, numeriquesParRangee), feuille: nom, feuilles }
}
