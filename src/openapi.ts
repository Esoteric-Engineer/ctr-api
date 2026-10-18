// OpenAPI 3.0 description of the public (unauthenticated) API. Keep in sync with the routes in index.ts.

const track = {
  type: 'object',
  required: ['id', 'name', 'description', 'creatorName', 'uploadedBy', 'uploadedDate', 'createdDate', 'files'],
  properties: {
    id: { type: 'string', description: 'Unique track id.' },
    name: { type: 'string', maxLength: 100 },
    description: { type: 'string', maxLength: 2000 },
    creatorName: { type: 'string', maxLength: 100, description: 'Name of the track\'s creator.' },
    uploadedBy: { type: 'string', description: 'Username of the account that uploaded the track.' },
    uploadedDate: { type: 'string', description: 'When the track was uploaded to this API.' },
    createdDate: { type: 'string', format: 'date', description: 'Date the track was created (YYYY-MM-DD).' },
    files: {
      type: 'object',
      required: ['lev', 'vrm', 'sca'],
      properties: {
        lev: { type: 'string', format: 'uri', description: 'URL of the .lev file.' },
        vrm: { type: 'string', format: 'uri', description: 'URL of the .vrm file.' },
        sca: { type: 'string', format: 'uri', description: 'URL of the .sca file.' },
      },
    },
  },
}

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Custom Team Racing API',
    version: '1.0.0',
    description: 'Public, read-only API for Crash Team Racing custom tracks. CORS is enabled for all origins.',
  },
  servers: [{ url: '/' }],
  paths: {
    '/tracks': {
      get: {
        summary: 'List tracks',
        description: 'Returns tracks ordered by upload date, newest first.',
        operationId: 'listTracks',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            description: 'Maximum number of tracks to return. Out-of-range values are clamped to 1–100.',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
          {
            name: 'offset',
            in: 'query',
            description: 'Number of tracks to skip. Negative values are treated as 0.',
            schema: { type: 'integer', minimum: 0, default: 0 },
          },
        ],
        responses: {
          '200': {
            description: 'A page of tracks.',
            headers: { 'Cache-Control': { schema: { type: 'string', example: 'public, max-age=60' } } },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['tracks', 'limit', 'offset'],
                  properties: {
                    tracks: { type: 'array', items: { $ref: '#/components/schemas/Track' } },
                    limit: { type: 'integer', description: 'The limit that was applied.' },
                    offset: { type: 'integer', description: 'The offset that was applied.' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/tracks/{id}': {
      get: {
        summary: 'Get a track',
        operationId: 'getTrack',
        parameters: [{ name: 'id', in: 'path', required: true, description: 'Track id.', schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'The track.',
            headers: { 'Cache-Control': { schema: { type: 'string', example: 'public, max-age=60' } } },
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Track' } } },
          },
          '404': {
            description: 'No track with that id.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Track: track,
      Error: {
        type: 'object',
        required: ['error'],
        properties: { error: { type: 'string', example: 'Not found' } },
      },
    },
  },
}
