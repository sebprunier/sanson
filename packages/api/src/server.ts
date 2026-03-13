import { Pool } from 'pg'
import { buildApp } from './app'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Missing DATABASE_URL environment variable')
  process.exit(1)
}

const port = parseInt(process.env.PORT ?? '3000', 10)
const db = new Pool({ connectionString })
const app = buildApp(db, { logger: true })

try {
  await app.listen({ port, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
