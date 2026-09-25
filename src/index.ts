import { Hono } from 'hono';
import { v1Router } from './routes/v1';
import { errorHandler } from './http/error-handler';
import { strictCors } from './security/cors';
import type { Env } from './config/env';
import { refreshRegistryOperationalState } from './registry/refresh';
import { subscriptionPublicRouter } from './routes/subscription-public';
import { refreshDownloadCenterResolvedState } from './registry/download-center-refresh';

export const app = new Hono<{ Bindings: Env }>();

app.use('*', strictCors);

app.onError(errorHandler);

app.route('/api/v1', v1Router);
app.route('/', subscriptionPublicRouter);

export function scheduled(
  _controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext
): void {
  ctx.waitUntil(
    (async () => {
      await refreshRegistryOperationalState(env);
      await refreshDownloadCenterResolvedState(env);
    })()
  );
}

const worker: ExportedHandler<Env> = {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  scheduled,
};

export default worker;
