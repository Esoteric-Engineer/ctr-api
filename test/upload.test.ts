import { describe, expect, it, vi } from 'vitest'
import { FILE_RULES, PREVIEW_RULES } from '../src/validate'
import { LEV, VRM, bytesOfSize, file, jpeg, png, replaceChunk, sca, utf8 } from './fixtures'
import { countTracks, createAdmin, createCreator, dbFailingOn, filesFailingOn, getTrackRow, readObject, request, sha256, storedKeys } from './helpers'
import type { TestUser } from './helpers'

type Fields = Record<string, string | File | null>

const form = (fields: Fields = {}) => {
  const all: Fields = { name: 'Crash Cove Remix', description: 'A tropical remix', creatorName: 'Ann', createdDate: '2024-05-01', lev: file(LEV, 'cove.lev'), ...fields }
  const body = new FormData()
  for (const [key, value] of Object.entries(all)) if (value !== null) body.append(key, value)
  return body
}

const serialize = async (body: FormData) => {
  const res = new Response(body)
  const bytes = new Uint8Array(await res.arrayBuffer())
  return { bytes, headers: { 'content-type': res.headers.get('content-type')!, 'content-length': String(bytes.length) } }
}

const upload = (user: TestUser, body: BodyInit, init: RequestInit = {}) => request('/upload', { method: 'POST', cookie: user.cookie, body, ...init })

const uploadOk = async (user: TestUser, body: FormData) => {
  const res = await upload(user, body)
  expect(res.status, await res.clone().text()).toBe(200)
  return ((await res.json()) as { id: string }).id
}

describe('POST /upload', () => {
  it('stores a track with only a .lev file', async () => {
    const creator = await createCreator({ name: 'Ann Uploader' })
    const before = new Date().toISOString()
    const id = await uploadOk(creator, form())

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(await storedKeys()).toEqual([`tracks/${id}.lev`])
    expect(await readObject(`tracks/${id}.lev`)).toEqual({ bytes: LEV, contentType: 'application/octet-stream' })

    const row = (await getTrackRow(id))!
    expect(row).toMatchObject({
      name: 'Crash Cove Remix',
      description: 'A tropical remix',
      creator_name: 'Ann',
      uploaded_by_id: creator.id,
      uploaded_by_name: 'Ann Uploader',
      created_date: '2024-05-01',
      lev_key: `tracks/${id}.lev`,
      lev_size: LEV.length,
      lev_sha256: await sha256(LEV),
      vrm_key: null,
      sca_key: null,
      preview_key: null,
    })
    expect(row.uploaded_at >= before && row.uploaded_at <= new Date().toISOString()).toBe(true)
  })

  it('stores the optional .vrm, .sca and PNG preview', async () => {
    const song = sca()
    const preview = png(1280, 720)
    const id = await uploadOk(await createCreator(), form({ vrm: file(VRM, 'cove.vrm'), sca: file(song, 'cove.sca'), preview: file(preview, 'shot.png') }))
    const previewKey = `tracks/${id}-preview-${(await sha256(preview)).slice(0, 12)}.png`

    expect(await storedKeys()).toEqual([previewKey, `tracks/${id}.lev`, `tracks/${id}.sca`, `tracks/${id}.vrm`])
    expect(await readObject(`tracks/${id}.vrm`)).toEqual({ bytes: VRM, contentType: 'application/octet-stream' })
    expect(await readObject(`tracks/${id}.sca`)).toEqual({ bytes: song, contentType: 'application/octet-stream' })
    expect(await readObject(previewKey)).toEqual({ bytes: preview, contentType: 'image/png' })
    expect(await getTrackRow(id)).toMatchObject({
      vrm_key: `tracks/${id}.vrm`,
      vrm_size: VRM.length,
      vrm_sha256: await sha256(VRM),
      sca_key: `tracks/${id}.sca`,
      sca_size: song.length,
      sca_sha256: await sha256(song),
      preview_key: previewKey,
      preview_type: 'image/png',
      preview_size: preview.length,
      preview_width: 1280,
      preview_height: 720,
      preview_sha256: await sha256(preview),
    })
  })

  it('stores a JPEG preview with a .jpg key', async () => {
    const preview = jpeg(640, 360)
    const id = await uploadOk(await createCreator(), form({ preview: file(preview, 'shot.jpeg') }))
    const key = `tracks/${id}-preview-${(await sha256(preview)).slice(0, 12)}.jpg`
    expect(await readObject(key)).toEqual({ bytes: preview, contentType: 'image/jpeg' })
    expect(await getTrackRow(id)).toMatchObject({ preview_key: key, preview_type: 'image/jpeg', preview_width: 640, preview_height: 360 })
  })

  it('publishes the track on the public API', async () => {
    const creator = await createCreator({ name: 'Uploader' })
    const id = await uploadOk(creator, form())
    const track = await (await request(`/v1/tracks/${id}`)).json()
    expect(track).toMatchObject({
      id,
      name: 'Crash Cove Remix',
      creatorName: 'Ann',
      uploadedBy: 'Uploader',
      files: { lev: { url: `https://cdn.example.test/tracks/${id}.lev`, size: LEV.length, sha256: await sha256(LEV) }, vrm: null, sca: null },
      previewImage: null,
    })
  })

  it('trims text fields', async () => {
    const id = await uploadOk(await createCreator(), form({ name: '  Cove  ', description: '\n Desc \n', creatorName: '\tAnn ', createdDate: ' 2024-05-01 ' }))
    expect(await getTrackRow(id)).toMatchObject({ name: 'Cove', description: 'Desc', creator_name: 'Ann', created_date: '2024-05-01' })
  })

  it('treats the description as optional', async () => {
    const id = await uploadOk(await createCreator(), form({ description: null }))
    expect((await getTrackRow(id))!.description).toBe('')
  })

  it('ignores file inputs the browser submits empty', async () => {
    const empty = () => new File([], '', { type: 'application/octet-stream' })
    const id = await uploadOk(await createCreator(), form({ vrm: empty(), sca: empty(), preview: empty() }))
    expect(await storedKeys()).toEqual([`tracks/${id}.lev`])
  })

  it('accepts uppercase file extensions', async () => {
    await uploadOk(await createCreator(), form({ lev: file(LEV, 'COVE.LEV'), vrm: file(VRM, 'Cove.Vrm') }))
  })

  it('accepts values at the length limits and leap days', async () => {
    await uploadOk(await createCreator(), form({ name: 'n'.repeat(100), creatorName: 'c'.repeat(100), description: 'd'.repeat(2000), createdDate: '2024-02-29' }))
  })

  it('gives every upload its own id', async () => {
    const creator = await createCreator()
    const a = await uploadOk(creator, form())
    const b = await uploadOk(creator, form())
    expect(a).not.toBe(b)
    expect(await countTracks()).toBe(2)
  })

  it('takes the uploader and id from the server, not the form', async () => {
    const creator = await createCreator({ name: 'Real Name' })
    const id = await uploadOk(creator, form({ id: 'chosen-id', uploadedBy: 'Mallory', uploaded_by_id: 'someone-else', uploaded_by_name: 'Mallory' }))
    expect(id).not.toBe('chosen-id')
    expect(await getTrackRow(id)).toMatchObject({ uploaded_by_id: creator.id, uploaded_by_name: 'Real Name' })
  })

  it('lets unapproved admins upload', async () => {
    await uploadOk(await createAdmin({ approved: false }), form())
  })

  it.each<[string, Fields, string]>([
    ['a missing creator name', { creatorName: null }, 'Creator name is required.'],
    ['a blank creator name', { creatorName: '   ' }, 'Creator name is required.'],
    ['a creator name over 100 characters', { creatorName: 'c'.repeat(101) }, 'Creator name is too long (max 100 characters)'],
    ['a missing track name', { name: null }, 'Track name is required.'],
    ['a blank track name', { name: '\n\t ' }, 'Track name is required.'],
    ['a track name over 100 characters', { name: 'n'.repeat(101) }, 'Track name is too long (max 100 characters)'],
    ['a description over 2000 characters', { description: 'd'.repeat(2001) }, 'Description is too long (max 2000 characters)'],
    ['a missing created date', { createdDate: null }, 'Created date must be in format YYYY-MM-DD'],
    ['a US-style date', { createdDate: '05/01/2024' }, 'Created date must be in format YYYY-MM-DD'],
    ['an unpadded date', { createdDate: '2024-5-1' }, 'Created date must be in format YYYY-MM-DD'],
    ['an impossible date', { createdDate: '2023-02-29' }, 'Created date must be in format YYYY-MM-DD'],
    ['month 13', { createdDate: '2024-13-01' }, 'Created date must be in format YYYY-MM-DD'],
    ['a timestamp', { createdDate: '2024-05-01T00:00:00Z' }, 'Created date must be in format YYYY-MM-DD'],
    ['a file sent as the track name', { name: file(LEV, 'name.txt') }, 'Track name is required.'],
    ['no .lev file', { lev: null }, 'A .lev file is required'],
    ['an empty .lev file', { lev: file(new Uint8Array(0), 'cove.lev') }, 'A .lev file is required'],
    ['a .lev sent as text', { lev: 'LEV data' }, 'A .lev file is required'],
    ['a .lev with the wrong extension', { lev: file(LEV, 'cove.vrm') }, 'The lev file must have a .lev extension'],
    ['an oversized .lev', { lev: file(bytesOfSize(FILE_RULES.lev.maxBytes + 1), 'cove.lev') }, 'The .lev file is too large (max 2048 KB)'],
    ['a .vrm with the wrong extension', { vrm: file(VRM, 'cove.lev') }, 'The vrm file must have a .vrm extension'],
    ['an oversized .vrm', { vrm: file(bytesOfSize(FILE_RULES.vrm.maxBytes + 1), 'cove.vrm') }, 'The .vrm file is too large (max 1280 KB)'],
    ['an oversized .sca', { sca: file(bytesOfSize(FILE_RULES.sca.maxBytes + 1), 'cove.sca') }, 'The .sca file is too large (max 512 KB)'],
    ['a .sca that is not an SCA file', { sca: file(bytesOfSize(64), 'cove.sca') }, 'Not a valid .sca file (missing SCA header)'],
    ['a .sca with a bad META chunk', { sca: file(sca(replaceChunk('META', utf8('[]'))), 'cove.sca') }, 'Invalid .sca file: META must be a JSON object'],
    ['a GIF preview', { preview: file(utf8('GIF89a\x01\x00\x01\x00'), 'shot.png', 'image/png') }, 'The preview image must be a PNG or JPEG'],
    ['a tiny preview', { preview: file(png(100, 50), 'shot.png') }, 'The preview image is too small (100x50, min 160x90)'],
    ['a huge preview', { preview: file(jpeg(3840, 2160), 'shot.jpg') }, 'The preview image is too large (3840x2160, max 1920x1080)'],
    ['an oversized preview', { preview: file(png(320, 180, { padding: PREVIEW_RULES.maxBytes }), 'shot.png') }, 'The preview image is too large (max 1024 KB). Try a JPEG or a lower resolution.'],
  ])('rejects %s without storing anything', async (_, fields, error) => {
    const res = await upload(await createCreator(), form(fields))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error })
    expect(await storedKeys()).toEqual([])
    expect(await countTracks()).toBe(0)
  })

  it('rejects bodies that are not multipart form data', async () => {
    const creator = await createCreator()
    for (const init of [
      { body: JSON.stringify({ name: 'x' }), headers: { 'content-type': 'application/json' } },
      { body: 'name=x', headers: { 'content-type': 'multipart/form-data; boundary=nope' } },
    ]) {
      const res = await upload(creator, init.body, { headers: init.headers })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Body must be multipart form data' })
    }
  })

  it('accepts a submission with every file at its maximum size', async () => {
    const biggestSca = sca(replaceChunk('BANK', (() => {
      const bank = new Uint8Array(0x64000)
      bank[0] = 2
      return bank
    })()))
    const biggestPreview = png(1920, 1080, { padding: PREVIEW_RULES.maxBytes - png(1920, 1080).length })
    const { bytes, headers } = await serialize(form({
      name: 'n'.repeat(100),
      creatorName: 'c'.repeat(100),
      description: 'd'.repeat(2000),
      lev: file(bytesOfSize(FILE_RULES.lev.maxBytes), 'big.lev'),
      vrm: file(bytesOfSize(FILE_RULES.vrm.maxBytes), 'big.vrm'),
      sca: file(biggestSca, 'big.sca'),
      preview: file(biggestPreview, 'big.png'),
    }))
    const res = await upload(await createCreator(), bytes, { headers })
    expect(res.status, await res.clone().text()).toBe(200)
  })

  it('rejects a declared body size over the combined file limits', async () => {
    const { bytes, headers } = await serialize(form())
    const res = await upload(await createCreator(), bytes, { headers: { ...headers, 'content-length': String(10 * 1024 * 1024) } })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'Upload is too large' })
    expect(await countTracks()).toBe(0)
  })

  it('removes stored files when a later file fails to store', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await request('/upload', {
      method: 'POST',
      cookie: (await createCreator()).cookie,
      body: form({ vrm: file(VRM, 'cove.vrm'), sca: file(sca(), 'cove.sca'), preview: file(png(320, 180), 'shot.png') }),
      env: { FILES: filesFailingOn({ put: /\.sca$/ }) },
    })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Upload failed, please try again' })
    expect(await storedKeys()).toEqual([])
    expect(await countTracks()).toBe(0)
    expect(logged).toHaveBeenCalledWith('Upload failed', expect.any(String), expect.any(Error))
  })

  it('removes stored files when the database insert fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await request('/upload', {
      method: 'POST',
      cookie: (await createCreator()).cookie,
      body: form({ vrm: file(VRM, 'cove.vrm'), preview: file(png(320, 180), 'shot.png') }),
      env: { DB: dbFailingOn(/^INSERT INTO tracks/) },
    })
    expect(res.status).toBe(500)
    expect(await storedKeys()).toEqual([])
    expect(await countTracks()).toBe(0)
  })
})