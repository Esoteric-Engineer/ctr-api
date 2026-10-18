<p align="center">
  <img src="public/logo.png" alt="Custom Team Racing logo" width="200">
</p>

# Custom Team Racing API

A public API for Crash Team Racing custom tracks, built with [Hono](https://hono.dev) on Cloudflare Workers.<br />
Allows CTR Native forks (and other projects) to pull from a central track repository.

Track metadata lives in D1 and track files live in R2. Creators log in with Discord via [Better Auth](https://better-auth.com).

| Route | Who | What |
|---|---|---|
| `/v1/tracks`, `/v1/tracks/search`, `/v1/tracks/:id` | Everyone | Read-only JSON API (CORS enabled) |
| `/docs` | Everyone | Swagger UI for the public API |
| `/submit` | Everyone | How to become a creator |
| `/upload` | Approved creators | Upload a track (`.lev` required, `.vrm` and `.sca` optional) |
| `/admin` | Admins | Approve creators, edit and delete tracks |

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create a Discord application at <https://discord.com/developers/applications>. Under **OAuth2**, add the redirect URI `http://localhost:8787/api/auth/callback/discord`.

3. Create a `.dev.vars` file in the project root:

   ```ini
   DISCORD_CLIENT_ID=...
   DISCORD_CLIENT_SECRET=...
   BETTER_AUTH_SECRET=...           # any long random string, e.g. `openssl rand -base64 32`
   ADMIN_DISCORD_IDS=123456789      # comma-separated Discord user IDs
   BETTER_AUTH_URL=http://localhost:8787
   CDN_BASE=http://localhost:8787/files
   LOCAL_FILES=true                 # serves R2 files from /files/* in local dev only
   ```

4. Create the local database and start the dev server:

   ```sh
   npx wrangler d1 migrations apply ctr-api-db --local
   npm run dev
   ```

   The site runs at <http://localhost:8787>. Local D1 and R2 data are stored in `.wrangler/`.

## Deployment

Initial setup (once):

1. Create the database and bucket, then put the printed `database_id` in `wrangler.jsonc`:

   ```sh
   npx wrangler d1 create ctr-api-db
   npx wrangler r2 bucket create ctr-files
   ```

2. Connect the `ctr-files` bucket to the custom domain `cdn.customteamracing.com` (Cloudflare dashboard -> R2 -> `ctr-files` -> Settings -> Custom Domains). This domain must match `CDN_BASE` in `wrangler.jsonc`.

3. Add `https://api.customteamracing.com/api/auth/callback/discord` as a redirect URI in the Discord application.

4. Set the secrets:

   ```sh
   npx wrangler secret put DISCORD_CLIENT_ID
   npx wrangler secret put DISCORD_CLIENT_SECRET
   npx wrangler secret put BETTER_AUTH_SECRET
   npx wrangler secret put ADMIN_DISCORD_IDS
   ```

Every deploy:

```sh
npx wrangler d1 migrations apply ctr-api-db --remote
npm run deploy
```

Worker is served on `api.customteamracing.com` (set in `wrangler.jsonc`).