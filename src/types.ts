export type Bindings = {
  DB: D1Database
  FILES: R2Bucket
  DISCORD_CLIENT_ID: string
  DISCORD_CLIENT_SECRET: string
  SESSION_SECRET: string
  ADMIN_DISCORD_IDS: string
  CDN_BASE: string
}

export type SessionUser = { 
  id: string
  username: string
  approved: boolean
  isAdmin: boolean
}

export type AppEnv = {
  Bindings: Bindings
  Variables: { user: SessionUser | null }
}