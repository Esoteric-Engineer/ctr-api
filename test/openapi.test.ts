import { describe, expect, it } from 'vitest'
import { openApiSpec } from '../src/openapi'
import { PREVIEW_RULES } from '../src/validate'
import { insertTrack, request } from './helpers'

type Schema = { [key: string]: any }

const spec: Schema = openApiSpec

const resolve = (ref: string): Schema => ref.replace(/^#\//, '').split('/').reduce((node, key) => node[key], spec)

function violations(value: unknown, schema: Schema, path = '$'): string[] {
  if (schema.$ref) return violations(value, resolve(schema.$ref), path)
  if (value === null) return schema.nullable ? [] : [`${path} is null`]
  if (schema.allOf) return schema.allOf.flatMap((s: Schema) => violations(value, s, path))

  const errors: string[] = []
  const fail = (message: string) => errors.push(`${path} ${message}`)
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) return [`${path} is not an object`]
      for (const key of schema.required ?? []) if (!(key in value)) fail(`is missing "${key}"`)
      for (const [key, v] of Object.entries(value)) {
        if (schema.properties?.[key]) errors.push(...violations(v, schema.properties[key], `${path}.${key}`))
        else fail(`has undocumented property "${key}"`)
      }
      break
    }
    case 'array':
      if (!Array.isArray(value)) return [`${path} is not an array`]
      value.forEach((item, i) => errors.push(...violations(item, schema.items, `${path}[${i}]`)))
      break
    case 'string':
      if (typeof value !== 'string') return [`${path} is not a string`]
      if (schema.maxLength !== undefined && value.length > schema.maxLength) fail(`is longer than ${schema.maxLength}`)
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(`does not match ${schema.pattern}`)
      if (schema.enum && !schema.enum.includes(value)) fail(`is not one of ${schema.enum.join(', ')}`)
      if (schema.format === 'uri' && !URL.canParse(value)) fail('is not a URI')
      if (schema.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('is not a date')
      break
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return [`${path} is not an integer`]
      if (schema.minimum !== undefined && value < schema.minimum) fail(`is below ${schema.minimum}`)
      if (schema.maximum !== undefined && value > schema.maximum) fail(`is above ${schema.maximum}`)
      break
    default:
      throw new Error(`Unsupported schema at ${path}: ${JSON.stringify(schema)}`)
  }
  return errors
}

const seed = async () => {
  await insertTrack({ id: 'minimal', name: 'Minimal', creator_name: 'Ann' })
  await insertTrack({
    id: 'full',
    name: 'N'.repeat(100),
    description: 'D'.repeat(2000),
    creator_name: 'C'.repeat(100),
    vrm_key: 'tracks/full.vrm',
    vrm_size: 10,
    vrm_sha256: 'b'.repeat(64),
    sca_key: 'tracks/full.sca',
    sca_size: 20,
    sca_sha256: 'c'.repeat(64),
    preview_key: 'tracks/full-preview-0123456789ab.png',
    preview_type: 'image/png',
    preview_size: PREVIEW_RULES.maxBytes,
    preview_width: PREVIEW_RULES.maxWidth,
    preview_height: PREVIEW_RULES.minHeight,
    preview_sha256: 'd'.repeat(64),
  })
}

const cases: [specPath: string, status: number, url: string][] = [
  ['/tracks', 200, '/v1/tracks'],
  ['/tracks/search', 200, '/v1/tracks/search?name=a'],
  ['/tracks/search', 400, '/v1/tracks/search'],
  ['/tracks/{id}', 200, '/v1/tracks/full'],
  ['/tracks/{id}', 404, '/v1/tracks/missing'],
]

describe('OpenAPI contract', () => {
  it('covers every documented response', () => {
    const documented = Object.entries(spec.paths as Record<string, Schema>).flatMap(([path, item]) =>
      Object.keys(item.get.responses).map((status) => `${path} ${status}`),
    )
    expect(cases.map(([path, status]) => `${path} ${status}`).sort()).toEqual(documented.sort())
  })

  it.each(cases)('%s responds with a documented %i', async (specPath, status, url) => {
    await seed()
    const res = await request(url)
    expect(res.status).toBe(status)

    const documented = spec.paths[specPath].get.responses[status]
    const body = await res.json()
    expect(violations(body, documented.content['application/json'].schema)).toEqual([])
    for (const header of Object.keys(documented.headers ?? {})) {
      expect(res.headers.get(header)).toBe(documented.headers[header].schema.example)
    }
  })

  it('returns at least one fully populated track in the list', async () => {
    await seed()
    const { tracks } = (await (await request('/v1/tracks')).json()) as { tracks: Schema[] }
    expect(tracks.find((t) => t.id === 'full')).toMatchObject({ files: { vrm: expect.any(Object), sca: expect.any(Object) }, previewImage: expect.any(Object) })
  })

  it.each(['/tracks', '/tracks/search'])('documents the pagination parameters of %s accurately', async (specPath) => {
    const params = Object.fromEntries(spec.paths[specPath].get.parameters.map((p: Schema) => [p.name, p.schema]))
    const url = `/v1${specPath}?name=a`
    const page = async (query: string) => (await (await request(`${url}&${query}`)).json()) as { limit: number; offset: number }

    expect((await page('')).limit).toBe(params.limit.default)
    expect((await page('')).offset).toBe(params.offset.default)
    expect((await page('limit=0')).limit).toBe(params.limit.minimum)
    expect((await page('limit=1000')).limit).toBe(params.limit.maximum)
    expect((await page('offset=-1')).offset).toBe(params.offset.minimum)
  })

  it('documents the search term limit accurately', async () => {
    const { maxLength } = spec.paths['/tracks/search'].get.parameters.find((p: Schema) => p.name === 'name').schema
    expect((await request(`/v1/tracks/search?name=${'a'.repeat(maxLength)}`)).status).toBe(200)
    expect((await request(`/v1/tracks/search?name=${'a'.repeat(maxLength + 1)}`)).status).toBe(400)
  })

  it('documents the preview image limits accurately', () => {
    const { width, height, size } = spec.components.schemas.PreviewImage.properties
    expect([width.minimum, width.maximum]).toEqual([PREVIEW_RULES.minWidth, PREVIEW_RULES.maxWidth])
    expect([height.minimum, height.maximum]).toEqual([PREVIEW_RULES.minHeight, PREVIEW_RULES.maxHeight])
    expect(size.maximum).toBe(PREVIEW_RULES.maxBytes)
  })

  it('detects responses that drift from the spec', () => {
    const drifted = { id: 'x', name: 5, uploaded_by_id: 'secret', previewImage: { contentType: 'image/gif' } }
    expect(violations(drifted, { $ref: '#/components/schemas/Track' })).toEqual(
      expect.arrayContaining([
        '$ is missing "files"',
        '$.name is not a string',
        '$ has undocumented property "uploaded_by_id"',
        '$.previewImage is missing "url"',
        '$.previewImage.contentType is not one of image/png, image/jpeg',
      ]),
    )
  })

  it('only references schemas that exist', () => {
    const refs = JSON.stringify(spec).match(/"#\/components\/schemas\/[^"]+"/g)!
    for (const ref of refs) expect(resolve(JSON.parse(ref)), ref).toBeTypeOf('object')
  })
})