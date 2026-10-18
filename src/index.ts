import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors'
import { csrf } from 'hono/csrf'
import type { AppEnv, Meta, TrackRow } from './types';
import { auth, loadUser, guard } from './auth';
import { adminPage, docsPage, homePage, submitPage, uploadPage } from './pages';
import { openApiSpec } from './openapi';
import { FILE_RULES, PREVIEW_RULES, checkFile, checkSca, readPreview, sha256Hex } from './validate';
import { baseHeaders, csp } from './security';
import type { FileKind, Preview } from './validate';


////////////// Helper Functions //////////////

const intParam = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value !== undefined && Number.isSafeInteger(n) ? n : fallback;
}

const readJsonObject = async (ctx: Context): Promise<Record<string, unknown> | null> => {
  const body = await ctx.req.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

const toTrack = (r: TrackRow, cdn: string) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  creatorName: r.creator_name,
  uploadedBy: r.uploaded_by_name,
  uploadedDate: r.uploaded_at,
  createdDate: r.created_date,
  files: {
    lev: { url: `${cdn}/${r.lev_key}`, size: r.lev_size, sha256: r.lev_sha256 },
    vrm: r.vrm_key ? { url: `${cdn}/${r.vrm_key}`, size: r.vrm_size, sha256: r.vrm_sha256 } : null,
    sca: r.sca_key ? { url: `${cdn}/${r.sca_key}`, size: r.sca_size, sha256: r.sca_sha256 } : null,
  },
  previewImage: r.preview_key
    ? { url: `${cdn}/${r.preview_key}`, contentType: r.preview_type, width: r.preview_width, height: r.preview_height, size: r.preview_size, sha256: r.preview_sha256 }
    : null,
})

const previewKey = (id: string, p: Preview) => `tracks/${id}-preview-${p.sha256.slice(0, 12)}.${p.ext}`;

const putPreview = (env: AppEnv['Bindings'], key: string, p: Preview) =>
  env.FILES.put(key, p.buf, { httpMetadata: { contentType: p.type } });

const trackPage = async (ctx: Context<AppEnv>, where: string, params: (string | number)[], limit: number, offset: number) => {
  const [count, page] = await ctx.env.DB.batch([
    ctx.env.DB.prepare(`SELECT COUNT(*) AS total FROM tracks${where}`).bind(...params),
    ctx.env.DB.prepare(`SELECT * FROM tracks${where} ORDER BY uploaded_at DESC LIMIT ? OFFSET ?`).bind(...params, limit, offset),
  ]);
  const total = (count.results[0] as { total: number }).total;
  ctx.header('Cache-Control', 'public, max-age=60');

  return ctx.json({ tracks: (page.results as TrackRow[]).map((rslt) => toTrack(rslt, cdnBase(ctx.env.CDN_BASE))), total, limit, offset });
}

const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, '\\$&')}%`;

const isValidDate =(s: string) => {
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function validateMeta(meta: Meta): string | null {
  if (!meta.creatorName) return 'Creator name is required.';
  if (meta.creatorName.length > 100) return 'Creator name is too long (max 100 characters)';
  if (!meta.name) return 'Track name is required.';
  if (meta.name.length > 100) return 'Track name is too long (max 100 characters)';
  if (meta.description.length > 2000) return 'Description is too long (max 2000 characters)'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.createdDate) || !isValidDate(meta.createdDate)) return 'Created date must be in format YYYY-MM-DD';
  return null;
}


////////////// Setup //////////////

const app = new Hono<AppEnv>()
app.use('*', baseHeaders, csp('app'))
app.use('*', csrf())

app.route('/', auth)

app.get('/', loadUser, (ctx) => ctx.html(homePage(ctx.get('user'))))

app.get('/submit', loadUser, (ctx) => ctx.html(submitPage(ctx.get('user'))))

const cdnBase =(base: string) => base.replace(/\/$/, '');


////////////// Public API //////////////

app.get('/docs', csp('docs'), (ctx) => ctx.html(docsPage()))
app.get('/openapi.json', cors(), (ctx) => ctx.json(openApiSpec))

app.get('/health', async (ctx) => {
  ctx.header('Cache-Control', 'no-store');
  try {
    await ctx.env.DB.prepare('SELECT 1').first();
  } catch (err) {
    console.error('Health check failed', err);
    return ctx.json({ status: 'error' }, 503);
  }
  return ctx.json({ status: 'ok' });
})

const v1 = new Hono<AppEnv>();

v1.get('/tracks', cors(), async (ctx) => {
  const limit = Math.min(Math.max(intParam(ctx.req.query('limit'), 50), 1), 100);
  const offset = Math.max(intParam(ctx.req.query('offset'), 0), 0);

  return trackPage(ctx, '', [], limit, offset);
})

// Must be registered before /tracks/:id, or "search" is treated as an id.
v1.get('/tracks/search', cors(), async (ctx) => {
  const name = ctx.req.query('name')?.trim();
  const creator = ctx.req.query('creator')?.trim();
  if (!name && !creator) return ctx.json({ error: 'Provide at least one of "name" or "creator"' }, 400);
  if ((name?.length ?? 0) > 100 || (creator?.length ?? 0) > 100) return ctx.json({ error: 'Search terms are too long (max 100 characters)' }, 400);

  const limit = Math.min(Math.max(intParam(ctx.req.query('limit'), 50), 1), 100);
  const offset = Math.max(intParam(ctx.req.query('offset'), 0), 0);

  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (name) {
    conditions.push(`name LIKE ? ESCAPE '\\'`);
    params.push(likePattern(name));
  }
  if (creator) {
    conditions.push(`creator_name LIKE ? ESCAPE '\\'`);
    params.push(likePattern(creator));
  }

  return trackPage(ctx, ` WHERE ${conditions.join(' AND ')}`, params, limit, offset);
})

v1.get('/tracks/:id', cors(), async (ctx) => {
  const row = await ctx.env.DB.prepare('SELECT * FROM tracks WHERE id = ?')
    .bind(ctx.req.param('id'))
    .first<TrackRow>();
  if (!row) return ctx.json({ error: 'Not found' }, 404);
  ctx.header('Cache-Control', 'public, max-age=60');

  return ctx.json(toTrack(row, cdnBase(ctx.env.CDN_BASE)));
})

app.route('/v1', v1)

// only for local dev
app.get('/files/*', async (ctx) => {
  if (ctx.env.LOCAL_FILES !== 'true') return ctx.notFound();

  let key: string;
  try {
    key = decodeURIComponent(new URL(ctx.req.url).pathname.slice('/files/'.length));
  } catch {
    return ctx.notFound();
  }
  if (!key.startsWith('tracks/')) return ctx.notFound();

  const obj = await ctx.env.FILES.get(key);
  if (!obj) return ctx.notFound();

  return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream', ETag: obj.httpEtag } });
})


////////////// Creators //////////////

const creator = new Hono<AppEnv>();
creator.use('*', loadUser);

creator.get('/', guard('creator'), (ctx) => ctx.html(uploadPage(ctx.get('user')!)));

const maxUploadBytes = Object.values(FILE_RULES).reduce((sum, rule) => sum + rule.maxBytes, PREVIEW_RULES.maxBytes + 64 * 1024);

creator.post('/', guard('creator'), async (ctx) => {
  if (Number(ctx.req.header('content-length') ?? 0) > maxUploadBytes) return ctx.json({ error: 'Upload is too large' }, 413);

  const form = await ctx.req.formData().catch(() => null);
  if (!form) return ctx.json({ error: 'Body must be multipart form data' }, 400);

  const text = (key: string) => {
    const value = form.get(key);
    return typeof value === 'string' ? value.trim() : '';
  }
  const meta: Meta = {
    name: text('name'),
    description: text('description'),
    creatorName: text('creatorName'),
    createdDate: text('createdDate'),
  };
  const problem = validateMeta(meta);
  if (problem) return ctx.json({ error: problem }, 400);

  const files: Partial<Record<FileKind, ArrayBuffer>> = {};
  const hashes: Partial<Record<FileKind, string>> = {};
  for (const kind of Object.keys(FILE_RULES) as FileKind[]) {
    const value = form.get(kind);
    if (!(value instanceof File) || value.size === 0) {
      if (FILE_RULES[kind].required) return ctx.json({ error: `A .${kind} file is required` }, 400);
      continue;
    }
    const fileProblem = checkFile(kind, value);
    if (fileProblem) return ctx.json({ error: fileProblem }, 400);
    const buf = await value.arrayBuffer();
    const contentProblem = kind === 'sca' ? checkSca(buf) : null;
    if (contentProblem) return ctx.json({ error: contentProblem }, 400);
    files[kind] = buf;
    hashes[kind] = await sha256Hex(buf);
  }

  let preview: Preview | null = null;
  const previewValue = form.get('preview');
  if (previewValue instanceof File && previewValue.size > 0) {
    const result = await readPreview(previewValue);
    if (typeof result === 'string') return ctx.json({ error: result }, 400);
    preview = result;
  }

  const id = crypto.randomUUID();
  const keys: Partial<Record<FileKind | 'preview', string>> = {};
  try {
    for (const [kind, buf] of Object.entries(files) as [FileKind, ArrayBuffer][]) {
      const key = `tracks/${id}.${kind}`;
      await ctx.env.FILES.put(key, buf, { httpMetadata: { contentType: 'application/octet-stream' } });
      keys[kind] = key;
    }
    if (preview) {
      const key = previewKey(id, preview);
      await putPreview(ctx.env, key, preview);
      keys.preview = key;
    }

    const user = ctx.get('user')!;
    await ctx.env.DB.prepare(
      `INSERT INTO tracks (id, name, description, creator_name, uploaded_by_id, uploaded_by_name, created_date, uploaded_at,
         lev_key, lev_size, lev_sha256, vrm_key, vrm_size, vrm_sha256, sca_key, sca_size, sca_sha256,
         preview_key, preview_type, preview_size, preview_width, preview_height, preview_sha256)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, meta.name, meta.description, meta.creatorName, user.id, user.username, meta.createdDate,
        new Date().toISOString(),
        keys.lev, files.lev!.byteLength, hashes.lev,
        keys.vrm ?? null, files.vrm?.byteLength ?? null, hashes.vrm ?? null,
        keys.sca ?? null, files.sca?.byteLength ?? null, hashes.sca ?? null,
        keys.preview ?? null, preview?.type ?? null, preview?.buf.byteLength ?? null,
        preview?.width ?? null, preview?.height ?? null, preview?.sha256 ?? null)
      .run();
  } catch (err) {
    console.error('Upload failed', id, err);
    await ctx.env.FILES.delete(Object.values(keys)).catch(() => {});
    return ctx.json({ error: 'Upload failed, please try again' }, 500);
  }

  return ctx.json({ id });
})

app.route('/upload', creator)


////////////// Admin //////////////

const admin = new Hono<AppEnv>();
admin.use('*', loadUser, guard('admin'));

admin.get('/', (ctx) => ctx.html(adminPage(ctx.get('user')!)));

admin.get('/api/users', async (ctx) => {
  const { results } = await ctx.env.DB.prepare(
    `SELECT a.accountId AS discord_id, u.name AS username, u.approved AS approved
     FROM "user" u JOIN account a ON a.userId = u.id AND a.providerId = 'discord'
     ORDER BY u.approved ASC, u.createdAt DESC LIMIT 200`,
  ).all<{ discord_id: string; username: string; approved: number }>();

  return ctx.json({ users: results.map((u) => ({ discordId: u.discord_id, username: u.username, approved: u.approved === 1 })) });
})

admin.post('/api/users/:id/approval', async (ctx) => {
  const body = await readJsonObject(ctx);
  if (!body || typeof body.approved !== 'boolean') return ctx.json({ error: 'Body must be {"approved": boolean}' }, 400);

  const res = await ctx.env.DB.prepare(
    `UPDATE "user" SET approved = ?1 WHERE id = (SELECT userId FROM account WHERE accountId = ?2 AND providerId = 'discord')`,
  )
    .bind(body.approved ? 1 : 0, ctx.req.param('id'))
    .run();
  return res.meta.changes ? ctx.json({ ok: true }) : ctx.json({ error: 'User not found' }, 404)
})

admin.patch('/api/tracks/:id', async (ctx) => {
  const body = await readJsonObject(ctx);
  if (!body) return ctx.json({ error: 'Body must be a JSON object' }, 400);

  // Missing fields fall through to validateMeta's "required" errors; present fields must be strings.
  const fields = ['name', 'description', 'creatorName', 'createdDate'] as const;
  const bad = fields.find((key) => body[key] !== undefined && typeof body[key] !== 'string');
  if (bad) return ctx.json({ error: `${bad} must be a string` }, 400);
  const trimString = (key: (typeof fields)[number]) => ((body[key] as string | undefined) ?? '').trim();

  const meta: Meta = {
    name: trimString('name'),
    description: trimString('description'),
    creatorName: trimString('creatorName'),
    createdDate: trimString('createdDate')
  };

  const problem = validateMeta(meta);
  if (problem) return ctx.json({ error: problem }, 400);

  const res = await ctx.env.DB.prepare('UPDATE tracks SET name = ?, description = ?, creator_name = ?, created_date = ? WHERE id = ?')
    .bind(meta.name, meta.description, meta.creatorName, meta.createdDate, ctx.req.param('id'))
    .run();

  return res.meta.changes ? ctx.json({ ok: true }) : ctx.json({ error: 'Track not found' }, 404);
})

admin.delete('/api/tracks/:id', async (ctx) => {
  const id = ctx.req.param('id');
  const row = await ctx.env.DB.prepare('SELECT lev_key, vrm_key, sca_key, preview_key FROM tracks WHERE id = ?')
    .bind(id)
    .first<Pick<TrackRow, 'lev_key' | 'vrm_key' | 'sca_key' | 'preview_key'>>();
  if (!row) return ctx.json({ error: 'Track not found' }, 404);
  const keys = [row.lev_key, row.vrm_key, row.sca_key, row.preview_key].filter((key): key is string => !!key);

  // Kill the row first. If it fails, this just leaves orphaned files rather than a track with dead URLs.
  await ctx.env.DB.prepare('DELETE FROM tracks WHERE id = ?').bind(id).run();
  try {
    await ctx.env.FILES.delete(keys);
  } catch (err) {
    console.error('Orphaned R2 objects after deleting track', id, keys, err);
  }
  return ctx.json({ ok: true });
})

admin.put('/api/tracks/:id/preview', async (ctx) => {
  if (Number(ctx.req.header('content-length') ?? 0) > PREVIEW_RULES.maxBytes + 64 * 1024) return ctx.json({ error: 'Upload is too large' }, 413);

  const id = ctx.req.param('id');
  const row = await ctx.env.DB.prepare('SELECT preview_key FROM tracks WHERE id = ?')
    .bind(id)
    .first<Pick<TrackRow, 'preview_key'>>();
  if (!row) return ctx.json({ error: 'Track not found' }, 404);

  const form = await ctx.req.formData().catch(() => null);
  if (!form) return ctx.json({ error: 'Body must be multipart form data' }, 400);
  const value = form.get('preview');
  if (!(value instanceof File) || value.size === 0) return ctx.json({ error: 'A preview image is required' }, 400);
  const preview = await readPreview(value);
  if (typeof preview === 'string') return ctx.json({ error: preview }, 400);

  // An identical re-upload reuses the key the row already points at.
  const key = previewKey(id, preview);
  const discardNew = () => key === row.preview_key ? Promise.resolve() : ctx.env.FILES.delete(key).catch(() => {});
  let changes: number;
  try {
    await putPreview(ctx.env, key, preview);
    const res = await ctx.env.DB.prepare(
      `UPDATE tracks SET preview_key = ?, preview_type = ?, preview_size = ?, preview_width = ?, preview_height = ?, preview_sha256 = ?
       WHERE id = ?`,
    )
      .bind(key, preview.type, preview.buf.byteLength, preview.width, preview.height, preview.sha256, id)
      .run();
    changes = res.meta.changes;
  } catch (err) {
    console.error('Preview upload failed', id, err);
    await discardNew();
    return ctx.json({ error: 'Upload failed, please try again' }, 500);
  }
  if (!changes) {
    await discardNew();
    return ctx.json({ error: 'Track not found' }, 404);
  }

  if (row.preview_key && row.preview_key !== key) {
    await ctx.env.FILES.delete(row.preview_key).catch((err) => console.error('Orphaned R2 object after replacing preview', id, row.preview_key, err));
  }
  return ctx.json({ ok: true });
})

admin.delete('/api/tracks/:id/preview', async (ctx) => {
  const id = ctx.req.param('id');
  const row = await ctx.env.DB.prepare('SELECT preview_key FROM tracks WHERE id = ?')
    .bind(id)
    .first<Pick<TrackRow, 'preview_key'>>();
  if (!row) return ctx.json({ error: 'Track not found' }, 404);
  if (!row.preview_key) return ctx.json({ ok: true });

  await ctx.env.DB.prepare(
    `UPDATE tracks SET preview_key = NULL, preview_type = NULL, preview_size = NULL, preview_width = NULL, preview_height = NULL, preview_sha256 = NULL
     WHERE id = ? AND preview_key = ?`,
  )
    .bind(id, row.preview_key)
    .run();
  try {
    await ctx.env.FILES.delete(row.preview_key);
  } catch (err) {
    console.error('Orphaned R2 object after removing preview', id, row.preview_key, err);
  }
  return ctx.json({ ok: true });
})

app.route('/admin', admin)

export default app