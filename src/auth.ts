import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import type { AppEnv } from './types'
import { getAuth } from './auth-config'
import { forbiddenPage, pendingPage } from './pages'

export const auth = new Hono<AppEnv>()

auth.on(['GET', 'POST'], '/api/auth/*', (c) => getAuth(c.env).handler(c.req.raw))

const redirectWithCookies = (c: Context<AppEnv>, location: string, headers: Headers, status: 302 | 303 = 302) => {
  const res = c.redirect(location, status)
  for (const cookie of headers.getSetCookie()) res.headers.append('set-cookie', cookie)
  return res
}

// Plain link target so pages don't need client-side JS
auth.get('/auth/login', async (c) => {
  const { headers, response } = await getAuth(c.env).api.signInSocial({
    body: { provider: 'discord', callbackURL: '/upload' },
    headers: c.req.raw.headers,
    returnHeaders: true,
  })
  if (!response.url) return c.text('Discord login failed', 502)
  return redirectWithCookies(c, response.url, headers)
})

auth.post('/auth/logout', async (c) => {
  const { headers } = await getAuth(c.env).api.signOut({ headers: c.req.raw.headers, returnHeaders: true })
  return redirectWithCookies(c, '/', headers, 303)
})

export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('user', null)
  const session = await getAuth(c.env).api.getSession({ headers: c.req.raw.headers })
  if (session) {
    const { user } = session
    const account = await c.env.DB.prepare('SELECT accountId FROM account WHERE userId = ?1 AND providerId = ?2')
      .bind(user.id, 'discord')
      .first<{ accountId: string }>()
    if (account) {
      const admins = c.env.ADMIN_DISCORD_IDS.split(',').map((s) => s.trim()).filter(Boolean)
      c.set('user', {
        id: user.id,
        discordId: account.accountId,
        username: user.name,
        approved: user.approved,
        isAdmin: admins.includes(account.accountId),
      })
    }
  }
  await next()
}

export const guard = (level: 'creator' | 'admin'): MiddlewareHandler<AppEnv> => async (c, next) => {
  const user = c.get('user')
  // Only browser navigations get redirects/HTML; fetch() calls (Accept: */*) get JSON errors.
  const isPage = c.req.method === 'GET' && (c.req.header('accept') ?? '').includes('text/html')
  if (!user) return isPage ? c.redirect('/auth/login') : c.json({ error: 'Not logged in' }, 401)
  const ok = level === 'admin' ? user.isAdmin : user.approved || user.isAdmin
  if (!ok) {
    if (!isPage) return c.json({ error: 'Forbidden' }, 403)
    return c.html(level === 'admin' ? forbiddenPage(user) : pendingPage(user), 403)
  }
  await next()
}