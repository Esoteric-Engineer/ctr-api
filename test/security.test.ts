import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import { SWAGGER_BASE } from '../src/pages'
import { createAdmin, createCreator, createUser, getTrackRow, insertTrack, page, request, storedKeys } from './helpers'
import { LEV, file } from './fixtures'

const cspHash = async (text: string) =>
  `'sha256-${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))))}'`

const directives = (csp: string) =>
  Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]))

const inline = (html: string, tag: 'script' | 'style') => [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1])

const external = (html: string, pattern: RegExp) => [...html.matchAll(pattern)].map((m) => m[0])

const pages: [name: string, load: () => Promise<Response>][] = [
  ['home (guest)', () => page('/')],
  ['home (signed in)', async () => page('/', { cookie: (await createCreator()).cookie })],
  ['submit', () => page('/submit')],
  ['docs', () => page('/docs')],
  ['upload', async () => page('/upload', { cookie: (await createCreator()).cookie })],
  ['admin', async () => page('/admin', { cookie: (await createAdmin()).cookie })],
  ['pending', async () => page('/upload', { cookie: (await createUser()).cookie })],
  ['forbidden', async () => page('/admin', { cookie: (await createCreator()).cookie })],
]

describe('Content-Security-Policy', () => {
  it.each(pages)('allows every inline script and style on the %s page by hash', async (_, load) => {
    const res = await load()
    const html = await res.text()
    const csp = directives(res.headers.get('content-security-policy')!)

    for (const script of inline(html, 'script')) expect(csp['script-src']).toContain(await cspHash(script))
    for (const style of inline(html, 'style')) expect(csp['style-src']).toContain(await cspHash(style))
    expect(inline(html, 'style').length).toBeGreaterThan(0)
  })

  it.each(pages)('has no inline handlers or style attributes the CSP would block on the %s page', async (_, load) => {
    const html = await (await load()).text()
    expect(html).not.toMatch(/\son[a-z]+\s*=/i)
    expect(html).not.toMatch(/\sstyle\s*=/i)
    expect(html).not.toMatch(/javascript:/i)
  })

  it.each(pages)('locks down the %s page', async (_, load) => {
    const csp = directives((await load()).headers.get('content-security-policy')!)
    expect(csp['default-src']).toEqual(["'none'"])
    expect(csp['frame-ancestors']).toEqual(["'none'"])
    expect(csp['base-uri']).toEqual(["'none'"])
    expect(csp['form-action']).toEqual(["'self'"])
    expect(csp['connect-src']).toEqual(["'self'"])
    for (const directive of ['script-src', 'style-src']) {
      expect(csp[directive]).not.toContain("'unsafe-inline'")
      expect(csp[directive]).not.toContain("'unsafe-eval'")
    }
  })

  it('lets app pages show Discord avatars and CDN preview images', async () => {
    const csp = directives((await page('/')).headers.get('content-security-policy')!)
    expect(csp['img-src']).toEqual(["'self'", 'https://cdn.discordapp.com', new URL(env.CDN_BASE).origin])
  })

  it('only loads Swagger UI from the pinned CDN path, with subresource integrity', async () => {
    const res = await page('/docs')
    const html = await res.text()
    const csp = directives(res.headers.get('content-security-policy')!)
    expect(csp['script-src']).toContain(SWAGGER_BASE)
    expect(csp['style-src']).toContain(SWAGGER_BASE)

    const tags = [...external(html, /<script src="[^"]+"[^>]*>/g), ...external(html, /<link rel="stylesheet"[^>]*>/g)]
    expect(tags).toHaveLength(2)
    for (const tag of tags) {
      expect(tag).toMatch(new RegExp(`(src|href)="${SWAGGER_BASE.replace(/[.]/g, '\\.')}`))
      expect(tag).toMatch(/integrity="sha384-[A-Za-z0-9+/]+={0,2}"/)
      expect(tag).toContain('crossorigin="anonymous"')
    }
  })

  it('applies the app policy to JSON responses too', async () => {
    expect(directives((await request('/v1/tracks')).headers.get('content-security-policy')!)['default-src']).toEqual(["'none'"])
  })
})

describe('security headers', () => {
  it.each(['/', '/docs', '/v1/tracks', '/openapi.json', '/health', '/nope'])('are set on %s', async (path) => {
    const res = await request(path)
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(res.headers.get('strict-transport-security')).toMatch(/max-age=\d+/)
  })
})

describe('CSRF protection', () => {
  const crossSite = { origin: 'https://evil.example' }

  it('rejects cross-site uploads', async () => {
    const { cookie } = await createCreator()
    const form = new FormData()
    form.append('name', 'Evil')
    form.append('creatorName', 'Evil')
    form.append('createdDate', '2024-01-01')
    form.append('lev', file(LEV, 'evil.lev'))
    const res = await request('/upload', { method: 'POST', cookie, body: form, headers: crossSite })
    expect(res.status).toBe(403)
    expect(await storedKeys()).toEqual([])
  })

  it('rejects cross-site admin actions with simple content types', async () => {
    const { cookie } = await createAdmin()
    const pending = await createUser()
    const track = await insertTrack()

    const del = await request(`/admin/api/tracks/${track.id}`, { method: 'DELETE', cookie, headers: crossSite })
    const approve = await request(`/admin/api/users/${pending.discordId}/approval`, {
      method: 'POST',
      cookie,
      headers: { ...crossSite, 'content-type': 'text/plain' },
      body: JSON.stringify({ approved: true }),
    })

    expect(del.status).toBe(403)
    expect(approve.status).toBe(403)
    expect(await getTrackRow(track.id)).not.toBeNull()
    expect((await page('/upload', { cookie: pending.cookie })).status).toBe(403)
  })

  it('rejects state-changing requests that carry neither Origin nor Sec-Fetch-Site', async () => {
    const { cookie } = await createAdmin()
    const track = await insertTrack()
    const res = await app.request(`/admin/api/tracks/${track.id}`, { method: 'DELETE', headers: { cookie } }, env)
    expect(res.status).toBe(403)
  })

  it('accepts same-origin requests identified by Sec-Fetch-Site', async () => {
    const { cookie } = await createAdmin()
    const track = await insertTrack()
    const res = await app.request(`/admin/api/tracks/${track.id}`, { method: 'DELETE', headers: { cookie, 'sec-fetch-site': 'same-origin' } }, env)
    expect(res.status).toBe(200)
  })
})