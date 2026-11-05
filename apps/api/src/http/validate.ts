import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import { z } from 'zod';

/** zValidator with the API's error shape: `{ error: { code, message } }` and a 400. */
export const validate = <T extends z.ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: { code: 'invalid_request', message: z.prettifyError(result.error) } }, 400);
    }
    return undefined;
  });

export class HttpError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 502 | 503;
  readonly code: string;

  constructor(status: HttpError['status'], code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
