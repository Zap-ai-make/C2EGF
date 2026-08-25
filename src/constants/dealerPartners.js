/**
 * Liste figée des sous-dealers partenaires (hors boutiques de la boîte).
 *
 * Sélectionnables dans le formulaire de ravitaillement à la place d'une boutique.
 * Un « dépôt partenaire » agit uniquement sur l'inventaire du dealer
 * (−stock, +liquidité, 1:1), sans notification ni confirmation, et n'est là que
 * pour la piste d'historique. Les partenaires n'ont aucun solde propre.
 *
 * `id` = NUMERO DA (unique). Les champs sont dénormalisés sur l'enregistrement
 * de dépôt (l'identité du partenaire n'a aucun impact financier).
 */
export const DEALER_PARTNERS = Object.freeze([
  { id: '54525263', numeroDA: '54525263', nom: 'KABORE', prenom: 'HAMIDOU', localite: 'OUAGA' },
  { id: '75750889', numeroDA: '75750889', nom: 'ZONGO', prenom: 'EDMOND', localite: 'OUAGA' },
  { id: '7688348', numeroDA: '7688348', nom: 'CONGO', prenom: 'HALIDOU', localite: 'OUAGA' },
  { id: '64693578', numeroDA: '64693578', nom: 'SAWADOGO', prenom: 'BOUKARI', localite: 'MOGTEDO' },
  { id: '65490789', numeroDA: '65490789', nom: 'SALAWU', prenom: 'HAMIDOU', localite: 'POUYTENGA' },
  { id: '77805949', numeroDA: '77805949', nom: 'DEGTOUMDA', prenom: 'AMINATA', localite: 'OUAGA' },
  { id: '54525278', numeroDA: '54525278', nom: 'THIOMBIANO', prenom: 'CATHERINE', localite: 'FADA' },
  { id: '67883302', numeroDA: '67883302', nom: 'KOAMA', prenom: 'BOURAHIMAN', localite: 'KOMBISSIRI' },
  { id: '7688964', numeroDA: '7688964', nom: 'YONI', prenom: 'SAIDOU', localite: 'DIABO' },
  { id: '7689971', numeroDA: '7689971', nom: 'BARA', prenom: 'DJIBRINA', localite: 'BEGUEDO' },
  { id: '44429334', numeroDA: '44429334', nom: 'ZOBOUDRE', prenom: 'DAOUDA', localite: 'OUAGA' },
  { id: '54823152', numeroDA: '54823152', nom: 'SAWADOGO', prenom: 'GERARD', localite: 'MEGUET' },
  { id: '7688753', numeroDA: '7688753', nom: 'COMPAORE', prenom: 'OUMAROU', localite: 'POUYTENGA' },
  { id: '64752641', numeroDA: '64752641', nom: 'TOUGMA', prenom: 'ROMARIC', localite: 'GOUNGHIN' },
  { id: '54521819', numeroDA: '54521819', nom: 'OUBDA', prenom: 'OUSMANE', localite: 'DIALGAYE' },
  { id: '66383733', numeroDA: '66383733', nom: 'SILGA', prenom: 'KOURAOGO', localite: 'ZABRE' },
  { id: '54823173', numeroDA: '54823173', nom: 'KOLOGO', prenom: 'FIDEL', localite: 'NEDOGO' },
  { id: '74464351', numeroDA: '74464351', nom: 'KABORE', prenom: 'HAMIDOU', localite: 'OUAGA 2' },
  { id: '7689935', numeroDA: '7689935', nom: 'SINKA', prenom: 'NASSEDOU', localite: 'NIAOGHO' },
  { id: '4754444', numeroDA: '4754444', nom: 'WAONGO', prenom: 'KOUKA', localite: 'KOUPELA' },
  { id: '5069461', numeroDA: '5069461', nom: 'KABORE', prenom: 'HADO', localite: 'ZORGHO' },
  { id: '77405417', numeroDA: '77405417', nom: 'YAOGO', prenom: 'MOUNI', localite: 'KOAKIN' },
  { id: '5754475', numeroDA: '5754475', nom: 'KABORE', prenom: 'ABLASSE', localite: 'KOMSEOGO' },
  { id: '66323110', numeroDA: '66323110', nom: 'YAMEOGO', prenom: 'MATHURIN', localite: 'KOUDOUGOU' },
  { id: '55991935', numeroDA: '55991935', nom: 'TOUMA', prenom: 'SOUMAILA', localite: 'BOBO DIOULASSO' },
])

/** Libellé d'affichage d'un partenaire (liste déroulante, historique). */
export const partnerLabel = (p) =>
  p ? `${p.nom} ${p.prenom} — ${p.localite} (${p.numeroDA})` : ''

/** Recherche par id (NUMERO DA). */
export const findPartner = (id) => DEALER_PARTNERS.find(p => p.id === String(id)) ?? null
