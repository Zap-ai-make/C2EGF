import {
  initializeGuardedAdminAuthCli,
} from './lib/initializeGuardedAdminAuth.mjs'

const emailArg = process.argv.find((arg) => arg.startsWith('--email='))
const email = String(emailArg?.slice('--email='.length) || process.env.npm_config_email || process.argv[2] || '').trim().toLowerCase()
if (!email) {
  console.error('Usage: npm run account:reset-link -- --email=compte@example.com')
  process.exit(1)
}

const auth = await initializeGuardedAdminAuthCli()

const link = await auth.generatePasswordResetLink(email)
console.log(link)
