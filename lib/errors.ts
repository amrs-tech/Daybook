export class DomainError extends Error {
  constructor(
    public code: string,
    public status = 422,
    message?: string,
  ) {
    super(message ?? code);
  }
}
export function requireThat(
  condition: unknown,
  code: string,
  status = 422,
): asserts condition {
  if (!condition) throw new DomainError(code, status);
}
