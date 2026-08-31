import { formatCurrency } from '../../utils/formatCurrency'
import { ETATS_CUVE, MOMENTS } from '../../utils/cuvesApresEnvoi'

/**
 * L'état des cuves du dealer après l'envoi, sur l'écran de confirmation.
 *
 * POURQUOI ICI, ET PAS DANS LE FORMULAIRE
 * ───────────────────────────────────────
 * Le formulaire est l'endroit où l'on hésite ; la confirmation est l'endroit où
 * l'on s'engage. Une projection qui bouge à chaque frappe du montant devient un
 * décor qu'on cesse de lire ; posée une fois, en face du chiffre qu'on
 * s'apprête à valider, elle est la dernière information avant le geste.
 *
 * L'ALERTE PASSE PAR UN MOT, JAMAIS PAR LA SEULE TEINTE
 * ────────────────────────────────────────────────────
 * « ne couvre pas », « sous votre seuil bas » sont écrits en toutes lettres
 * (DESIGN.md §5). La couleur ne fait que redire ce que la phrase énonce déjà,
 * et l'ambre reste au seuil, le rouge au refus.
 *
 * `role="status"` et non `role="alert"` : ce bloc est présent dès l'ouverture de
 * l'écran de confirmation, il n'interrompt pas — il informe. Une alerte
 * couperait la lecture du récapitulatif qu'elle complète.
 */

const LIBELLES = { stock: 'Stock', liquidite: 'Liquidité' }

/**
 * Un mouvement de cuve — et, quand `projete` est faux, l'ABSENCE de mouvement.
 *
 * ⚠ Ne jamais afficher un « après » que l'opération ne produira pas. La
 *   première version chiffrait le solde résultant dans tous les cas, si bien
 *   qu'une cuve trop juste s'annonçait « 8 420 000 → -580 000 FCFA ». Or une
 *   cuve ne devient pas négative : le serveur REFUSE l'opération, et le solde
 *   reste exactement où il est. Ce nombre décrivait un état qui n'existera
 *   jamais — et le seul qui comptait, le manque, était relégué à la phrase
 *   d'après.
 *
 * La flèche est décorative ; « passe à » est dit aux lecteurs d'écran.
 */
function Mouvement({ mouvement, reseau, projete }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
      <span className="text-sm text-ink-muted">
        {LIBELLES[mouvement.champ]} {reseau}
      </span>
      <span className="text-sm tabular-nums text-ink">
        <span className={projete ? 'text-ink-muted' : 'font-semibold text-ink'}>
          {formatCurrency(mouvement.avant)}
        </span>
        {projete && (
          <>
            <span aria-hidden="true" className="mx-1.5 text-ink-muted">→</span>
            <span className="sr-only"> passe à </span>
            <span className="font-semibold text-ink">{formatCurrency(mouvement.apres)}</span>
          </>
        )}
      </span>
    </li>
  )
}

function CuvesApresEnvoi({ projection }) {
  if (!projection) return null

  const { etat, mouvements, moment, manque, seuil, reseau } = projection
  const aConfirmer = moment === MOMENTS.CONFIRMATION
  const insuffisant = etat === ETATS_CUVE.INSUFFISANT

  // Le titre porte le MOMENT, parce que c'est lui qui se lit de travers : un
  // ravitaillement ne débite rien tant que la boutique n'a pas confirmé, et une
  // opération partenaire débite tout de suite. Sauf quand rien ne bougera : le
  // bloc annonce alors ce qu'il est devenu, un constat sur les cuves d'aujourd'hui.
  const titre = insuffisant
    ? 'Vos cuves ne couvrent pas cet envoi'
    : aConfirmer
      ? 'Vos cuves après confirmation'
      : 'Vos cuves après cette opération'

  const preambule = insuffisant
    ? (aConfirmer
        ? 'La boutique ne pourra pas confirmer ce ravitaillement en l’état.'
        : 'Cette opération sera refusée en l’état.')
    : aConfirmer
      ? 'Ce ravitaillement quittera vos cuves quand la boutique le confirmera, pas à l’envoi.'
      : 'Cette opération est immédiate : vos cuves bougent dès la confirmation ci-dessous.'

  if (etat === ETATS_CUVE.INCONNU && mouvements.length === 0) return null

  return (
    <section
      role="status"
      data-testid="cuves-apres-envoi"
      data-etat={etat}
      className="mb-5 rounded-xl border border-line bg-canvas p-4"
      aria-label={titre}
    >
      <h2 className="text-sm font-semibold text-ink">{titre}</h2>
      <p className="mt-0.5 text-xs text-ink-muted">{preambule}</p>

      {etat === ETATS_CUVE.INCONNU ? (
        // Ni cuve vide, ni inventaire amorcé : les deux lectures mènent à des
        // issues opposées, et on n'a pas de quoi les départager. On le dit
        // plutôt que d'en choisir une — voir `cuvesApresEnvoi.js`.
        <p className="mt-3 text-sm text-ink-muted" data-testid="cuves-inconnu">
          Votre inventaire n’a encore enregistré aucun mouvement : impossible de
          dire ce qu’il restera dans vos cuves après cet envoi.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line/60">
          {mouvements.map(m => (
            <Mouvement key={m.champ} mouvement={m} reseau={reseau} projete={!insuffisant} />
          ))}
        </ul>
      )}

      {insuffisant && (
        // L'erreur dit ce qui manque ET les deux sorties possibles
        // (DESIGN.md §12) : reconstituer, ou envoyer moins.
        <p className="mt-3 text-sm font-medium text-danger" data-testid="cuves-insuffisant">
          Il manque {formatCurrency(manque)}. Reconstituez votre cuve, ou
          réduisez le montant.
        </p>
      )}

      {etat === ETATS_CUVE.SOUS_SEUIL && (
        <p className="mt-3 text-sm font-medium text-warn" data-testid="cuves-sous-seuil">
          Après cette opération, votre cuve passe sous votre propre seuil bas
          ({formatCurrency(seuil)}). L’envoi reste possible.
        </p>
      )}
    </section>
  )
}

export default CuvesApresEnvoi
