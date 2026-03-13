import { buildApp } from './app.js'
import { createPool } from './db.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Missing DATABASE_URL environment variable')
  process.exit(1)
}

const db = createPool(connectionString)
const app = buildApp(db)

try {
  await app.listen({ port: 3000, host: '0.0.0.0' })
  console.log('Sanson listening on http://0.0.0.0:3000')
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
