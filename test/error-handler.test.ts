import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../src/http/error-handler';

describe('Error Handler', () => {
  it('normalizes unknown errors without exposing internal details', async () => {
    const app = new Hono();
    app.onError(errorHandler);
    app.get('/error', () => {
      throw new Error('Test error');
    });

    const res = await app.request('/error', {
      headers: { 'cf-ray': 'test-ray-id' }
    });

    expect(res.status).toBe(502);
    const body = await res.json() as any;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('UPSTREAM_ERROR');
    expect(body.error.message).toBe('The upstream service could not complete the request');
    expect(JSON.stringify(body)).not.toContain('Test error');
    expect(body.error.requestId).toBe('test-ray-id');
  });
});
