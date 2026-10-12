/**
 * lireTableur.mjs — lire un CSV ou un .xlsx en TEXTE, sans perdre un zéro.
 *
 * PUR : prend une chaîne ou un buffer, rend des lignes. Aucun accès disque, donc
 * éprouvable sans fichier.
 *
 * POURQUOI UN ANALYSEUR CSV ÉCRIT ICI
 * ───────────────────────────────────
 * La bibliothèque `xlsx` sait lire un CSV, mais elle l'INTERPRÈTE : « 0123456 »
 * y devient le nombre 123456, et le zéro initial est perdu. Pour un fichier dont
 * la colonne clé est un code à zéro initial, c'est rédhibitoire — alors que le
 * CSV, lui, contient bien le zéro. On analyse donc le CSV soi-même, en texte de
 * bout en bout, et on ne se sert de `xlsx` que pour le .xlsx.
 *
 * ⚠ POUR LE .XLSX, LE ZÉRO EST PARFOIS DÉJÀ PERDU — et aucune option n'y change
 *   rien. Une cellule stockée en NOMBRE ne contient plus le zéro dans le fichier
 *   lui-même. `raw: false` rend la chaîne formatée, ce qui sauve les cellules
 *   TEXTE ; pour les autres, il n'y a rien à récupérer, et c'est à l'appelant de
 *   le signaler (voir le cas « Excel a mangé le zéro » dans
 *   `importNumerosAgent.mjs`).
 */

/** Les séparateurs candidats, du plus probable au moins. */
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
 * Les cellules d'un CSV, en texte brut.
 *
 * Gère les guillemets (séparateur et saut de ligne inclus dedans), le doublement
 * `""` pour un guillemet littéral, le BOM d'Excel et les fins de ligne CRLF.
 */
export function analyserCsv(contenu = '', separateurImpose = null) {
  // Le BOM se reconnait par son code, et non par un caractere invisible glisse
  // dans une expression reguliere, ou personne ne le relira jamais.
  const sansBom = contenu.charCodeAt(0) === 0xFEFF ? contenu.slice(1) : contenu
  if (sansBom.trim() === '') return { entetes: [], lignes: [] }

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

  // Une rangée entièrement vide n'est pas une ligne : les tableurs en laissent
  // en fin de fichier, et les compter ferait un « ignoré » par ligne blanche.
  const utiles = rangees.filter((r) => r.some((v) => String(v).trim() !== ''))
  if (utiles.length === 0) return { entetes: [], lignes: [] }

  const entetes = utiles[0].map((e) => String(e).trim())
  const lignes = utiles.slice(1).map((r) => {
    const objet = {}
    entetes.forEach((entete, index) => { objet[entete] = String(r[index] ?? '') })
    return objet
  })

  return { entetes, lignes, separateur }
}

/**
 * Les cellules de la PREMIÈRE feuille d'un classeur .xlsx, en texte.
 *
 * `xlsx` est importé à la demande : les tests de l'analyseur CSV n'ont pas à
 * charger une bibliothèque de tableur, et le script reste lançable si l'on ne
 * traite que du CSV.
 */
export async function lireClasseur(buffer) {
  const XLSX = await import('xlsx')
  const classeur = XLSX.read(buffer, { type: 'buffer' })
  const nomFeuille = classeur.SheetNames[0]
  if (!nomFeuille) return { entetes: [], lignes: [] }

  const feuille = classeur.Sheets[nomFeuille]
  // `raw: false` → la chaîne FORMATÉE, qui préserve le texte tel que saisi.
  // `defval: ''` → une case vide reste une case vide, et non `undefined`.
  const rangees = XLSX.utils.sheet_to_json(feuille, { header: 1, raw: false, defval: '' })

  const utiles = rangees.filter((r) => Array.isArray(r) && r.some((v) => String(v ?? '').trim() !== ''))
  if (utiles.length === 0) return { entetes: [], lignes: [], feuille: nomFeuille }

  const entetes = utiles[0].map((e) => String(e ?? '').trim())
  const lignes = utiles.slice(1).map((r) => {
    const objet = {}
    entetes.forEach((entete, index) => { objet[entete] = String(r[index] ?? '') })
    return objet
  })

  return { entetes, lignes, feuille: nomFeuille }
}
