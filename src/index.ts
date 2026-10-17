import { Hono } from 'hono'
import type { AppEnv } from './types'
import { auth, loadUser } from './auth'

const app = new Hono<AppEnv>()

app.route('/', auth)
app.use('*', loadUser)

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

export default app
