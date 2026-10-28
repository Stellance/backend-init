import type { ExecutionContext } from '@nestjs/common';

export interface FakeHttp {
  req: Record<string, unknown>;
  res: { setHeader: (name: string, value: unknown) => void };
  headers: Record<string, unknown>;
}

/** Minimal HTTP ExecutionContext; `handler` and `cls` carry decorator metadata. */
export function fakeContext(
  req: Record<string, unknown> = {},
  handler: () => unknown = function handle() {},
  cls: new () => object = class Controller {},
): { ctx: ExecutionContext; http: FakeHttp } {
  const headers: Record<string, unknown> = {};
  const http: FakeHttp = {
    req,
    res: { setHeader: (name, value) => void (headers[name] = value) },
    headers,
  };
  const ctx = {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({
      getRequest: () => http.req,
      getResponse: () => http.res,
    }),
  } as unknown as ExecutionContext;
  return { ctx, http };
}

export const configStub = (values: Record<string, unknown>) =>
  ({ get: (key: string) => values[key] }) as never;
