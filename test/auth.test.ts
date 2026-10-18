import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { ADMIN_DISCORD_ID, ORIGIN, createAdmin, createCreator, createUser, page, request } from './helpers'

type Profile = { id: string; username: string; global_name: string | null; avatar: string | null }

const discordProfile = (overrides: Partial<Profile> = {}): Profile => ({
  id: '345678901234567890',
  username: 'ann_racer',
  global_name: 'Ann',
  avatar: 'a1b2c3',
  ...overrides,
})

const cookiesFrom = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((c) => !c.endsWith('='))
    .join('; ')

function mockDiscord(profile: Profile) {
  const calls: Request[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const req = new Request(input, init)
    const url = decodeURIComponent(req.url)
    calls.push(req.clone())
    if (req.method === 'POST' && url === 'https://discord.com/api/oauth2/token') {
      return Response.json({ access_token: 'discord-access-token', token_type: 'Bearer', expires_in: 604800, refresh_token: 'discord-refresh-token', scope: 'identify' })
    }
    if (url === 'https://discord.com/api/users/@me' && req.headers.get('authorization') === 'Bearer discord-access-token') {
      return Response.json({ discriminator: '0', verified: true, ...profile })
    }
    throw new Error(`Unexpected outbound request: ${req.method} ${url}`)
  })
  return calls
}

async function loginWithDiscord(profile: Profile) {
  const calls = mockDiscord(profile)
  const start = await request('/auth/login')
  const state = new URL(start.headers.get('location')!).searchParams.get('state')
  const callback = await request(`/api/auth/callback/discord?code=test-code&state=${state}`, { cookie: cookiesFrom(start) })
  return { callback, cookie: cookiesFrom(callback), calls }
}

const userByDiscordId = (discordId: string) =>
  env.DB.prepare(`SELECT u.* FROM "user" u JOIN account a ON a.userId = u.id WHERE a.accountId = ? AND a.providerId = 'discord'`)
    .bind(discordId)
    .first<{ id: string; name: string; email: string; emailVerified: number; image: string | null; approved: number }>()

describe('Discord login', () => {
  it('redirects to Discord asking only for the identify scope', async () => {
    const res = await request('/auth/login')
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://discord.com/api/oauth2/authorize')
    expect(location.searchParams.get('client_id')).toBe('test-client-id')
    expect(location.searchParams.get('scope')).toBe('identify')
    expect(location.searchParams.get('response_type')).toBe('code')
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback/discord`)
    expect(location.searchParams.get('state')).toBeTruthy()
    expect(res.headers.getSetCookie().length).toBeGreaterThan(0)
  })

  it('creates a pending user from the Discord profile and signs them in', async () => {
    const { callback, cookie } = await loginWithDiscord(discordProfile())

    expect(callback.status).toBe(302)
    expect(callback.headers.get('location')).toMatch(/^(http:\/\/localhost)?\/upload$/)
    expect(await userByDiscordId('345678901234567890')).toMatchObject({
      name: 'Ann',
      email: '345678901234567890@discord.invalid',
      emailVerified: 0,
      image: 'https://cdn.discordapp.com/avatars/345678901234567890/a1b2c3.png',
      approved: 0,
    })

    const home = await (await page('/', { cookie })).text()
    expect(home).toContain('<b>Ann</b>')
    expect(home).toContain('src="https://cdn.discordapp.com/avatars/345678901234567890/a1b2c3.png?size=64"')
  })

  it('exchanges the code with the configured client credentials', async () => {
    const { calls } = await loginWithDiscord(discordProfile())
    const tokenRequest = calls.find((c) => c.url === 'https://discord.com/api/oauth2/token')!
    const body = new URLSearchParams(await tokenRequest.text())
    const basic = tokenRequest.headers.get('authorization')
    const credentials = basic ? atob(basic.replace(/^Basic /, '')) : `${body.get('client_id')}:${body.get('client_secret')}`
    expect(body.get('code')).toBe('test-code')
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(credentials).toBe('test-client-id:test-client-secret')
  })

  it('falls back to the username when there is no display name', async () => {
    await loginWithDiscord(discordProfile({ global_name: null }))
    expect((await userByDiscordId('345678901234567890'))!.name).toBe('ann_racer')
  })

  it('refreshes the name and avatar on later logins without touching approval', async () => {
    await loginWithDiscord(discordProfile())
    await env.DB.prepare('UPDATE "user" SET approved = 1').run()

    const { cookie } = await loginWithDiscord(discordProfile({ global_name: 'Ann Renamed', avatar: null }))

    expect(await userByDiscordId('345678901234567890')).toMatchObject({ name: 'Ann Renamed', approved: 1 })
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM "user"').first<{ n: number }>())!.n).toBe(1)
    expect((await page('/upload', { cookie })).status).toBe(200)
  })

  it('treats a Discord ID in ADMIN_DISCORD_IDS as an admin', async () => {
    const { cookie } = await loginWithDiscord(discordProfile({ id: ADMIN_DISCORD_ID }))
    expect((await page('/admin', { cookie })).status).toBe(200)
  })

  it('rejects a callback whose state does not match', async () => {
    mockDiscord(discordProfile())
    const start = await request('/auth/login')
    const callback = await request('/api/auth/callback/discord?code=test-code&state=forged', { cookie: cookiesFrom(start) })

    expect(callback.headers.getSetCookie().some((c) => c.includes('session_token=') && !c.includes('session_token=;'))).toBe(false)
    expect(await userByDiscordId('345678901234567890')).toBeNull()
  })

  it('does not let users approve themselves', async () => {
    const { cookie } = await loginWithDiscord(discordProfile())
    expect((await request('/api/auth/update-user', { method: 'POST', cookie, json: { name: 'Renamed' } })).status).toBe(200)
    await request('/api/auth/update-user', { method: 'POST', cookie, json: { approved: true } })
    await request('/api/auth/update-user', { method: 'POST', cookie, json: { name: 'Sneaky', approved: 1 } })
    expect((await userByDiscordId('345678901234567890'))!.approved).toBe(0)
  })
})

describe('logout', () => {
  it('ends the session and redirects home', async () => {
    const { cookie } = await createCreator()
    const res = await request('/auth/logout', { method: 'POST', cookie, headers: { 'content-type': 'application/x-www-form-urlencoded' } })

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
    expect(res.headers.getSetCookie().some((c) => /session_token=;/.test(c) || /Max-Age=0/i.test(c))).toBe(true)
    expect((await page('/upload', { cookie })).headers.get('location')).toBe('/auth/login')
  })

  it('still redirects home when there is no session', async () => {
    const res = await request('/auth/logout', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
  })

  it('rejects cross-site logout forms', async () => {
    const { cookie } = await createCreator()
    const res = await request('/auth/logout', { method: 'POST', cookie, headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' } })
    expect(res.status).toBe(403)
    expect((await page('/upload', { cookie })).status).toBe(200)
  })
})

describe('access control', () => {
  describe('guests', () => {
    it('are redirected to login when navigating to protected pages', async () => {
      for (const path of ['/upload', '/admin']) {
        const res = await page(path)
        expect(res.status).toBe(302)
        expect(res.headers.get('location')).toBe('/auth/login')
      }
    })

    it('get a 401 from protected endpoints', async () => {
      for (const [method, path] of [['GET', '/upload'], ['POST', '/upload'], ['GET', '/admin/api/users'], ['DELETE', '/admin/api/tracks/x']]) {
        const res = await request(path, { method })
        expect(res.status).toBe(401)
        expect(await res.json()).toEqual({ error: 'Not logged in' })
      }
    })

    it('get a 401 rather than a redirect for non-GET requests that accept HTML', async () => {
      expect((await page('/upload', { method: 'POST' })).status).toBe(401)
    })
  })

  describe('pending users', () => {
    it('see the pending page with their Discord ID', async () => {
      const { cookie, discordId } = await createUser()
      const res = await page('/upload', { cookie })
      expect(res.status).toBe(403)
      const html = await res.text()
      expect(html).toContain('Waiting for approval')
      expect(html).toContain(`<code>${discordId}</code>`)
    })

    it('get a 403 from creator endpoints', async () => {
      const { cookie } = await createUser()
      for (const method of ['GET', 'POST']) {
        const res = await request('/upload', { method, cookie })
        expect(res.status).toBe(403)
        expect(await res.json()).toEqual({ error: 'Forbidden' })
      }
    })
  })

  describe('creators', () => {
    it('can open the upload page', async () => {
      const res = await page('/upload', { cookie: (await createCreator()).cookie })
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('<h1>Upload a track</h1>')
    })

    it('cannot open the admin page', async () => {
      const { cookie } = await createCreator()
      const res = await page('/admin', { cookie })
      expect(res.status).toBe(403)
      expect(await res.text()).toContain('Admins only')
    })

    it('get a 403 from admin endpoints', async () => {
      const { cookie } = await createCreator()
      for (const [method, path] of [['GET', '/admin/api/users'], ['POST', '/admin/api/users/1/approval'], ['PATCH', '/admin/api/tracks/x'], ['DELETE', '/admin/api/tracks/x'], ['PUT', '/admin/api/tracks/x/preview'], ['DELETE', '/admin/api/tracks/x/preview']]) {
        const res = await request(path, { method, cookie })
        expect(res.status, `${method} ${path}`).toBe(403)
        expect(await res.json()).toEqual({ error: 'Forbidden' })
      }
    })
  })

  describe('admins', () => {
    it('can open the admin and upload pages without being approved', async () => {
      const { cookie } = await createAdmin({ approved: false })
      expect((await page('/admin', { cookie })).status).toBe(200)
      expect((await page('/upload', { cookie })).status).toBe(200)
    })

    it('are matched against every trimmed entry of ADMIN_DISCORD_IDS', async () => {
      const { cookie } = await createUser({ discordId: '900000000000000002' })
      expect((await page('/admin', { cookie })).status).toBe(200)
    })

    it('must match a Discord ID exactly', async () => {
      const { cookie } = await createUser({ discordId: ADMIN_DISCORD_ID.slice(0, -1) })
      expect((await page('/admin', { cookie })).status).toBe(403)
    })
  })

  it('treats a session without a linked Discord account as a guest', async () => {
    const { cookie, id } = await createCreator()
    await env.DB.prepare('DELETE FROM account WHERE userId = ?').bind(id).run()
    expect((await page('/upload', { cookie })).headers.get('location')).toBe('/auth/login')
  })

  it('treats a forged session cookie as a guest', async () => {
    const { cookie } = await createCreator()
    const forged = cookie.replace(/=([^.]+)\./, '=forged-token.')
    expect((await page('/upload', { cookie: forged })).headers.get('location')).toBe('/auth/login')
  })

  it('only shows avatars hosted on the Discord CDN', async () => {
    const discord = await createUser({ image: 'https://cdn.discordapp.com/avatars/1/abc.png' })
    const other = await createUser({ image: 'https://evil.example/tracker.png' })
    expect(await (await page('/', { cookie: discord.cookie })).text()).toContain('src="https://cdn.discordapp.com/avatars/1/abc.png?size=64"')
    const html = await (await page('/', { cookie: other.cookie })).text()
    expect(html).not.toContain('evil.example')
    expect(html).toContain('<span class="avatar avatar-fallback"')
  })
})