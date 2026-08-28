import { registerRoot } from 'remotion'
import { Root } from './Root.jsx'

/**
 * Point d'entrée du banc de mouvement. Rien d'autre ne doit vivre ici :
 * Remotion charge ce fichier en premier, et tout ce qu'il importe entre dans
 * le graphe du banc.
 */
registerRoot(Root)
