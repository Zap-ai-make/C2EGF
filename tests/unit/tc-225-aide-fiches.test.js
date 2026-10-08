import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FICHES, GROUPES, TITRES_GROUPES, groupePourChemin, groupesOrdonnes } from '../../src/content/aideFiches.js'

/**
 * TC-225 — Les fiches d'aide disent la vérité sur l'écran.
 *
 * CE QUE CE FICHIER PROTÈGE, ET POURQUOI C'EST CELUI-LÀ QUI COMPTE
 * ───────────────────────────────────────────────────────────────
 * Une aide qui a raison le jour où on l'écrit est facile. Une aide qui a encore
 * raison six mois plus tard, après que quelqu'un a renommé « Encaisser » en
 * « Recevoir », ne l'est pas — et personne ne pense à relire les fiches en
 * renommant un bouton.
 *
 * Or une fiche qui nomme un bouton inexistant est PIRE QUE PAS DE FICHE : la
 * caissière cherche à l'écran ce qu'on lui a promis, ne le trouve pas, et
 * conclut qu'elle n'a rien compris. On l'aura rendue moins sûre d'elle qu'avant
 * de l'aider.
 *
 * Le test ci-dessous relit donc chaque libellé entre accolades contre les
 * sources de l'interface. Il échoue au renommage, dans le même lot que le
 * renommage — au moment où l'on sait encore quoi écrire à la place.
 */

const lire = (chemin) => readFileSync(resolve(process.cwd(), chemin), 'utf8')

/**
 * Les sources où un libellé d'écran peut légitimement vivre.
 *
 * Liste explicite plutôt que `src/` en entier : un libellé qui ne se trouverait
 * que dans un commentaire ou un fichier mort passerait pour vivant.
 */
const SOURCES_INTERFACE = [
  'src/components/transactions/TransactionForm.jsx',
  'src/components/transactions/TransactionTable.jsx',
  'src/components/transactions/ClientSearch.jsx',
  'src/components/historique/HistoriqueTable.jsx',
  'src/components/network/NetworkCardsDrawer.jsx',
  'src/components/transactions/RavitaillementForm.jsx',
  'src/components/transactions/RavitaillementPanel.jsx',
  'src/components/transactions/ViderSoldesForm.jsx',
  'src/components/ClientsTable.jsx',
  'src/utils/excelUtils.js',
  'src/pages/Clients.jsx',
  'src/pages/Transactions.jsx',
  'src/pages/Historique.jsx',
  'src/constants/navigation.js',
  'config/clients/c2egf-burkina.js',
].map(lire).join('\n')

const libellesDe = (texte) => [...String(texte || '').matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1])

const tousLesLibelles = () => {
  const vus = new Set()
  for (const fiche of FICHES) {
    const champs = [fiche.titre, fiche.texte, fiche.texteFin, fiche.retenir?.texte, ...(fiche.etapes || [])]
    for (const champ of champs) for (const libelle of libellesDe(champ)) vus.add(libelle)
  }
  return [...vus]
}

describe('TC-225 — chaque libellé cité existe à l’écran', () => {
  it('[TC-225-1] tout libellé entre accolades se retrouve dans une source d’interface', () => {
    const introuvables = tousLesLibelles().filter((libelle) => !SOURCES_INTERFACE.includes(libelle))

    // Le message nomme les coupables : au renommage, on veut savoir QUOI
    // corriger sans relire les douze fiches.
    expect(introuvables, `Libellés cités par l'aide mais absents de l'interface : ${introuvables.join(', ')}`)
      .toEqual([])
  })

  it('[TC-225-2] aucune fiche n’est vide de contenu', () => {
    // Un titre sans corps est une fiche qu'on a commencée et oubliée : elle
    // promet une réponse et n'en donne aucune.
    for (const fiche of FICHES) {
      const aDuCorps = Boolean(fiche.texte || fiche.etapes?.length || fiche.retenir || fiche.texteFin)
      expect(aDuCorps, `La fiche ${fiche.id} n'a pas de contenu`).toBe(true)
    }
  })

  it('[TC-225-3] les identifiants sont uniques et les groupes connus', () => {
    const ids = FICHES.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)

    const groupesConnus = Object.values(GROUPES)
    for (const fiche of FICHES) expect(groupesConnus).toContain(fiche.groupe)
    for (const groupe of groupesConnus) expect(TITRES_GROUPES[groupe]).toBeTruthy()
  })

  it('[TC-225-4] chaque groupe porte au moins une fiche', () => {
    // Un intertitre suivi de rien ferait croire à un chargement raté.
    for (const groupe of Object.values(GROUPES)) {
      expect(FICHES.filter((f) => f.groupe === groupe).length).toBeGreaterThan(0)
    }
  })
})

describe('TC-225 — le groupe suit l’endroit où l’on se tient', () => {
  /**
   * C'est tout ce qui sépare « rapide » de « encore un truc à fouiller ».
   * Une caissière bloquée dans l'historique ne doit pas commencer par faire
   * défiler les fiches de saisie.
   */
  it('[TC-225-5] depuis l’historique, les fiches de l’historique passent devant', () => {
    expect(groupePourChemin('/historique')).toBe(GROUPES.HISTORIQUE)
    expect(groupePourChemin('/historique?onglet=corbeille')).toBe(GROUPES.HISTORIQUE)
    expect(groupesOrdonnes('/historique')[0]).toBe(GROUPES.HISTORIQUE)
  })

  /**
   * ⚠ ASSERTION RÉÉCRITE. Elle exigeait que `/clients` retombe sur les fiches de
   *   saisie — ce qui était juste tant qu'il n'existait AUCUNE fiche client. Le
   *   lot des réserves et des clients en a ajouté : la laisser telle quelle
   *   aurait envoyé une caissière bloquée sur l'import de clients lire d'abord
   *   comment saisir un dépôt.
   */
  it('[TC-225-6] depuis les clients, ce sont les fiches clients', () => {
    expect(groupePourChemin('/clients')).toBe(GROUPES.CLIENTS)
    expect(groupesOrdonnes('/clients')[0]).toBe(GROUPES.CLIENTS)
  })

  it('[TC-225-7] partout ailleurs, ce sont les fiches de saisie', () => {
    // Transactions est l'écran de la journée : c'est le défaut raisonnable,
    // y compris depuis une adresse inattendue.
    expect(groupePourChemin('/transactions')).toBe(GROUPES.TRANSACTIONS)
    expect(groupePourChemin('/')).toBe(GROUPES.TRANSACTIONS)
    expect(groupePourChemin()).toBe(GROUPES.TRANSACTIONS)
  })

  it('[TC-225-8] l’ordre porte TOUS les groupes, sans doublon ni oubli', () => {
    // Un groupe absent de l'ordre disparaîtrait du panneau sans rien casser :
    // ses fiches existeraient, et personne ne les verrait jamais.
    for (const chemin of ['/transactions', '/historique', '/clients', '/nimporte']) {
      const ordre = groupesOrdonnes(chemin)
      expect(new Set(ordre).size).toBe(ordre.length)
      expect([...ordre].sort()).toEqual([...Object.values(GROUPES)].sort())
    }
  })

  it('[TC-225-9] les réserves suivent la saisie : même onglet', () => {
    // Un ravitaillement se fait depuis Transactions. Les deux groupes qui
    // vivent là doivent se toucher, sinon on fait défiler l'historique entre.
    const ordre = groupesOrdonnes('/transactions')
    expect(ordre[0]).toBe(GROUPES.TRANSACTIONS)
    expect(ordre[1]).toBe(GROUPES.RESERVES)
  })
})

describe('TC-225 — les numéros se lisent dans l’ordre', () => {
  /**
   * POURQUOI CE TEST EXISTE
   * ───────────────────────
   * Le lot des réserves a inséré deux fiches entre la saisie et l'historique.
   * Le panneau affichait alors 1-7, puis 13-14, puis 8-12 : pour une lectrice,
   * des numéros qui sautent ressemblent à une panne, et elle cherche les fiches
   * manquantes au lieu de lire celle qu'elle a ouverte.
   *
   * Les fiches se renvoient l'une à l'autre (« lis la fiche 3 ») : les numéros
   * doivent donc être STABLES et dans l'ordre de lecture par défaut. Ce test
   * échouera au prochain groupe inséré, pendant qu'il est encore temps.
   */
  it('[TC-225-10] les identifiants suivent 1..N dans l’ordre de lecture', () => {
    const parGroupe = groupesOrdonnes('/transactions')
      .flatMap((groupe) => FICHES.filter((fiche) => fiche.groupe === groupe))

    expect(parGroupe.map((fiche) => fiche.id)).toEqual(
      parGroupe.map((_, index) => index + 1),
    )
  })

  it('[TC-225-11] tout renvoi « fiche N » pointe sur une fiche existante', () => {
    // Un renvoi vers un numéro disparu envoie la lectrice chercher une fiche
    // qui n'existe pas — exactement la perte de confiance qu'on veut éviter.
    const ids = new Set(FICHES.map((fiche) => fiche.id))
    const champs = FICHES.flatMap((fiche) => [
      fiche.titre, fiche.texte, fiche.texteFin, fiche.retenir?.texte, ...(fiche.etapes || []),
    ])

    for (const champ of champs) {
      for (const [, numero] of String(champ || '').matchAll(/fiche (\d+)/g)) {
        expect(ids, `renvoi vers une fiche ${numero} inexistante`).toContain(Number(numero))
      }
    }
  })
})

describe('TC-225 — le vocabulaire est celui du comptoir', () => {
  /**
   * « Centrale » est un mot de documentation. Au comptoir on dit « le dealer »,
   * et selon la franchise on le nomme même directement — le patron, le DG, son
   * prénom. Une fiche qui emploie le mot du schéma oblige la caissière à faire
   * une traduction de plus au moment où elle en a le moins les moyens.
   *
   * Ce test fige la correction. Le code, lui, garde « centrale » dans ses
   * commentaires : là, c'est le bon registre, et personne au comptoir ne les lit.
   */
  const MOTS_DE_DOCUMENTATION = [
    { mot: 'centrale', dire: 'le dealer' },
  ]

  it('[TC-225-12] aucune fiche n’emploie un mot que la boutique ne dit pas', () => {
    const texte = FICHES.flatMap((fiche) => [
      fiche.titre, fiche.texte, fiche.texteFin, fiche.retenir?.titre, fiche.retenir?.texte,
      ...(fiche.etapes || []),
    ]).join(' ').toLowerCase()

    for (const { mot, dire } of MOTS_DE_DOCUMENTATION) {
      expect(texte, `les fiches disent « ${mot} » : on dit « ${dire} »`).not.toContain(mot)
    }
  })
})
