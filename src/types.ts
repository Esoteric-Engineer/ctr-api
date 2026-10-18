export type Bindings = {
  DB: D1Database
  FILES: R2Bucket
  DISCORD_CLIENT_ID: string
  DISCORD_CLIENT_SECRET: string
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  ADMIN_DISCORD_IDS: string
  CDN_BASE: string
  LOCAL_FILES?: string
}

export type SessionUser = {
  id: string
  discordId: string
  username: string
  avatarUrl: string | null
  approved: boolean
  isAdmin: boolean
}

export type AppEnv = {
  Bindings: Bindings
  Variables: { user: SessionUser | null }
}

export type Meta = {
  name: string
  description: string
  creatorName: string
  createdDate: string
}

export type TrackRow = {
  id: string
  name: string
  description: string
  creator_name: string
  uploaded_by_name: string
  created_date: string
  uploaded_at: string
  lev_key: string
  lev_size: number
  lev_sha256: string
  vrm_key: string | null
  vrm_size: number | null
  vrm_sha256: string | null
  sca_key: string | null
  sca_size: number | null
  sca_sha256: string | null
  preview_key: string | null
  preview_type: string | null
  preview_size: number | null
  preview_width: number | null
  preview_height: number | null
  preview_sha256: string | null
}