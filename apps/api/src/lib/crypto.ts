import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'

// Envelope encryption for secrets at rest (Gmail refresh tokens). AES-256-GCM.
// Key comes from ENCRYPTION_KEY (any string — hashed to 32 bytes). If it's
// unset we fall back to passthrough with a loud warning so local dev isn't
// blocked, but PRODUCTION MUST SET IT (see .env.example).

const PREFIX = 'v1:'

function key(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) return null
  return createHash('sha256').update(raw).digest() // 32 bytes
}

let warned = false
function warnOnce() {
  if (!warned) {
    console.warn('[crypto] ENCRYPTION_KEY not set — secrets stored in PLAINTEXT. Set it before production.')
    warned = true
  }
}

// Returns `v1:<iv>:<tag>:<ciphertext>` (all base64), or the plaintext unchanged
// if no key is configured.
export function encryptSecret(plaintext: string): string {
  const k = key()
  if (!k) { warnOnce(); return plaintext }
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', k, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':')
}

// Decrypts a value produced by encryptSecret. Legacy plaintext (no v1: prefix)
// is returned as-is, so tokens stored before encryption keep working until the
// next reconnect re-encrypts them.
export function decryptSecret(value: string): string {
  if (!value.startsWith(PREFIX)) return value // legacy plaintext
  const k = key()
  if (!k) { warnOnce(); throw new Error('ENCRYPTION_KEY not set but an encrypted value was found') }
  const [ivB64, tagB64, ctB64] = value.slice(PREFIX.length).split(':')
  const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8')
}
