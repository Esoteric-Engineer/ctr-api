import { env } from 'cloudflare:workers'
import { betterAuth } from 'better-auth'
import { testUtils } from 'better-auth/plugins'
import app from '../src/index'
import { authOptions } from '../src/auth-config'
import type { TrackRow } from '../src/types'

export const ORIGIN = 'http://localhost'
export const ADMIN_DISCORD_ID = '900000000000000001'

type Bindings = typeof env

type RequestOptions = RequestInit & { cookie?: string; json?: unknown; env?: Partial<Bindings> }

export const request = async (path: string, { cookie, json, env: overrides, ...init }: RequestOptions = {}) => {
  const headers = new Headers(init.headers)
  if (cookie) headers.set('cookie', cookie)
  if (json !== undefined) {
    headers.set('content-type', 'application/json')
    init.body = JSON.stringify(json)
  }
  if (init.method && !['GET', 'HEAD'].includes(init.method) && !headers.has('origin')) headers.set('origin', ORIGIN)
  return app.request(path, { ...init, headers }, overrides ? { ...env, ...overrides } : env)
}

export const page = (path: string, options: RequestOptions = {}) =>
  request(path, { ...options, headers: { accept: 'text/html,application/xhtml+xml', ...options.headers } })

const testAuth = betterAuth({ ...authOptions(env), database: env.DB, plugins: [testUtils()] })

let seq = 0

type UserOptions = { discordId?: string; name?: string; approved?: boolean; image?: string | null; createdAt?: Date }

export async function createUser({ discordId = `1${String(++seq).padStart(17, '0')}`, name = 'Racer', approved = false, image = null, createdAt }: UserOptions = {}) {
  const ctx = await testAuth.$context
  const user = await ctx.test.saveUser(
    ctx.test.createUser({ name, email: `${discordId}@discord.invalid`, emailVerified: false, image, approved, ...(createdAt && { createdAt }) }),
  )
  await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: 'discord', accountId: discordId })
  const headers = await ctx.test.getAuthHeaders({ userId: user.id })
  return { id: user.id, discordId, name, cookie: headers.get('cookie')! }
}

export type TestUser = Awaited<ReturnType<typeof createUser>>

export const createCreator = (options: UserOptions = {}) => createUser({ approved: true, ...options })
export const createAdmin = (options: UserOptions = {}) => createUser({ discordId: ADMIN_DISCORD_ID, name: 'Admin', ...options })

export type SeedRow = Partial<TrackRow> & { uploaded_by_id?: string }

export async function insertTrack(overrides: SeedRow = {}) {
  const id = overrides.id ?? crypto.randomUUID()
  const uploader = overrides.uploaded_by_id ? null : await createCreator({ name: 'Uploader' })
  const row = {
    id,
    name: 'Test Track',
    description: '',
    creator_name: 'Creator',
    uploaded_by_id: uploader?.id,
    uploaded_by_name: 'Uploader',
    created_date: '2024-01-01',
    uploaded_at: new Date().toISOString(),
    lev_key: `tracks/${id}.lev`,
    lev_size: 4,
    lev_sha256: 'a'.repeat(64),
    vrm_key: null,
    vrm_size: null,
    vrm_sha256: null,
    sca_key: null,
    sca_size: null,
    sca_sha256: null,
    preview_key: null,
    preview_type: null,
    preview_size: null,
    preview_width: null,
    preview_height: null,
    preview_sha256: null,
    ...overrides,
  }
  const columns = Object.keys(row)
  await env.DB.prepare(`INSERT INTO tracks (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .bind(...Object.values(row))
    .run()
  for (const key of [row.lev_key, row.vrm_key, row.sca_key, row.preview_key]) {
    if (key) await env.FILES.put(key, `contents of ${key}`)
  }
  return row
}

export const getTrackRow = (id: string) =>
  env.DB.prepare('SELECT * FROM tracks WHERE id = ?').bind(id).first<TrackRow & { uploaded_by_id: string }>()

export const countTracks = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM tracks').first<{ n: number }>())!.n

export const storedKeys = async () => (await env.FILES.list()).objects.map((o) => o.key).sort()

export const readObject = async (key: string) => {
  const obj = await env.FILES.get(key)
  return obj && { bytes: new Uint8Array(await obj.arrayBuffer()), contentType: obj.httpMetadata?.contentType }
}

const override = <T extends object>(target: T, methods: Partial<T>): T =>
  new Proxy(target, {
    get(t, prop) {
      if (prop in methods) return methods[prop as keyof T]
      const value = Reflect.get(t, prop)
      return typeof value === 'function' ? value.bind(t) : value
    },
  })

const outage = () => Promise.reject(new Error('Simulated outage'))

const intercept = (stmt: D1PreparedStatement, before: () => Promise<unknown>): D1PreparedStatement =>
  override(stmt, {
    bind: (...values: unknown[]) => intercept(stmt.bind(...values), before),
    run: () => before().then(() => stmt.run()),
    first: (column?: string) => before().then(() => stmt.first(column as string)),
    all: () => before().then(() => stmt.all()),
  } as Partial<D1PreparedStatement>)

export const dbHook = (pattern: RegExp, before: () => Promise<unknown>) =>
  override(env.DB, {
    prepare: (sql: string) => (pattern.test(sql) ? intercept(env.DB.prepare(sql), before) : env.DB.prepare(sql)),
  })

export const dbFailingOn = (pattern: RegExp) => dbHook(pattern, outage)

export const filesFailingOn = ({ put, del }: { put?: RegExp; del?: boolean }) =>
  override(env.FILES, {
    ...(put && { put: ((key: string, ...rest: unknown[]) => (put.test(key) ? outage() : (env.FILES.put as Function)(key, ...rest))) as R2Bucket['put'] }),
    ...(del && { delete: outage }),
  })

export const sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('')