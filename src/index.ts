import { Hono } from 'hono';
import { v1Router } from './routes/v1';
import { errorHandler } from './http/error-handler';
import { strictCors } from './security/cors';
import type { Env } from './config/env';

const app = new Hono<{ Bindings: Env }>();

app.use('*', strictCors);

app.onError(errorHandler);

app.route('/api/v1', v1Router);

export default app;
