import { describe, expect, it } from 'vitest'
import { adminPage, forbiddenPage, homePage, pendingPage, submitPage, uploadPage } from '../src/pages'
import type { SessionUser } from '../src/types'

const user = (overrides: Partial<SessionUser> = {}): SessionUser => ({
  id: 'u1',
  discordId: '123456789012345678',
  username: 'Ann',
  avatarUrl: null,
  approved: false,
  isAdmin: false,
  ...overrides,
})

const render = async (page: unknown) => String(await page)

const navLinks = (html: string) => [...html.matchAll(/<nav class="nav-links">([\s\S]*?)<\/nav>/g)][0][1].match(/href="[^"]+"/g)

describe('navigation', () => {
  it('shows guests a login link', async () => {
    const html = await render(homePage(null))
    expect(navLinks(html)).toEqual(['href="/docs"', 'href="/submit"'])
    expect(html).toContain('href="/auth/login"')
    expect(html).not.toContain('/auth/logout')
  })

  it('hides Upload and Admin from pending users', async () => {
    const html = await render(homePage(user()))
    expect(navLinks(html)).toEqual(['href="/docs"', 'href="/submit"'])
    expect(html).toContain('action="/auth/logout"')
    expect(html).not.toContain('href="/auth/login"')
  })

  it('shows Upload to approved creators', async () => {
    expect(navLinks(await render(homePage(user({ approved: true }))))).toEqual(['href="/docs"', 'href="/submit"', 'href="/upload"'])
  })

  it('shows Upload and Admin to admins, even unapproved ones', async () => {
    expect(navLinks(await render(homePage(user({ isAdmin: true }))))).toEqual(['href="/docs"', 'href="/submit"', 'href="/upload"', 'href="/admin"'])
  })

  it('logs out with a POST form', async () => {
    expect(await render(homePage(user()))).toMatch(/<form method="post" action="\/auth\/logout">/)
  })

  it('shows the avatar when there is one', async () => {
    const html = await render(homePage(user({ avatarUrl: 'https://cdn.discordapp.com/avatars/1/abc.png?size=64' })))
    expect(html).toContain('<img class="avatar" src="https://cdn.discordapp.com/avatars/1/abc.png?size=64"')
    expect(html).not.toContain('<span class="avatar avatar-fallback"')
  })

  it.each([
    ['ann', 'A'],
    ['éclair', 'É'],
    ['🏎️ speedy', '🏎'],
    ['', '?'],
  ])('falls back to the first character of %j', async (username, initial) => {
    const html = await render(homePage(user({ username })))
    expect(html).toContain(`<span class="avatar avatar-fallback" aria-hidden="true">${initial}</span>`)
  })

  it('escapes the username', async () => {
    const html = await render(homePage(user({ username: '"><script>alert(1)</script>' })))
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('aria-label="Account menu for &quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"')
    expect(html).toContain('<b>&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;</b>')
  })
})

describe('homePage', () => {
  it('points guests and pending users at the submit page', async () => {
    for (const u of [null, user()]) {
      const html = await render(homePage(u))
      expect(html).toContain('<a class="btn-link ghost" href="/submit">Submit Content</a>')
      expect(html).not.toContain('Upload a track')
    }
  })

  it('points creators and admins at the upload page', async () => {
    for (const u of [user({ approved: true }), user({ isAdmin: true })]) {
      expect(await render(homePage(u))).toContain('<a class="btn-link ghost" href="/upload">Upload a track</a>')
    }
  })
})

describe('submitPage', () => {
  it('asks guests to log in', async () => {
    const html = await render(submitPage(null))
    expect(html).toMatch(/<a class="btn-link with-icon" href="\/auth\/login">[\s\S]*Log In<\/a>/)
  })

  it('sends pending users to the Discord server', async () => {
    const html = await render(submitPage(user()))
    expect(html).toContain('<a class="btn-link" href="https://customteamracing.com/discord">Join the Discord</a>')
    expect(html).not.toContain('Go to Upload')
  })

  it('sends creators to the upload page', async () => {
    expect(await render(submitPage(user({ approved: true })))).toContain('<a class="btn-link" href="/upload">Go to Upload</a>')
  })
})

describe('pendingPage', () => {
  it('shows the Discord ID to send to an admin', async () => {
    expect(await render(pendingPage(user()))).toContain('<code>123456789012345678</code>')
  })
})

describe('forbiddenPage', () => {
  it('explains the page is for admins', async () => {
    expect(await render(forbiddenPage(user()))).toContain('<h1>Admins only</h1>')
  })
})

describe('uploadPage', () => {
  it('prefills the creator name with the escaped username', async () => {
    const html = await render(uploadPage(user({ approved: true, username: 'Ann "Speedy" <3' })))
    expect(html).toContain('<input name="creatorName" required maxlength="100" value="Ann &quot;Speedy&quot; &lt;3">')
  })

  it('has inputs for every upload field', async () => {
    const html = await render(uploadPage(user({ approved: true })))
    for (const name of ['name', 'description', 'creatorName', 'createdDate', 'lev', 'vrm', 'sca', 'preview']) {
      expect(html).toMatch(new RegExp(`<(input|textarea) name="${name}"`))
    }
    expect(html).toMatch(/<input name="lev" type="file" accept=".lev" required>/)
  })

  it('states the preview limits', async () => {
    expect(await render(uploadPage(user({ approved: true })))).toContain('PNG or JPEG, up to 1 MB and 1920x1080.')
  })
})

describe('adminPage', () => {
  it('has containers for the creators table and the track list', async () => {
    const html = await render(adminPage(user({ isAdmin: true })))
    expect(html).toContain('<tbody id="users"></tbody>')
    expect(html).toContain('<div id="tracks"></div>')
  })
})