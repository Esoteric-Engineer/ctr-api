export type FileKind = 'lev' | 'vrm' | 'sca'

export const FILE_RULES: Record<FileKind, { maxBytes: number; required: boolean }> = {
  lev: { maxBytes: 2 * 1024 * 1024, required: true },
  vrm: { maxBytes: 1.25 * 1024 * 1024, required: false },
  sca: { maxBytes: 512 * 1024, required: false },
}

export const checkFile = (kind: FileKind, file: File): string | null => {
  if (!file.name.toLowerCase().endsWith(`.${kind}`)) return `The ${kind} file must have a .${kind} extension`;
  if (file.size === 0) return `The .${kind} file is empty`;
  if (file.size > FILE_RULES[kind].maxBytes) return `The .${kind} file is too large (max ${FILE_RULES[kind].maxBytes / 1024} KB)`;
  return null;
}

export const sha256Hex = async (buf: ArrayBuffer): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf)), (b) => b.toString(16).padStart(2, '0')).join('');

export const PREVIEW_RULES = { maxBytes: 1024 * 1024, minWidth: 160, minHeight: 90, maxWidth: 1920, maxHeight: 1080 }

export type PreviewInfo = { type: 'image/png' | 'image/jpeg'; ext: 'png' | 'jpg'; width: number; height: number }
export type Preview = PreviewInfo & { buf: ArrayBuffer; sha256: string }

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IEND = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

const pngSize = (view: DataView): [number, number] | string => {
  if (view.byteLength < 24 + PNG_IEND.length) return 'Invalid PNG: file is truncated';
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) return 'Invalid PNG: missing IHDR chunk';
  const tail = new Uint8Array(view.buffer, view.byteLength - PNG_IEND.length);
  if (!PNG_IEND.every((b, i) => tail[i] === b)) return 'Invalid PNG: file is truncated (missing IEND chunk)';
  return [view.getUint32(16), view.getUint32(20)];
}

const jpegSize = (view: DataView): [number, number] | string => {
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return 'Invalid JPEG: bad marker';
    const marker = view.getUint8(offset + 1);
    if (marker === 0xff) { offset += 1; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { offset += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return 'Invalid JPEG: no frame header before image data';
    const length = view.getUint16(offset + 2);
    if (length < 2) return 'Invalid JPEG: bad segment length';
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (marker > 0xc2) return 'Unsupported JPEG encoding (use baseline or progressive)';
      if (length < 7 || offset + 9 > view.byteLength) return 'Invalid JPEG: truncated frame header';
      return [view.getUint16(offset + 7), view.getUint16(offset + 5)];
    }
    offset += 2 + length;
  }
  return 'Invalid JPEG: file is truncated';
}

export const checkPreview = (buf: ArrayBuffer): PreviewInfo | string => {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let format: Pick<PreviewInfo, 'type' | 'ext'>;
  let size: [number, number] | string;
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    format = { type: 'image/png', ext: 'png' };
    size = pngSize(view);
  } else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    format = { type: 'image/jpeg', ext: 'jpg' };
    size = jpegSize(view);
  } else {
    return 'The preview image must be a PNG or JPEG';
  }
  if (typeof size === 'string') return size;

  const [width, height] = size;
  const { minWidth, minHeight, maxWidth, maxHeight } = PREVIEW_RULES;
  if (width < minWidth || height < minHeight) return `The preview image is too small (${width}x${height}, min ${minWidth}x${minHeight})`;
  if (width > maxWidth || height > maxHeight) return `The preview image is too large (${width}x${height}, max ${maxWidth}x${maxHeight})`;
  return { ...format, width, height };
}

export const readPreview = async (file: File): Promise<Preview | string> => {
  if (file.size > PREVIEW_RULES.maxBytes) return `The preview image is too large (max ${PREVIEW_RULES.maxBytes / 1024} KB). Try a JPEG or a lower resolution.`;
  const buf = await file.arrayBuffer();
  const info = checkPreview(buf);
  if (typeof info === 'string') return info;
  return { ...info, buf, sha256: await sha256Hex(buf) };
}

const SCA_CHUNK_CAPS: Record<string, number> = { BANK: 0x64000, CSEQ: 0xc000, SIZE: 512, META: 4096 }

export const checkSca = (buf: ArrayBuffer): string | null => {
  const view = new DataView(buf);
  const ascii = (offset: number, length: number) => String.fromCharCode(...new Uint8Array(buf, offset, length));

  if (buf.byteLength < 4 || ascii(0, 3) !== 'SCA') return 'Not a valid .sca file (missing SCA header)';
  if (view.getUint8(3) !== 1) return `Unsupported .sca version ${view.getUint8(3)}`;

  const chunks = new Map<string, { offset: number; size: number }>();
  let offset = 4;
  while (offset < buf.byteLength) {
    if (offset + 8 > buf.byteLength) return 'Invalid .sca file: truncated chunk header';
    const tag = ascii(offset, 4);
    const size = view.getUint32(offset + 4, true);
    const known = Object.hasOwn(SCA_CHUNK_CAPS, tag);
    if (known && chunks.has(tag)) return `Invalid .sca file: duplicate ${tag} chunk`;
    if (known && size > SCA_CHUNK_CAPS[tag]) return `Invalid .sca file: ${tag} chunk is too large`;
    if (offset + 8 + size > buf.byteLength) return `Invalid .sca file: ${tag} chunk runs past end of file`;
    if (known) chunks.set(tag, { offset: offset + 8, size });
    offset += 8 + size + (-size & 3);
  }

  for (const tag of Object.keys(SCA_CHUNK_CAPS)) {
    if (!chunks.has(tag)) return `Invalid .sca file: missing ${tag} chunk`;
  }

  const bank = chunks.get('BANK')!;
  const sizes = chunks.get('SIZE')!;
  const meta = chunks.get('META')!;

  if (bank.size < 0x800) return 'Invalid .sca file: BANK chunk is too small';
  if (sizes.size % 2 !== 0) return 'Invalid .sca file: SIZE chunk has an odd length';
  const numSamples = view.getInt16(bank.offset, true);
  if (numSamples < 1 || numSamples > 256) return 'Invalid .sca file: bad sample count in BANK';
  if (numSamples !== sizes.size / 2) return 'Invalid .sca file: SIZE entries do not match BANK sample count';

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(new Uint8Array(buf, meta.offset, meta.size)));
  } catch {
    return 'Invalid .sca file: META is not valid UTF-8 JSON';
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'Invalid .sca file: META must be a JSON object';
  const { name, author } = parsed as Record<string, unknown>;
  if (typeof name !== 'string' || typeof author !== 'string') return 'Invalid .sca file: META needs string "name" and "author"';

  return null;
}
