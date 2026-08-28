import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { loadEnv } from 'vite'
import { Config } from '@remotion/cli/config'
import { enableTailwind } from '@remotion/tailwind-v4'

/**
 * Configuration du banc de mouvement.
 *
 * Remotion possède son propre empaqueteur (webpack) — il ne passe PAS par la
 * configuration Vite du projet. Tout ce que Vite fait gratuitement doit donc
 * lui être redit ici : Tailwind, et le service des actifs de `public/`.
 *
 * Cette configuration ne touche en rien la construction du produit. `npm run
 * build` reste Vite, et `motion/` n'est l'entrée d'aucun build.
 *
 * ⚠ Le nom du fichier n'est pas libre : Remotion ne lit que `remotion.config.ts`
 * ou `remotion.config.js`. Un `remotion.config.mjs` est ignoré EN SILENCE —
 * aucune erreur, aucun avertissement, simplement une configuration qui ne
 * s'applique pas et un banc qui échoue pour une raison sans rapport.
 */

// `process.cwd()` et non `import.meta.dirname` : Remotion transpile ce fichier
// vers CommonJS avant de l'exécuter, et `import.meta` n'y survit pas — il rend
// `undefined`, et l'erreur qui suit ne parle plus du tout de configuration.
// Les scripts npm partent tous de la racine du dépôt.
const PUBLIC = path.join(process.cwd(), 'public')

const estCssLoader = (usage) => {
  const chemin = typeof usage === 'string' ? usage : usage?.loader
  // `postcss-loader` contient aussi « css-loader » : on exige la frontière.
  return typeof chemin === 'string' && /[\\/]css-loader[\\/]/.test(chemin)
}

/**
 * Empêche `css-loader` de résoudre les URL RACINE comme des modules.
 *
 * `src/index.css` écrit `url("/bandeau-reseau.jpg")` — la photographie du
 * bandeau. Vite la sert depuis `public/`, à la racine. Webpack, lui, y voit une
 * demande de module et la cherche sur le disque à la racine du dépôt, où elle
 * n'est évidemment pas : le banc refusait de se construire.
 *
 * `url: false` lui dit de laisser l'URL telle quelle. C'est ce qu'on veut : le
 * banc doit charger l'image PAR LE MÊME CHEMIN que l'application, sinon il
 * montrerait un bandeau que personne ne voit.
 *
 * Webpack imbrique ses règles — `oneOf`, `rules` — et `use` peut être une
 * chaîne, un objet ou un tableau. On descend partout plutôt que de parier sur
 * une forme : la structure appartient à `enableTailwind`, pas à nous.
 */
const desactiverResolutionUrl = (noeud) => {
  if (Array.isArray(noeud)) return noeud.some(desactiverResolutionUrl)
  if (!noeud || typeof noeud !== 'object') return false

  let touche = false

  if (estCssLoader(noeud)) {
    noeud.options = { ...noeud.options, url: false }
    touche = true
  }

  for (const cle of ['rules', 'oneOf', 'use']) {
    if (noeud[cle]) touche = desactiverResolutionUrl(noeud[cle]) || touche
  }

  return touche
}

const laisserLesUrlRacine = (config) => {
  // On CRIE si le loader n'a pas été trouvé. Sans cela, une évolution de
  // `@remotion/tailwind-v4` ferait échouer le banc avec la même erreur de
  // résolution obscure qu'au premier jour, et il faudrait tout re-diagnostiquer.
  if (!desactiverResolutionUrl(config.module?.rules)) {
    throw new Error(
      'remotion.config.js : css-loader introuvable dans la configuration ' +
      'webpack. Les URL racine des feuilles de style seront résolues comme ' +
      'des modules, et le banc refusera de se construire.'
    )
  }
  return config
}

/**
 * Sert les actifs de `public/` à la RACINE, comme Vite.
 *
 * Remotion sert bien `public/`, mais sous le préfixe `/public/` — c'est ce que
 * rend `staticFile()`. Or l'application, elle, écrit `/c2egf-mark.png` dans son
 * JSX et `/bandeau-reseau.jpg` dans son CSS, parce que c'est ainsi que Vite les
 * sert. Sans ce pont, le banc affichait une icône d'image cassée à la place du
 * logo et un aplat marine à la place de la photographie.
 *
 * C'ÉTAIT LE DÉFAUT LE PLUS GRAVE POSSIBLE POUR UN BANC : montrer autre chose
 * que le produit. On aurait jugé le mouvement sur un décor qui n'existe pas.
 *
 * La correction ne touche ni le composant ni le CSS — les deux restent
 * exactement ceux de l'application. On se contente d'émettre une copie des
 * actifs à la racine du paquet du banc. Vingt lignes, et aucune dépendance
 * ajoutée : `copy-webpack-plugin` ferait la même chose en plus lourd.
 */
class ServirPublicALaRacine {
  apply(compilateur) {
    const { RawSource } = compilateur.webpack.sources

    compilateur.hooks.thisCompilation.tap('ServirPublicALaRacine', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'ServirPublicALaRacine',
          stage: compilateur.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        () => {
          if (!existsSync(PUBLIC)) {
            throw new Error(
              `remotion.config.js : dossier public introuvable (${PUBLIC}). ` +
              'Lancer le banc depuis la racine du dépôt — sans ces actifs, il ' +
              'montrerait un bandeau sans logo ni photographie.'
            )
          }

          for (const nom of readdirSync(PUBLIC)) {
            const complet = path.join(PUBLIC, nom)
            if (!statSync(complet).isFile()) continue
            // `emitAsset` lève si le nom existe déjà : le paquet gagne toujours.
            if (compilation.getAsset(nom)) continue
            compilation.emitAsset(nom, new RawSource(readFileSync(complet)))
          }
        }
      )
    })
  }
}

/**
 * Donne au banc le PROFIL CLIENT, sans quoi il affiche la mauvaise marque.
 *
 * Le wordmark vient de `branding.appName`, résolu depuis
 * `import.meta.env.VITE_CLIENT_ID` (`src/config/activeClientProfile.js`). Vite
 * fournit cette variable ; webpack ne la connaît pas. La résolution est
 * TOLÉRANTE par dessein — elle retombe sur le profil pilote plutôt que de
 * casser l'application —, si bien que le banc rendait tranquillement
 * « AKAYIS », la marque du produit standard, à la place de « C2EGF BURKINA ».
 *
 * Le mot était faux, et rien ne le disait. C'est le pire cas pour un banc :
 * on aurait réglé le décalage des lettres sur un mot de six caractères pour
 * un titre qui en compte treize.
 *
 * L'identifiant se lit par le `loadEnv` de Vite — le MÊME mécanisme que
 * `vite.config.js` —, jamais recopié ici. Et le banc est STRICT là où
 * l'application est tolérante : sans identifiant, il s'arrête. Une application
 * qui se rabat sur un profil par défaut reste utilisable ; un banc qui montre
 * une autre marque ne sert plus à rien.
 *
 * Seule cette clé est injectée. `.env` porte aussi les identifiants Firebase :
 * définir `import.meta.env` en bloc les ferait entrer dans le paquet du banc,
 * pour un bandeau qui ne lit aucune donnée (SECURITY.md §2).
 */
class DonnerLeProfilClient {
  apply(compilateur) {
    const env = loadEnv('development', process.cwd(), '')
    const identifiant = env.VITE_CLIENT_ID

    if (!identifiant) {
      throw new Error(
        'remotion.config.js : VITE_CLIENT_ID absent de .env. Le banc rendrait ' +
        'la marque du produit standard (« AKAYIS ») au lieu de celle du client. ' +
        'Copier .env.example vers .env.'
      )
    }

    new compilateur.webpack.DefinePlugin({
      'import.meta.env.VITE_CLIENT_ID': JSON.stringify(identifiant),
      'import.meta.env.DEV': 'false',
      'import.meta.env.PROD': 'true',
    }).apply(compilateur)
  }
}

Config.overrideWebpackConfig((config) => {
  const suivant = laisserLesUrlRacine(enableTailwind(config))
  suivant.plugins = [
    ...(suivant.plugins ?? []),
    new ServirPublicALaRacine(),
    new DonnerLeProfilClient(),
  ]
  return suivant
})

Config.setVideoImageFormat('jpeg')
