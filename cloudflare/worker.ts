import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

const app = new Hono();

app.use('*', logger());
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));

app.get('/', (c) => {
  return c.json({
    name: 'EnvCP Cloud',
    version: '1.0.0',
    description: 'Secure Environment Variable Management for AI-Assisted Coding',
    endpoints: {
      health: '/api/health',
      docs: '/api/docs',
    },
    github: 'https://github.com/fentz26/EnvCP',
  });
});

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/docs', (c) => {
  return c.json({
    name: 'EnvCP Cloud API',
    version: '1.0.0',
    description: 'Cloud-hosted EnvCP service for secure environment variable management',
    authentication: {
      type: 'API Key',
      header: 'X-API-Key or Authorization: Bearer <token>',
    },
    endpoints: {
      'GET /': 'API info',
      'GET /api/health': 'Health check',
      'GET /api/docs': 'API documentation',
    },
    note: 'Full EnvCP functionality requires local installation. This cloud instance provides API documentation and service status.',
  });
});

app.notFound((c) => {
  return c.json({ error: 'Not Found', path: c.req.path }, 404);
});

export default app;
