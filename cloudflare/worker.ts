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

const DOCS_URL = 'fentz.mintlify.app';

// Route: /docs/* OR /mintlify-assets/* OR /_mintlify/* - Proxy to Mintlify
app.all('/docs/*', async (c) => {
  const url = new URL(c.req.url);
  url.hostname = DOCS_URL;
  url.protocol = 'https:';
  url.pathname = c.req.path.replace(/^\/docs/, '') || '/';
  
  const proxyRequest = new Request(url, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : null
  });
  
  proxyRequest.headers.set('Host', DOCS_URL);
  proxyRequest.headers.set('X-Forwarded-Host', 'envcp.org');
  proxyRequest.headers.set('X-Forwarded-Proto', 'https');
  
  try {
    return await fetch(proxyRequest);
  } catch (err) {
    return c.json({ error: 'Docs unavailable', message: err.message }, 502);
  }
});

app.all('/mintlify-assets/*', async (c) => {
  const url = new URL(c.req.url);
  url.hostname = DOCS_URL;
  url.protocol = 'https:';
  
  const proxyRequest = new Request(url, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : null
  });
  
  proxyRequest.headers.set('Host', DOCS_URL);
  proxyRequest.headers.set('X-Forwarded-Host', 'envcp.org');
  proxyRequest.headers.set('X-Forwarded-Proto', 'https');
  
  try {
    return await fetch(proxyRequest);
  } catch (err) {
    return c.json({ error: 'Assets unavailable', message: err.message }, 502);
  }
});

app.all('/_mintlify/*', async (c) => {
  const url = new URL(c.req.url);
  url.hostname = DOCS_URL;
  url.protocol = 'https:';
  
  const proxyRequest = new Request(url, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : null
  });
  
  proxyRequest.headers.set('Host', DOCS_URL);
  proxyRequest.headers.set('X-Forwarded-Host', 'envcp.org');
  proxyRequest.headers.set('X-Forwarded-Proto', 'https');
  
  try {
    return await fetch(proxyRequest);
  } catch (err) {
    return c.json({ error: 'Mintlify assets unavailable', message: err.message }, 502);
  }
});

// Route: /install.sh - Proxy to GitHub
app.get('/install.sh', async (c) => {
  const githubUrl = 'https://raw.githubusercontent.com/fentz26/EnvCP/main/scripts/install.sh';
  try {
    const response = await fetch(githubUrl);
    const script = await response.text();
    return c.text(script, 200, {
      'Content-Type': 'text/x-shellscript',
      'Cache-Control': 'public, max-age=300'
    });
  } catch (err) {
    return c.json({ error: 'Failed to fetch install script' }, 502);
  }
});

// Route: /
app.get('/', (c) => {
  return c.redirect('/docs/');
});

// Route: /api/health
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Route: /api/docs
app.get('/api/docs', (c) => {
  return c.json({
    name: 'EnvCP Cloud API',
    version: '1.0.0',
    description: 'Cloud-hosted EnvCP service',
    authentication: { type: 'API Key', header: 'X-API-Key' },
    endpoints: {
      'GET /': 'API info',
      'GET /api/health': 'Health check',
      'GET /api/docs': 'API documentation',
      'GET /install.sh': 'Installation script',
      'GET /docs/*': 'Documentation (proxied from Mintlify)'
    },
    install: 'curl -fsSL https://envcp.org/install.sh | bash'
  });
});

app.notFound((c) => {
  return c.json({ error: 'Not Found', path: c.req.path }, 404);
});

export default app;
