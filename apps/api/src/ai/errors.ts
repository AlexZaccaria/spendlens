/** Failure codes surfaced to the browser (ImportError.code / API error code). The UI maps each
 *  code to a translated message and falls back to `message` for anything it does not know. */
export type AiErrorCode =
  | 'ai_not_configured'
  | 'provider_error'
  | 'refusal'
  | 'output_truncated'
  | 'invalid_output'
  | 'unsupported_format'
  | 'unsupported_image'
  | 'file_too_large'
  | 'pdf_no_text'
  | 'already_imported';

export class AiError extends Error {
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

export function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new AiError('provider_error', message, { cause: err });
}
