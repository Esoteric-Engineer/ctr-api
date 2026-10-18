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
        vrm: { type: 'string', format: 'uri', nullable: true, description: 'URL of the .vrm file, or null if not provided.' },
        sca: { type: 'string', format: 'uri', nullable: true, description: 'URL of the .sca file, or null if not provided.' },
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
  servers: [{ url: '/v1' }],
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
    '/tracks/search': {
      get: {
        summary: 'Search tracks',
        description:
          'Returns tracks whose name and/or creator name contain the given text, ordered by upload date, newest first. ' +
          'Matching is case-insensitive for ASCII letters. At least one of `name` or `creator` is required; if both are given, a track must match both.',
        operationId: 'searchTracks',
        parameters: [
          {
            name: 'name',
            in: 'query',
            description: 'Text to look for in the track name.',
            schema: { type: 'string', maxLength: 100 },
          },
          {
            name: 'creator',
            in: 'query',
            description: 'Text to look for in the creator name.',
            schema: { type: 'string', maxLength: 100 },
          },
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
            description: 'A page of matching tracks (possibly empty).',
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
          '400': {
            description: 'Neither `name` nor `creator` was provided, or a search term is longer than 100 characters.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
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
