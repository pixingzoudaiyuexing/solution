import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import { strictCors } from '../src/security/cors';

const env = {
  FRONTEND_ORIGINS: 'https://app.example,https://admin.example',
};

describe('gateway HTTP policy', () => {
  it('allows only an exact configured frontend origin', async () => {
    const allowed = await app.request(
      '/api/v1/not-implemented',
      { headers: { Origin: 'https://app.example' } },
      env
    );
    const denied = await app.request(
      '/api/v1/not-implemented',
      { headers: { Origin: 'https://attacker.example' } },
      env
    );

    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example');
    expect(allowed.headers.get('vary')).toContain('Origin');
    expect(denied.headers.has('access-control-allow-origin')).toBe(false);
  });

  it('fails closed when a wildcard is configured', async () => {
    const response = await app.request(
      '/api/v1/not-implemented',
      { headers: { Origin: 'https://attacker.example' } },
      { FRONTEND_ORIGINS: '*' }
    );

    expect(response.headers.has('access-control-allow-origin')).toBe(false);
  });

  it('removes CORS headers supplied by downstream responses', async () => {
    const downstream = new Hono<{ Bindings: typeof env }>();
    downstream.use('*', strictCors);
    downstream.get('/', (c) => {
      return c.text('ok', 200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-Internal-Header',
      });
    });

    const response = await downstream.request(
      '/',
      { headers: { Origin: 'https://attacker.example' } },
      env
    );

    expect(response.headers.has('access-control-allow-origin')).toBe(false);
    expect(response.headers.has('access-control-expose-headers')).toBe(false);
  });

  it('does not expose out-of-scope routes', async () => {
    const register = await app.request('/api/v1/auth/register', { method: 'POST' }, env);
    const purchases = await app.request('/api/v1/purchases', undefined, env);

    expect(register.status).toBe(404);
    expect(purchases.status).toBe(404);
  });
});
