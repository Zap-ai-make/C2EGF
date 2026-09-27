import {
  initializeGuardedAdminAuthCli,
} from './lib/initializeGuardedAdminAuth.mjs'

const email = String(process.env.AKAYIS_LOGIN_EMAIL || process.env.npm_config_email || '').trim().toLowerCase()
const password = String(process.env.AKAYIS_LOGIN_PASSWORD || '')
if (!email || !password) {
  console.error('Usage: definir AKAYIS_LOGIN_EMAIL et AKAYIS_LOGIN_PASSWORD puis lancer npm run account:update-password')
  process.exit(1)
}

const auth = await initializeGuardedAdminAuthCli()

const user = await auth.getUserByEmail(email)
await auth.updateUser(user.uid, {
  password,
  disabled: false,
  emailVerified: true
})

console.log(`OK - mot de passe mis a jour et compte actif pour ${email}`)
