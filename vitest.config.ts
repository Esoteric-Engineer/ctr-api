import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, 'migrations')),
          DISCORD_CLIENT_ID: 'test-client-id',
          DISCORD_CLIENT_SECRET: 'test-client-secret',
          BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
          BETTER_AUTH_URL: 'http://localhost',
          ADMIN_DISCORD_IDS: '900000000000000001, 900000000000000002',
          CDN_BASE: 'https://cdn.example.test',
          LOCAL_FILES: 'false',
        },
      },
    })),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
  },
})