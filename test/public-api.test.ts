import { env, exports } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { openApiSpec } from '../src/openapi'
import { dbFailingOn, insertTrack, request } from './helpers'

type TrackPage = { tracks: { id: string; name: string; creatorName: string }[]; total: number; limit: number; offset: number }

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

const getPage = async (path: string) => {
  const res = await request(path)
  expect(res.status).toBe(200)
  return (await res.json()) as TrackPage
}

const ids = (page: TrackPage) => page.tracks.map((t) => t.id)

const fullTrack = {
  id: 'full',
  name: 'Crash Cove Remix',
  description: 'Tropical remix',
  creator_name: 'Ann',
  uploaded_by_name: 'Bob',
  created_date: '2023-12-24',
  uploaded_at: '2024-01-02T03:04:05.678Z',
  lev_key: 'tracks/full.lev',
  lev_size: 1000,
  lev_sha256: '1'.repeat(64),
  vrm_key: 'tracks/full.vrm',
  vrm_size: 2000,
  vrm_sha256: '2'.repeat(64),
  sca_key: 'tracks/full.sca',
  sca_size: 3000,
  sca_sha256: '3'.repeat(64),
  preview_key: 'tracks/full-preview-abcdef012345.jpg',
  preview_type: 'image/jpeg',
  preview_size: 4000,
  preview_width: 1280,
  preview_height: 720,
  preview_sha256: '4'.repeat(64),
}

describe('GET /v1/tracks', () => {
  it('returns an empty page when there are no tracks', async () => {
    expect(await getPage('/v1/tracks')).toEqual({ tracks: [], total: 0, limit: 50, offset: 0 })
  })

  it('serializes a track with only a .lev file', async () => {
    await insertTrack({
      id: 'lev-only',
      name: 'Tiny Arena',
      description: 'Small',
      creator_name: 'Ann',
      uploaded_by_name: 'Bob',
      created_date: '2023-01-01',
      uploaded_at: '2024-01-01T00:00:00.000Z',
      lev_size: 123,
      lev_sha256: 'f'.repeat(64),
    })
    expect((await getPage('/v1/tracks')).tracks).toEqual([
      {
        id: 'lev-only',
        name: 'Tiny Arena',
        description: 'Small',
        creatorName: 'Ann',
        uploadedBy: 'Bob',
        uploadedDate: '2024-01-01T00:00:00.000Z',
        createdDate: '2023-01-01',
        files: {
          lev: { url: 'https://cdn.example.test/tracks/lev-only.lev', size: 123, sha256: 'f'.repeat(64) },
          vrm: null,
          sca: null,
        },
        previewImage: null,
      },
    ])
  })

  it('serializes optional files and the preview image', async () => {
    await insertTrack(fullTrack)
    const [track] = (await getPage('/v1/tracks')).tracks as unknown as [Record<string, unknown>]
    expect(track.files).toEqual({
      lev: { url: 'https://cdn.example.test/tracks/full.lev', size: 1000, sha256: '1'.repeat(64) },
      vrm: { url: 'https://cdn.example.test/tracks/full.vrm', size: 2000, sha256: '2'.repeat(64) },
      sca: { url: 'https://cdn.example.test/tracks/full.sca', size: 3000, sha256: '3'.repeat(64) },
    })
    expect(track.previewImage).toEqual({
      url: 'https://cdn.example.test/tracks/full-preview-abcdef012345.jpg',
      contentType: 'image/jpeg',
      width: 1280,
      height: 720,
      size: 4000,
      sha256: '4'.repeat(64),
    })
  })

  it('does not double the slash when CDN_BASE ends with one', async () => {
    await insertTrack({ id: 'slash' })
    const options = { env: { CDN_BASE: 'https://cdn.example.test/' } }
    type Track = { files: { lev: { url: string } } }
    const { tracks } = (await (await request('/v1/tracks', options)).json()) as { tracks: Track[] }
    const single = (await (await request('/v1/tracks/slash', options)).json()) as Track
    expect(tracks[0].files.lev.url).toBe('https://cdn.example.test/tracks/slash.lev')
    expect(single.files.lev.url).toBe('https://cdn.example.test/tracks/slash.lev')
  })

  it('lists the newest uploads first', async () => {
    await insertTrack({ id: 'middle', uploaded_at: minutesAgo(2) })
    await insertTrack({ id: 'newest', uploaded_at: minutesAgo(1) })
    await insertTrack({ id: 'oldest', uploaded_at: minutesAgo(3) })
    expect(ids(await getPage('/v1/tracks'))).toEqual(['newest', 'middle', 'oldest'])
  })

  it('paginates with limit and offset and reports the total', async () => {
    for (let i = 1; i <= 5; i++) await insertTrack({ id: `t${i}`, uploaded_at: minutesAgo(i) })
    const page = await getPage('/v1/tracks?limit=2&offset=1')
    expect(ids(page)).toEqual(['t2', 't3'])
    expect(page).toMatchObject({ total: 5, limit: 2, offset: 1 })
    expect(await getPage('/v1/tracks?offset=10')).toMatchObject({ tracks: [], total: 5, offset: 10 })
  })

  it.each([
    ['limit=0', 1],
    ['limit=-5', 1],
    ['limit=100', 100],
    ['limit=101', 100],
    ['limit=99999999999999999999', 50],
    ['limit=abc', 50],
    ['limit=2.5', 50],
    ['limit=', 50],
    ['limit=%20', 50],
  ])('normalizes %s to a limit of %i', async (query, limit) => {
    expect((await getPage(`/v1/tracks?${query}`)).limit).toBe(limit)
  })

  it.each([
    ['offset=-3', 0],
    ['offset=xyz', 0],
    ['offset=1.5', 0],
    ['offset=', 0],
    ['offset=7', 7],
  ])('normalizes %s to an offset of %i', async (query, offset) => {
    expect((await getPage(`/v1/tracks?${query}`)).offset).toBe(offset)
  })

  it('is cacheable for 60 seconds', async () => {
    expect((await request('/v1/tracks')).headers.get('cache-control')).toBe('public, max-age=60')
  })
})

describe('GET /v1/tracks/search', () => {
  const seed = async () => {
    await insertTrack({ id: 'cove', name: 'Crash Cove Remix', creator_name: 'Ann', uploaded_at: minutesAgo(1) })
    await insertTrack({ id: 'ruins', name: 'Roo Tubes Ruins', creator_name: 'Bob', uploaded_at: minutesAgo(2) })
    await insertTrack({ id: 'cove2', name: 'Cove Night', creator_name: 'Bob', uploaded_at: minutesAgo(3) })
  }

  it.each(['', '?name=', '?name=%20%20&creator=%09', '?limit=5'])('requires a name or creator (%s)', async (query) => {
    const res = await request(`/v1/tracks/search${query}`)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Provide at least one of "name" or "creator"' })
  })

  it.each(['name', 'creator'])('rejects a %s over 100 characters', async (param) => {
    const res = await request(`/v1/tracks/search?${param}=${'a'.repeat(101)}`)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Search terms are too long (max 100 characters)' })
  })

  it('measures term length after trimming', async () => {
    expect((await request(`/v1/tracks/search?name=${'a'.repeat(100)}%20%20`)).status).toBe(200)
  })

  it('matches part of the name, ignoring ASCII case', async () => {
    await seed()
    expect(ids(await getPage('/v1/tracks/search?name=COVE'))).toEqual(['cove', 'cove2'])
  })

  it('matches part of the creator name', async () => {
    await seed()
    expect(ids(await getPage('/v1/tracks/search?creator=bo'))).toEqual(['ruins', 'cove2'])
  })

  it('requires both to match when both are given', async () => {
    await seed()
    expect(ids(await getPage('/v1/tracks/search?name=cove&creator=bob'))).toEqual(['cove2'])
  })

  it('trims search terms', async () => {
    await seed()
    expect(ids(await getPage('/v1/tracks/search?name=%20Ruins%20'))).toEqual(['ruins'])
  })

  it.each([
    ['%25', ['percent']],
    ['_', ['underscore']],
    ['%5C', ['backslash']],
  ])('treats %s literally rather than as a wildcard', async (term, expected) => {
    await insertTrack({ id: 'percent', name: '100% Speed' })
    await insertTrack({ id: 'underscore', name: 'snake_case' })
    await insertTrack({ id: 'backslash', name: 'Back\\slash' })
    await insertTrack({ id: 'plain', name: 'Plain 100 Speed snakeXcase' })
    expect(ids(await getPage(`/v1/tracks/search?name=${term}`))).toEqual(expected)
  })

  it('paginates results and reports the matching total', async () => {
    await seed()
    const page = await getPage('/v1/tracks/search?name=cove&limit=1&offset=1')
    expect(ids(page)).toEqual(['cove2'])
    expect(page).toMatchObject({ total: 2, limit: 1, offset: 1 })
  })

  it('returns an empty page when nothing matches', async () => {
    await seed()
    expect(await getPage('/v1/tracks/search?name=zzz')).toEqual({ tracks: [], total: 0, limit: 50, offset: 0 })
  })

  it('is not mistaken for a track id', async () => {
    await insertTrack({ id: 'search', name: 'Literally named search' })
    expect((await request('/v1/tracks/search')).status).toBe(400)
  })

  it('is cacheable for 60 seconds', async () => {
    expect((await request('/v1/tracks/search?name=a')).headers.get('cache-control')).toBe('public, max-age=60')
  })
})

describe('GET /v1/tracks/:id', () => {
  it('returns the track', async () => {
    await insertTrack(fullTrack)
    const res = await request('/v1/tracks/full')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    expect(await res.json()).toMatchObject({ id: 'full', name: 'Crash Cove Remix', creatorName: 'Ann' })
  })

  it('matches the list representation', async () => {
    await insertTrack(fullTrack)
    expect(await (await request('/v1/tracks/full')).json()).toEqual((await getPage('/v1/tracks')).tracks[0])
  })

  it('returns 404 for unknown ids', async () => {
    const res = await request('/v1/tracks/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
  })
})

describe('CORS', () => {
  const publicPaths = ['/v1/tracks', '/v1/tracks/search?name=a', '/v1/tracks/full', '/openapi.json']

  it.each(publicPaths)('allows any origin to read %s', async (path) => {
    await insertTrack({ id: 'full' })
    const res = await request(path, { headers: { origin: 'https://fork.example' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it.each(publicPaths)('answers preflight requests for %s', async (path) => {
    const res = await request(path, {
      method: 'OPTIONS',
      headers: { origin: 'https://fork.example', 'access-control-request-method': 'GET', 'access-control-request-headers': 'content-type' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toContain('GET')
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('content-type')
  })

  it('is not enabled for private endpoints', async () => {
    for (const path of ['/admin/api/users', '/upload', '/health']) {
      const res = await request(path, { headers: { origin: 'https://fork.example' } })
      expect(res.headers.get('access-control-allow-origin'), path).toBeNull()
    }
  })
})

describe('GET /openapi.json', () => {
  it('serves the OpenAPI spec', async () => {
    const res = await request('/openapi.json')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^application\/json/)
    expect(await res.json()).toEqual(openApiSpec)
  })
})

describe('GET /docs', () => {
  it('serves Swagger UI pointed at the spec', async () => {
    const res = await request('/docs')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/html/)
    const html = await res.text()
    expect(html).toContain('<div id="swagger-ui"></div>')
    expect(html).toContain("SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui' });")
  })
})

describe('GET /health', () => {
  it('reports ok when the database responds', async () => {
    const res = await request('/health')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('reports an error when the database is down', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await request('/health', { env: { DB: dbFailingOn(/^SELECT 1$/) } })
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ status: 'error' })
    expect(logged).toHaveBeenCalledWith('Health check failed', expect.any(Error))
  })

  it('is served by the Worker entrypoint', async () => {
    const res = await exports.default.fetch('http://localhost/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
})

describe('GET /files/* (local development only)', () => {
  const local = { LOCAL_FILES: 'true' }

  it('is disabled unless LOCAL_FILES is "true"', async () => {
    await env.FILES.put('tracks/a.lev', 'data')
    for (const LOCAL_FILES of ['false', '1', 'TRUE', undefined]) {
      expect((await request('/files/tracks/a.lev', { env: { LOCAL_FILES } })).status).toBe(404)
    }
  })

  it('serves stored track files with their content type and ETag', async () => {
    const stored = await env.FILES.put('tracks/a-preview.png', new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: 'image/png' } })
    const res = await request('/files/tracks/a-preview.png', { env: local })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('etag')).toBe(stored!.httpEtag)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('defaults to application/octet-stream', async () => {
    await env.FILES.put('tracks/a.lev', 'data')
    const res = await request('/files/tracks/a.lev', { env: local })
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(await res.text()).toBe('data')
  })

  it('decodes percent-encoded keys', async () => {
    await env.FILES.put('tracks/my track.lev', 'spaced')
    const res = await request('/files/tracks/my%20track.lev', { env: local })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('spaced')
  })

  it.each(['/files/secret.txt', '/files/tracks/../secret.txt', '/files/tracks%2F..%2Fsecret.txt', '/files/Tracks/secret.txt'])(
    'does not serve objects outside tracks/ (%s)',
    async (path) => {
      await env.FILES.put('secret.txt', 'top secret')
      expect((await request(path, { env: local })).status).toBe(404)
    },
  )

  it('returns 404 for missing files and malformed paths', async () => {
    expect((await request('/files/tracks/missing.lev', { env: local })).status).toBe(404)
    expect((await request('/files/tracks/%E0%A4%A', { env: local })).status).toBe(404)
  })
})

it('returns 404 for unknown routes', async () => {
  expect((await request('/nope')).status).toBe(404)
  expect((await request('/v2/tracks')).status).toBe(404)
})