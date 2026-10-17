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
  vrm_key: string
  sca_key: string
}