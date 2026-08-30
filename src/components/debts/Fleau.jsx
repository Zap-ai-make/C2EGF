import { formatCurrency } from '../../utils/formatCurrency'
import { armWidthPercent } from '../../utils/debtPositions'

/**
 * Le fléau — la signature de l'écran des dettes internes.
 *
 * L'IDÉE
 * ──────
 * Une ligne de zéro verticale, partagée par toutes les lignes de la liste.
 * Ce que je dois pousse à gauche, ce qu'on me doit pousse à droite, et chaque
 * partenaire est une poutre qui penche. La compensation, elle, est très
 * exactement le geste de ramener la poutre au zéro : la mécanique du produit
 * EST le dessin, au lieu d'être expliquée à côté.
 *
 * POURQUOI PAS DEUX GRANDES CARTES DE TOTAUX
 * ──────────────────────────────────────────
 * « Gros chiffre + petit label » est le réflexe que DESIGN.md §1 range parmi
 * les tics à fuir, et surtout il ne répond pas à la question posée : deux
 * totaux disent combien, jamais AVEC QUI. Or un règlement se fait avec une
 * boutique, pas avec un total. Les totaux restent — en tête, petits — parce
 * qu'ils servent de repère, pas de réponse.
 *
 * CE QUI EST DÉCORATIF, CE QUI NE L'EST PAS
 * ─────────────────────────────────────────
 * Les poutres sont masquées de l'arbre d'accessibilité : elles ne font que
 * redire, en dessin, le montant déjà écrit en toutes lettres à droite. Le nom
 * accessible de chaque ligne porte le sens complet (« Gounghin : je dois
 * 135 000 FCFA de plus qu'on ne me doit »), parce qu'« un moins cent trente-cinq
 * mille » ne dit pas de quel côté penche la poutre.
 *
 * TOUTE LA HARDIESSE EST ICI
 * ──────────────────────────
 * DESIGN.md §14 : on la dépense à un seul endroit. Le reste de l'écran — et le
 * reste de l'application — reste calme et réutilise l'existant.
 */

/** Le signe et la teinte d'une position nette. */
function positionNette(net) {
  if (net > 0) return { texte: `+${formatCurrency(net)}`, ton: 'text-inflow', sens: 'on me doit' }
  if (net < 0) return { texte: `−${formatCurrency(-net)}`, ton: 'text-outflow', sens: 'je dois' }
  return { texte: formatCurrency(0), ton: 'text-ink-muted', sens: 'à l’équilibre' }
}

/**
 * Une poutre.
 *
 * Les bras sont posés en absolu de part et d'autre de la ligne de zéro, et la
 * part compensable est un SECOND bras superposé au premier, ancré au même bord.
 * Superposer plutôt que juxtaposer garde la longueur totale du bras égale au
 * montant dû — la hachure marque une portion de la dette, elle ne s'y ajoute pas.
 */
function Poutre({ debt, credit, compensable, maxArm }) {
  const l = (montant) => armWidthPercent(montant, maxArm)
  return (
    <span className="relative block h-6 min-w-[6rem]" aria-hidden="true">
      {/* La ligne de zéro déborde en haut et en bas : les segments de chaque
          ligne se rejoignent et ne forment qu'un seul filet continu sur toute
          la liste. C'est ce qui en fait un repère plutôt qu'une décoration. */}
      <span className="absolute left-1/2 -top-2 -bottom-2 w-px bg-line" />

      {debt > 0 && (
        <span
          className="absolute right-1/2 top-1 h-4 rounded-l-sm bg-outflow"
          style={{ width: `${l(debt)}%` }}
        />
      )}
      {credit > 0 && (
        <span
          className="absolute left-1/2 top-1 h-4 rounded-r-sm bg-inflow"
          style={{ width: `${l(credit)}%` }}
        />
      )}

      {compensable > 0 && (
        <>
          <span
            className="fleau-compensable absolute right-1/2 top-1 h-4 rounded-l-sm bg-outflow"
            style={{ width: `${l(compensable)}%` }}
          />
          <span
            className="fleau-compensable absolute left-1/2 top-1 h-4 rounded-r-sm bg-inflow"
            style={{ width: `${l(compensable)}%` }}
          />
        </>
      )}
    </span>
  )
}

function LignePartenaire({ partner, maxArm, expanded, onToggle, renderDetails }) {
  const { texte, ton, sens } = positionNette(partner.net)
  const compte = [
    partner.debts.length && `${partner.debts.length} dette${partner.debts.length > 1 ? 's' : ''}`,
    partner.credits.length && `${partner.credits.length} créance${partner.credits.length > 1 ? 's' : ''}`,
  ].filter(Boolean).join(' · ')

  const nomAccessible = partner.net === 0
    ? `${partner.name} : à l’équilibre, ${formatCurrency(partner.compensable)} compensables`
    : `${partner.name} : ${sens} ${formatCurrency(Math.abs(partner.net))}`

  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => onToggle?.(partner.storeId)}
        aria-expanded={Boolean(expanded)}
        aria-label={nomAccessible}
        data-testid={`fleau-ligne-${partner.storeId}`}
        className="grid w-full grid-cols-1 items-center gap-1 px-4 py-3 text-left transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400 sm:grid-cols-[minmax(7rem,11rem)_1fr_minmax(7rem,auto)] sm:gap-4"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">{partner.name}</span>
          {compte && <span className="block text-xs text-ink-muted">{compte}</span>}
        </span>

        <Poutre
          debt={partner.debt}
          credit={partner.credit}
          compensable={partner.compensable}
          maxArm={maxArm}
        />

        <span className={`text-sm font-semibold tabular-nums sm:text-right ${ton}`}>
          {texte}
        </span>
      </button>

      {expanded && renderDetails && (
        <div className="border-t border-line bg-canvas px-4 py-3">{renderDetails(partner)}</div>
      )}
    </li>
  )
}

/** Les squelettes gardent la hauteur exacte d'une poutre : la ligne de zéro ne
 *  saute pas quand les données arrivent. */
function Squelette() {
  return (
    <ul aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="grid grid-cols-1 items-center gap-1 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(7rem,11rem)_1fr_minmax(7rem,auto)] sm:gap-4">
          <span className="h-4 w-28 rounded bg-gray-200 motion-safe:animate-pulse" />
          <span className="relative block h-6">
            <span className="absolute left-1/2 -top-2 -bottom-2 w-px bg-line" />
            <span className="absolute right-1/2 top-1 h-4 rounded-l-sm bg-gray-200 motion-safe:animate-pulse" style={{ width: `${20 + i * 8}%` }} />
          </span>
          <span className="h-4 w-24 justify-self-end rounded bg-gray-200 motion-safe:animate-pulse" />
        </li>
      ))}
    </ul>
  )
}

function Total({ label, value, ton }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{label}</span>
      <span className={`text-base font-semibold tabular-nums ${ton}`}>{value}</span>
    </div>
  )
}

function Fleau({
  positions,
  loading = false,
  expandedPartnerId = null,
  onTogglePartner,
  renderDetails,
}) {
  const { totalDebt = 0, totalCredit = 0, net = 0, maxArm = 0, ignored = 0, partners = [] } =
    positions ?? {}
  const nette = positionNette(net)

  return (
    <section
      className="overflow-hidden rounded-xl border border-line bg-surface"
      aria-label="Positions par boutique partenaire"
    >
      <div className="flex flex-wrap gap-x-8 gap-y-3 border-b border-line bg-brand-50 px-4 py-3">
        <Total label="Je dois" value={formatCurrency(totalDebt)} ton="text-outflow" />
        <Total label="On me doit" value={formatCurrency(totalCredit)} ton="text-inflow" />
        <Total label="Position nette" value={nette.texte} ton={nette.ton} />
      </div>

      {loading ? (
        <Squelette />
      ) : partners.length === 0 ? (
        // L'état vide est une invitation, pas un trou (DESIGN.md §10). Il dit
        // aussi ce qui n'est PAS montré : les dettes soldées ne disparaissent
        // pas, elles ont juste quitté cet écran-ci.
        <div className="px-4 py-10 text-center">
          <p className="text-base font-medium text-ink">Aucune dette ouverte</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
            Rien n’est dû dans un sens ni dans l’autre. Les dettes réglées restent
            consultables dans l’historique.
          </p>
        </div>
      ) : (
        <ul>
          {partners.map((partner) => (
            <LignePartenaire
              key={partner.storeId}
              partner={partner}
              maxArm={maxArm}
              expanded={expandedPartnerId === partner.storeId}
              onToggle={onTogglePartner}
              renderDetails={renderDetails}
            />
          ))}
        </ul>
      )}

      {/* La légende double chaque couleur d'un mot : le sens ne passe jamais par
          la seule teinte (DESIGN.md §5). */}
      {partners.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line px-4 py-3 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-3.5 rounded-sm bg-outflow" aria-hidden="true" />
            Ce que je dois
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-3.5 rounded-sm bg-inflow" aria-hidden="true" />
            Ce qu’on me doit
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="fleau-compensable h-2.5 w-3.5 rounded-sm bg-outflow" aria-hidden="true" />
            Hachuré : compensable
          </span>
        </div>
      )}

      {/* Un montant illisible n'est pas avalé en silence : sur un écran qui sert
          à savoir combien on doit, faire disparaître de l'argent sans le dire
          serait la pire des défaillances. */}
      {ignored > 0 && (
        <p className="border-t border-line bg-warn-soft px-4 py-2 text-xs text-warn" role="status">
          {ignored} ligne{ignored > 1 ? 's' : ''} illisible{ignored > 1 ? 's' : ''} et non comptée
          {ignored > 1 ? 's' : ''} dans les totaux. Signalez-le au gérant.
        </p>
      )}
    </section>
  )
}

export default Fleau
