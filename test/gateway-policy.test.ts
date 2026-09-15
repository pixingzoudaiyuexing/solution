import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import { strictCors } from '../src/security/cors';

const env = {
  FRONTEND_ORIGINS: 'https://app.example,https://admin.example',
};
const additiveEnv = {
  FRONTEND_ORIGINS: 'https://app.example,https://same.example',
  FRONTEND_ORIGINS_EXTRA: 'https://same.example,https://aureole.example',
};

describe('gateway HTTP policy', () => {
  it('allows PATCH preflight from an exact configured origin', async () => {
    const response = await app.request(
      '/api/v1/me/preferences',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example',
          'Access-Control-Request-Method': 'PATCH',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
      },
      env
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://app.example'
    );
    expect(response.headers.get('access-control-allow-methods')).toContain(
      'PATCH'
    );
    expect(response.headers.get('access-control-allow-headers')).toContain(
      'Content-Type'
    );
    expect(response.headers.get('access-control-allow-headers')).toContain(
      'Authorization'
    );
    expect(response.headers.get('access-control-allow-credentials')).toBe(
      'true'
    );
    expect(response.headers.get('vary')).toContain('Origin');
  });

  it('does not allow PATCH preflight from an unconfigured origin', async () => {
    const response = await app.request(
      '/api/v1/me/preferences',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://attacker.example',
          'Access-Control-Request-Method': 'PATCH',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
      },
      env
    );

    expect(response.status).toBe(204);
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
    expect(response.headers.has('access-control-allow-methods')).toBe(false);
    expect(response.headers.has('access-control-allow-headers')).toBe(false);
    expect(response.headers.has('access-control-allow-credentials')).toBe(false);
  });

  it.each(['GET', 'POST'])('keeps %s preflight allowed', async (method) => {
    const response = await app.request(
      '/api/v1/not-implemented',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example',
          'Access-Control-Request-Method': method,
        },
      },
      env
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toContain(method);
  });

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

  it.each(['https://app.example', 'https://aureole.example'])(
    'allows an exact origin from the base or additive source: %s',
    async (origin) => {
      const response = await app.request(
        '/api/v1/config/onboarding',
        { headers: { Origin: origin } },
        additiveEnv
      );

      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
      expect(response.headers.get('access-control-allow-credentials')).toBe(
        'true'
      );
      expect(response.headers.get('vary')).toBe('Origin');
    }
  );

  it('deduplicates origins across both configuration sources', async () => {
    const response = await app.request(
      '/api/v1/config/onboarding',
      { headers: { Origin: 'https://same.example' } },
      additiveEnv
    );

    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://same.example'
    );
    expect(response.headers.get('access-control-allow-origin')).not.toContain(',');
    expect(response.headers.get('vary')).toBe('Origin');
  });

  it.each(['*', 'not-a-url', 'javascript:alert(1)'])(
    'ignores an invalid additive source without disabling a valid base origin: %s',
    async (extra) => {
      const allowed = await app.request(
        '/api/v1/config/onboarding',
        { headers: { Origin: 'https://app.example' } },
        { FRONTEND_ORIGINS: 'https://app.example', FRONTEND_ORIGINS_EXTRA: extra }
      );
      const denied = await app.request(
        '/api/v1/config/onboarding',
        { headers: { Origin: 'https://attacker.example' } },
        { FRONTEND_ORIGINS: 'https://app.example', FRONTEND_ORIGINS_EXTRA: extra }
      );

      expect(allowed.headers.get('access-control-allow-origin')).toBe(
        'https://app.example'
      );
      expect(denied.headers.has('access-control-allow-origin')).toBe(false);
    }
  );

  it.each([
    'https://aureole-cc-staging-3dc609.pages.dev.evil.example',
    'https://evil-aureole-cc-staging-3dc609.pages.dev',
    'http://aureole-cc-staging-3dc609.pages.dev',
    'https://evil.example',
  ])('rejects a non-exact Aureole origin: %s', async (origin) => {
    const response = await app.request(
      '/api/v1/config/onboarding',
      { headers: { Origin: origin } },
      {
        FRONTEND_ORIGINS_EXTRA:
          'https://aureole-cc-staging-3dc609.pages.dev',
      }
    );

    expect(response.headers.has('access-control-allow-origin')).toBe(false);
    expect(response.headers.has('access-control-allow-credentials')).toBe(false);
    expect(response.headers.get('vary')).toBe('Origin');
  });

  it.each([
    ['GET', '/api/v1/config/onboarding', undefined],
    ['POST', '/api/v1/auth/login', 'content-type'],
    ['PATCH', '/api/v1/me/preferences', 'authorization,content-type'],
  ])(
    'preserves %s preflight policy for the additive origin',
    async (method, path, requestHeaders) => {
      const headers = new Headers({
        Origin: 'https://aureole.example',
        'Access-Control-Request-Method': method,
      });
      if (requestHeaders) {
        headers.set('Access-Control-Request-Headers', requestHeaders);
      }
      const response = await app.request(
        path,
        { method: 'OPTIONS', headers },
        additiveEnv
      );

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(
        'https://aureole.example'
      );
      expect(response.headers.get('access-control-allow-credentials')).toBe(
        'true'
      );
      expect(response.headers.get('access-control-allow-methods')).toContain(
        method
      );
      expect(response.headers.get('access-control-allow-headers')).toContain(
        'Content-Type'
      );
      expect(response.headers.get('access-control-allow-headers')).toContain(
        'Authorization'
      );
      expect(response.headers.get('vary')).toBe('Origin');
    }
  );

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

  it('strips downstream CORS headers before applying the additive allowlist', async () => {
    const downstream = new Hono<{ Bindings: typeof additiveEnv }>();
    downstream.use('*', strictCors);
    downstream.get('/', (c) =>
      c.text('ok', 200, {
        'Access-Control-Allow-Origin': 'https://attacker.example',
        'Access-Control-Allow-Credentials': 'false',
        'Access-Control-Expose-Headers': 'X-Internal-Header',
      })
    );

    const response = await downstream.request(
      '/',
      { headers: { Origin: 'https://aureole.example' } },
      additiveEnv
    );

    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://aureole.example'
    );
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(response.headers.has('access-control-expose-headers')).toBe(false);
  });

  it('does not expose out-of-scope routes', async () => {
    const quickLogin = await app.request(
      '/api/v1/auth/quick-login',
      { method: 'POST' },
      env
    );
    const purchases = await app.request('/api/v1/purchases', undefined, env);

    expect(quickLogin.status).toBe(404);
    expect(purchases.status).toBe(404);
  });
});
