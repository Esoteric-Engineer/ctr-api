import type { MiddlewareHandler } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import type { AppEnv } from './types'
import { ADMIN_JS, CSS, DOCS_CSS, DOCS_JS, SWAGGER_BASE, UPLOAD_JS } from './pages'

export const baseHeaders = secureHeaders({
  xFrameOptions: 'DENY',
  referrerPolicy: 'strict-origin-when-cross-origin',
})

// CSP hash
const hash = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`
}

const buildPolicies = async () => {
  const shared = "default-src 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
  return {
    app: `${shared}; script-src ${await hash(UPLOAD_JS)} ${await hash(ADMIN_JS)}; style-src ${await hash(CSS)}; img-src 'self' https://cdn.discordapp.com`,
    docs: `${shared}; script-src ${SWAGGER_BASE} ${await hash(DOCS_JS)}; style-src ${SWAGGER_BASE} ${await hash(DOCS_CSS)}; img-src 'self' data:`,
  }
}

let policies: ReturnType<typeof buildPolicies> | undefined

export const csp = (name: 'app' | 'docs'): MiddlewareHandler<AppEnv> => async (ctx, next) => {
  await next()
  if (ctx.res.headers.has('Content-Security-Policy')) return
  policies ??= buildPolicies()
  ctx.res.headers.set('Content-Security-Policy', (await policies)[name])
}
