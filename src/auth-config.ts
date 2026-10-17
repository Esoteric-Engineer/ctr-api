import { betterAuth } from 'better-auth'
import type { BetterAuthOptions } from 'better-auth'
import type { Bindings } from './types'

export const authOptions = (env: Bindings) =>
  ({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    socialProviders: {
      discord: {
        clientId: env.DISCORD_CLIENT_ID,
        clientSecret: env.DISCORD_CLIENT_SECRET,
        disableDefaultScope: true, // since the user's email isn't needed
        scope: ['identify'],
        overrideUserInfoOnSignIn: true,
        mapProfileToUser: (profile) => ({
          name: profile.global_name || profile.username,
          // Better Auth requires an email; this is a placeholder, not a real address.
          email: `${profile.id}@discord.invalid`,
          emailVerified: false,
        }),
      },
    },
    user: {
      additionalFields: {
        // disallow clients from setting this themselves via `input: false`
        approved: { type: 'boolean', defaultValue: false, input: false },
      },
    },
  }) satisfies BetterAuthOptions

const cache = new WeakMap<Bindings, ReturnType<typeof build>>()

const build = (env: Bindings) => betterAuth({ ...authOptions(env), database: env.DB })

export const getAuth = (env: Bindings) => {
  let auth = cache.get(env)
  if (!auth) cache.set(env, (auth = build(env)))
  return auth
}

export type Auth = ReturnType<typeof getAuth>