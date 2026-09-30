import { activeProfile } from '../config/activeClientProfile.js'

const workspace = activeProfile.storeWorkspace

export const STORE_NAVIGATION_VISIBILITY = workspace.navigation
export const STORE_TRANSACTION_VISIBILITY = workspace.transactions
export const STORE_HISTORY_CONFIG = workspace.history
