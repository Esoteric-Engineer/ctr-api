import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PREVIEW_RULES } from '../src/validate'
import { file, jpeg, png, utf8 } from './fixtures'
import { createAdmin, createCreator, createUser, dbFailingOn, dbHook, filesFailingOn, getTrackRow, insertTrack, page, readObject, request, sha256, storedKeys } from './helpers'
import type { TestUser } from './helpers'

let admin: TestUser

beforeEach(async () => {
  admin = await createAdmin({ approved: true, createdAt: new Date('2020-01-01T00:00:00Z') })
})

const asAdmin = (path: string, init: Parameters<typeof request>[1] = {}) => request(path, { cookie: admin.cookie, ...init })

const previewForm = (image: File | string | null) => {
  const body = new FormData()
  if (image !== null) body.append('preview', image)
  return body
}

const previewKeyFor = async (id: string, bytes: Uint8Array<ArrayBuffer>, ext: string) => `tracks/${id}-preview-${(await sha256(bytes)).slice(0, 12)}.${ext}`

describe('GET /admin/api/users', () => {
  it('lists pending users first, newest first within each group', async () => {
    await createCreator({ name: 'Old Creator', createdAt: new Date('2024-01-01T00:00:00Z') })
    await createUser({ name: 'Old Pending', createdAt: new Date('2024-02-01T00:00:00Z') })
    await createUser({ name: 'New Pending', createdAt: new Date('2024-03-01T00:00:00Z') })
    await createCreator({ name: 'New Creator', createdAt: new Date('2024-04-01T00:00:00Z') })

    const res = await asAdmin('/admin/api/users')
    expect(res.status).toBe(200)
    const { users } = (await res.json()) as { users: { username: string; approved: boolean; discordId: string }[] }
    expect(users.map((u) => [u.username, u.approved])).toEqual([
      ['New Pending', false],
      ['Old Pending', false],
      ['New Creator', true],
      ['Old Creator', true],
      ['Admin', true],
    ])
    expect(users.at(-1)).toEqual({ discordId: admin.discordId, username: 'Admin', approved: true })
  })
})

describe('POST /admin/api/users/:discordId/approval', () => {
  it('approves a pending user so they can upload', async () => {
    const user = await createUser()
    const res = await asAdmin(`/admin/api/users/${user.discordId}/approval`, { method: 'POST', json: { approved: true } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect((await page('/upload', { cookie: user.cookie })).status).toBe(200)
  })

  it('revokes approval', async () => {
    const creator = await createCreator()
    await asAdmin(`/admin/api/users/${creator.discordId}/approval`, { method: 'POST', json: { approved: false } })
    expect((await page('/upload', { cookie: creator.cookie })).status).toBe(403)
  })

  it('succeeds when the user already has that status', async () => {
    const creator = await createCreator()
    expect((await asAdmin(`/admin/api/users/${creator.discordId}/approval`, { method: 'POST', json: { approved: true } })).status).toBe(200)
  })

  it('only changes the targeted user', async () => {
    const target = await createUser()
    const bystander = await createUser()
    await asAdmin(`/admin/api/users/${target.discordId}/approval`, { method: 'POST', json: { approved: true } })
    expect((await page('/upload', { cookie: bystander.cookie })).status).toBe(403)
  })

  it('returns 404 for unknown Discord IDs', async () => {
    const res = await asAdmin('/admin/api/users/123/approval', { method: 'POST', json: { approved: true } })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'User not found' })
  })

  it.each([{}, { approved: 'true' }, { approved: 1 }, { approved: null }, [true], 'true', null])('rejects the body %j', async (json) => {
    const user = await createUser()
    const res = await asAdmin(`/admin/api/users/${user.discordId}/approval`, { method: 'POST', json })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Body must be {"approved": boolean}' })
  })

  it('rejects malformed JSON', async () => {
    const user = await createUser()
    const res = await asAdmin(`/admin/api/users/${user.discordId}/approval`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"approved": tru' })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /admin/api/tracks/:id', () => {
  const edit = { name: 'Renamed', description: 'New description', creatorName: 'New Creator', createdDate: '2022-02-22' }

  it('updates the metadata and leaves the files alone', async () => {
    const track = await insertTrack({ vrm_key: 'tracks/t.vrm', vrm_size: 9, vrm_sha256: 'e'.repeat(64) })
    const res = await asAdmin(`/admin/api/tracks/${track.id}`, { method: 'PATCH', json: edit })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const row = await getTrackRow(track.id)
    expect(row).toEqual({ ...track, name: 'Renamed', description: 'New description', creator_name: 'New Creator', created_date: '2022-02-22' })
    expect(await (await request(`/v1/tracks/${track.id}`)).json()).toMatchObject({ name: 'Renamed', creatorName: 'New Creator', createdDate: '2022-02-22' })
  })

  it('trims fields', async () => {
    const track = await insertTrack()
    await asAdmin(`/admin/api/tracks/${track.id}`, { method: 'PATCH', json: { name: ' A ', description: ' B ', creatorName: ' C ', createdDate: ' 2022-02-22 ' } })
    expect(await getTrackRow(track.id)).toMatchObject({ name: 'A', description: 'B', creator_name: 'C', created_date: '2022-02-22' })
  })

  it('returns 404 for unknown tracks', async () => {
    const res = await asAdmin('/admin/api/tracks/missing', { method: 'PATCH', json: edit })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Track not found' })
  })

  it.each([[[edit]], ['name'], [null], [42]])('rejects the non-object body %j', async (json) => {
    const track = await insertTrack()
    const res = await asAdmin(`/admin/api/tracks/${track.id}`, { method: 'PATCH', json })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Body must be a JSON object' })
  })

  it('rejects malformed JSON', async () => {
    const track = await insertTrack()
    const res = await asAdmin(`/admin/api/tracks/${track.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Body must be a JSON object' })
  })

  it.each([
    [{ ...edit, name: 5 }, 'name must be a string'],
    [{ ...edit, description: ['x'] }, 'description must be a string'],
    [{ ...edit, creatorName: { first: 'A' } }, 'creatorName must be a string'],
    [{ ...edit, createdDate: null }, 'createdDate must be a string'],
    [{ ...edit, name: '  ' }, 'Track name is required.'],
    [{ ...edit, name: undefined }, 'Track name is required.'],
    [{ ...edit, creatorName: undefined }, 'Creator name is required.'],
    [{ ...edit, name: 'n'.repeat(101) }, 'Track name is too long (max 100 characters)'],
    [{ ...edit, description: 'd'.repeat(2001) }, 'Description is too long (max 2000 characters)'],
    [{ ...edit, createdDate: '2022-02-30' }, 'Created date must be in format YYYY-MM-DD'],
  ])('rejects %j and leaves the track unchanged', async (json, error) => {
    const track = await insertTrack()
    const res = await asAdmin(`/admin/api/tracks/${track.id}`, { method: 'PATCH', json })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error })
    expect(await getTrackRow(track.id)).toEqual(track)
  })
})

describe('DELETE /admin/api/tracks/:id', () => {
  it('deletes the track and all of its files', async () => {
    const keep = await insertTrack({ id: 'keep' })
    const track = await insertTrack({
      id: 'doomed',
      vrm_key: 'tracks/doomed.vrm',
      sca_key: 'tracks/doomed.sca',
      preview_key: 'tracks/doomed-preview-0123456789ab.png',
    })
    const res = await asAdmin(`/admin/api/tracks/${track.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(await getTrackRow('doomed')).toBeNull()
    expect(await getTrackRow('keep')).not.toBeNull()
    expect(await storedKeys()).toEqual([keep.lev_key])
    expect((await request('/v1/tracks/doomed')).status).toBe(404)
  })

  it('returns 404 for unknown tracks', async () => {
    const res = await asAdmin('/admin/api/tracks/missing', { method: 'DELETE' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Track not found' })
  })

  it('still deletes the track when its files cannot be removed', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const track = await insertTrack()
    const res = await asAdmin(`/admin/api/tracks/${track.id}`, { method: 'DELETE', env: { FILES: filesFailingOn({ del: true }) } })
    expect(res.status).toBe(200)
    expect(await getTrackRow(track.id)).toBeNull()
    expect(logged).toHaveBeenCalledWith('Orphaned R2 objects after deleting track', track.id, [track.lev_key], expect.any(Error))
  })
})

describe('PUT /admin/api/tracks/:id/preview', () => {
  const put = (id: string, body: BodyInit, init: Parameters<typeof request>[1] = {}) => asAdmin(`/admin/api/tracks/${id}/preview`, { method: 'PUT', body, ...init })

  it('sets a preview on a track without one', async () => {
    const track = await insertTrack()
    const image = png(1280, 720)
    const res = await put(track.id, previewForm(file(image, 'shot.png')))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const key = await previewKeyFor(track.id, image, 'png')
    expect(await readObject(key)).toEqual({ bytes: image, contentType: 'image/png' })
    expect(await getTrackRow(track.id)).toMatchObject({
      preview_key: key,
      preview_type: 'image/png',
      preview_size: image.length,
      preview_width: 1280,
      preview_height: 720,
      preview_sha256: await sha256(image),
    })
    expect(((await (await request(`/v1/tracks/${track.id}`)).json()) as { previewImage: unknown }).previewImage).toEqual({
      url: `https://cdn.example.test/${key}`,
      contentType: 'image/png',
      width: 1280,
      height: 720,
      size: image.length,
      sha256: await sha256(image),
    })
  })

  it('replaces an existing preview and deletes the old file', async () => {
    const track = await insertTrack({ preview_key: 'tracks/t-preview-old000000000.png', preview_type: 'image/png' })
    const image = jpeg(800, 450)
    expect((await put(track.id, previewForm(file(image, 'new.jpg')))).status).toBe(200)

    const key = await previewKeyFor(track.id, image, 'jpg')
    expect(await storedKeys()).toEqual([key, track.lev_key].sort())
    expect(await getTrackRow(track.id)).toMatchObject({ preview_key: key, preview_type: 'image/jpeg', preview_width: 800, preview_height: 450 })
  })

  it('keeps the file when the same image is uploaded again', async () => {
    const track = await insertTrack()
    const image = png(640, 360)
    await put(track.id, previewForm(file(image, 'a.png')))
    expect((await put(track.id, previewForm(file(image, 'b.png')))).status).toBe(200)

    const key = await previewKeyFor(track.id, image, 'png')
    expect(await readObject(key)).toEqual({ bytes: image, contentType: 'image/png' })
    expect((await getTrackRow(track.id))!.preview_key).toBe(key)
  })

  it('returns 404 for unknown tracks without storing anything', async () => {
    const res = await put('missing', previewForm(file(png(640, 360), 'a.png')))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Track not found' })
    expect(await storedKeys()).toEqual([])
  })

  it.each<[string, File | string | null, string]>([
    ['no preview', null, 'A preview image is required'],
    ['an empty file', new File([], ''), 'A preview image is required'],
    ['a text field', 'image', 'A preview image is required'],
    ['a non-image', file(utf8('hello'), 'a.png'), 'The preview image must be a PNG or JPEG'],
    ['a tiny image', file(png(10, 10), 'a.png'), 'The preview image is too small (10x10, min 160x90)'],
    ['an oversized file', file(png(320, 180, { padding: PREVIEW_RULES.maxBytes }), 'a.png'), 'The preview image is too large (max 1024 KB). Try a JPEG or a lower resolution.'],
  ])('rejects %s and leaves the track unchanged', async (_, image, error) => {
    const track = await insertTrack()
    const res = await put(track.id, previewForm(image))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error })
    expect(await storedKeys()).toEqual([track.lev_key])
    expect(await getTrackRow(track.id)).toEqual(track)
  })

  it('rejects bodies that are not multipart form data', async () => {
    const track = await insertTrack()
    const res = await put(track.id, JSON.stringify({ preview: 'x' }), { headers: { 'content-type': 'application/json' } })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Body must be multipart form data' })
  })

  it('rejects a declared body size over the preview limit', async () => {
    const track = await insertTrack()
    const res = await put(track.id, previewForm(file(png(640, 360), 'a.png')), { headers: { 'content-length': String(2 * 1024 * 1024) } })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'Upload is too large' })
  })

  it('discards the new image and keeps the old one when the database update fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const track = await insertTrack({ preview_key: 'tracks/t-preview-old000000000.png', preview_type: 'image/png' })
    const res = await put(track.id, previewForm(file(png(640, 360), 'new.png')), { env: { DB: dbFailingOn(/^UPDATE tracks SET preview_key/) } })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Upload failed, please try again' })
    expect(await storedKeys()).toEqual([track.lev_key, track.preview_key].sort())
    expect(await getTrackRow(track.id)).toEqual(track)
  })

  it('keeps the existing file when re-uploading the same image fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const track = await insertTrack()
    const image = png(640, 360)
    await put(track.id, previewForm(file(image, 'a.png')))
    const res = await put(track.id, previewForm(file(image, 'a.png')), { env: { DB: dbFailingOn(/^UPDATE tracks SET preview_key/) } })
    expect(res.status).toBe(500)
    expect(await readObject(await previewKeyFor(track.id, image, 'png'))).not.toBeNull()
  })

  it('leaves the track unchanged when the image cannot be stored', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const track = await insertTrack()
    const res = await put(track.id, previewForm(file(png(640, 360), 'new.png')), { env: { FILES: filesFailingOn({ put: /preview/ }) } })
    expect(res.status).toBe(500)
    expect(await getTrackRow(track.id)).toEqual(track)
  })

  it('discards the image if the track is deleted mid-upload', async () => {
    const track = await insertTrack()
    const deleteFirst = () => env.DB.prepare('DELETE FROM tracks WHERE id = ?').bind(track.id).run()
    const res = await put(track.id, previewForm(file(png(640, 360), 'new.png')), { env: { DB: dbHook(/^UPDATE tracks SET preview_key/, deleteFirst) } })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Track not found' })
    expect(await storedKeys()).toEqual([track.lev_key])
  })

  it('keeps the new image when the old one cannot be deleted', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const track = await insertTrack({ preview_key: 'tracks/t-preview-old000000000.png', preview_type: 'image/png' })
    const image = png(640, 360)
    const res = await put(track.id, previewForm(file(image, 'new.png')), { env: { FILES: filesFailingOn({ del: true }) } })
    expect(res.status).toBe(200)
    expect((await getTrackRow(track.id))!.preview_key).toBe(await previewKeyFor(track.id, image, 'png'))
    expect(logged).toHaveBeenCalledWith('Orphaned R2 object after replacing preview', track.id, track.preview_key, expect.any(Error))
  })
})

describe('DELETE /admin/api/tracks/:id/preview', () => {
  const withPreview = () =>
    insertTrack({
      vrm_key: 'tracks/t.vrm',
      preview_key: 'tracks/t-preview-0123456789ab.png',
      preview_type: 'image/png',
      preview_size: 100,
      preview_width: 320,
      preview_height: 180,
      preview_sha256: 'f'.repeat(64),
    })

  const cleared = { preview_key: null, preview_type: null, preview_size: null, preview_width: null, preview_height: null, preview_sha256: null }

  it('removes the preview image and its file', async () => {
    const track = await withPreview()
    const res = await asAdmin(`/admin/api/tracks/${track.id}/preview`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(await getTrackRow(track.id)).toEqual({ ...track, ...cleared })
    expect(await storedKeys()).toEqual([track.lev_key, track.vrm_key].sort())
  })

  it('succeeds when there is no preview', async () => {
    const track = await insertTrack()
    const res = await asAdmin(`/admin/api/tracks/${track.id}/preview`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await getTrackRow(track.id)).toEqual(track)
    expect(await storedKeys()).toEqual([track.lev_key])
  })

  it('returns 404 for unknown tracks', async () => {
    const res = await asAdmin('/admin/api/tracks/missing/preview', { method: 'DELETE' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Track not found' })
  })

  it('still clears the preview when its file cannot be removed', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const track = await withPreview()
    const res = await asAdmin(`/admin/api/tracks/${track.id}/preview`, { method: 'DELETE', env: { FILES: filesFailingOn({ del: true }) } })
    expect(res.status).toBe(200)
    expect(await getTrackRow(track.id)).toMatchObject(cleared)
    expect(logged).toHaveBeenCalledWith('Orphaned R2 object after removing preview', track.id, track.preview_key, expect.any(Error))
  })
})