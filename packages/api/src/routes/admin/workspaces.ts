import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'

interface WorkspacesRouteOptions {
  db: Pool
}

interface WorkspaceRow {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

interface CreateWorkspaceBody {
  name: string
  description?: string
}

interface UpdateWorkspaceBody {
  name?: string
  description?: string
}

const workspaceSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    created_at: { type: 'string' },
    updated_at: { type: 'string' },
  },
} as const

export async function adminWorkspacesRoutes(
  app: FastifyInstance,
  options: WorkspacesRouteOptions,
): Promise<void> {
  // GET /api/admin/workspaces
  app.get('/api/admin/workspaces', {
    schema: {
      tags: ['Admin'],
      summary: 'List workspaces',
      response: { 200: { type: 'array', items: workspaceSchema } },
    },
    handler: async () => {
      const { rows } = await options.db.query<WorkspaceRow>(
        'SELECT id, name, description, created_at, updated_at FROM sanson_workspaces ORDER BY name',
      )
      return rows
    },
  })

  // GET /api/admin/workspaces/:id
  app.get<{ Params: { id: string } }>('/api/admin/workspaces/:id', {
    schema: {
      tags: ['Admin'],
      summary: 'Workspace details',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: { 200: workspaceSchema },
    },
    handler: async (request, reply) => {
      const { rows } = await options.db.query<WorkspaceRow>(
        'SELECT id, name, description, created_at, updated_at FROM sanson_workspaces WHERE id = $1',
        [request.params.id],
      )
      if (rows.length === 0) {
        reply.status(404)
        return { statusCode: 404, error: 'Not Found', message: 'Workspace not found' }
      }
      return rows[0]
    },
  })

  // POST /api/admin/workspaces
  app.post<{ Body: CreateWorkspaceBody }>('/api/admin/workspaces', {
    schema: {
      tags: ['Admin'],
      summary: 'Create a workspace',
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          description: { type: 'string' },
        },
        required: ['name'],
      },
      response: { 201: workspaceSchema },
    },
    handler: async (request, reply) => {
      const { name, description } = request.body
      try {
        const { rows } = await options.db.query<WorkspaceRow>(
          `INSERT INTO sanson_workspaces (name, description)
           VALUES ($1, $2)
           RETURNING id, name, description, created_at, updated_at`,
          [name, description ?? null],
        )
        reply.status(201)
        return rows[0]
      } catch (err: unknown) {
        if ((err as { code?: string }).code === '23505') {
          reply.status(409)
          return {
            statusCode: 409,
            error: 'Conflict',
            message: `Workspace '${name}' already exists`,
          }
        }
        throw err
      }
    },
  })

  // PUT /api/admin/workspaces/:id
  app.put<{ Params: { id: string }; Body: UpdateWorkspaceBody }>('/api/admin/workspaces/:id', {
    schema: {
      tags: ['Admin'],
      summary: 'Update a workspace',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          description: { type: 'string' },
        },
      },
      response: { 200: workspaceSchema },
    },
    handler: async (request, reply) => {
      const { rows } = await options.db.query<WorkspaceRow>(
        `UPDATE sanson_workspaces
           SET name = COALESCE($2, name),
               description = COALESCE($3, description),
               updated_at = now()
           WHERE id = $1
           RETURNING id, name, description, created_at, updated_at`,
        [request.params.id, request.body.name ?? null, request.body.description ?? null],
      )
      if (rows.length === 0) {
        reply.status(404)
        return { statusCode: 404, error: 'Not Found', message: 'Workspace not found' }
      }
      return rows[0]
    },
  })

  // DELETE /api/admin/workspaces/:id
  app.delete<{ Params: { id: string } }>('/api/admin/workspaces/:id', {
    schema: {
      tags: ['Admin'],
      summary: 'Delete a workspace',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    handler: async (request, reply) => {
      const { rowCount } = await options.db.query('DELETE FROM sanson_workspaces WHERE id = $1', [
        request.params.id,
      ])
      if (rowCount === 0) {
        reply.status(404)
        return { statusCode: 404, error: 'Not Found', message: 'Workspace not found' }
      }
      reply.status(204)
    },
  })
}
