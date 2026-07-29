import 'dotenv/config'
import http from 'node:http'
import { exec } from 'node:child_process'
import { google } from 'googleapis'

// One-off helper: mint a Google Ads API refresh token via a local OAuth flow,
// so you never have to fight the OAuth Playground. Run it, click through the
// Google consent screen once, and it prints GOOGLE_ADS_REFRESH_TOKEN.
//
// Prereqs:
//   1. A Google Cloud project with the "Google Ads API" enabled.
//   2. An OAuth client of type **Desktop app** (loopback redirect is allowed
//      for desktop clients without pre-registering a URI).
//   3. Its client id + secret, passed either as env vars or CLI args:
//        GOOGLE_ADS_CLIENT_ID=... GOOGLE_ADS_CLIENT_SECRET=... pnpm ads-token
//      or: pnpm ads-token <client_id> <client_secret>
//
// After it prints the token, add all five to apps/api/.env:
//   GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
//   GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID (your MCC id).

const PORT = 53682
const REDIRECT_URI = `http://localhost:${PORT}`
const SCOPE = 'https://www.googleapis.com/auth/adwords'

const clientId = process.env.GOOGLE_ADS_CLIENT_ID ?? process.argv[2]
const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET ?? process.argv[3]

if (!clientId || !clientSecret) {
  console.error('Missing OAuth client credentials.\n' +
    'Provide them via env (GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET)\n' +
    'or as args: pnpm ads-token <client_id> <client_secret>')
  process.exit(1)
}

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open'
  exec(`${cmd} "${url}"`, err => { if (err) console.log('\nCouldn\'t auto-open a browser. Open this URL manually:\n' + url) })
}

async function main() {
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI)
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',   // required to receive a refresh token
    prompt: 'consent',         // force a refresh token even on re-auth
    scope: [SCOPE],
  })

  const code: string = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '', REDIRECT_URI)
      const authCode = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      if (error) {
        res.end(`Authorization failed: ${error}. You can close this tab.`)
        server.close(); reject(new Error(error)); return
      }
      if (authCode) {
        res.end('✅ Google Ads authorized. You can close this tab and return to the terminal.')
        server.close(); resolve(authCode)
      } else {
        res.statusCode = 400; res.end('No authorization code in the callback.')
      }
    })
    server.listen(PORT, () => {
      console.log('\nWaiting for Google authorization…')
      console.log(`If a browser didn\'t open, visit:\n${authUrl}\n`)
      openBrowser(authUrl)
    })
    server.on('error', reject)
  })

  const { tokens } = await oauth2.getToken(code)
  if (!tokens.refresh_token) {
    console.error('\nNo refresh token returned. Revoke this app\'s access at ' +
      'https://myaccount.google.com/permissions and run again (the consent must be fresh).')
    process.exit(1)
  }

  console.log('\n=== SUCCESS ===')
  console.log('GOOGLE_ADS_REFRESH_TOKEN=' + tokens.refresh_token)
  console.log('\nAdd that to apps/api/.env alongside the other GOOGLE_ADS_* vars.')
  process.exit(0)
}

main().catch(e => { console.error('FAILED:', e instanceof Error ? e.message : e); process.exit(1) })
