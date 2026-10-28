import {
  HttpStatus,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import {
  RAW_RESPONSE_KEY,
  RESPONSE_MESSAGE_KEY,
  RESPONSE_STATUS_KEY,
} from './api-endpoint.decorator.js';
import { toPage } from './pagination.js';
import { ResponseInterceptor } from './response.interceptor.js';

const run = (value: unknown, meta: Record<string, unknown>, method = 'GET') => {
  const handler = () => undefined;
  class Ctl {}
  const reflector = {
    get: (k: string) => meta[k],
    getAllAndOverride: (k: string) => meta[k],
  } as unknown as Reflector;
  const ctx = {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => Ctl,
    switchToHttp: () => ({ getRequest: () => ({ method }) }),
  } as unknown as ExecutionContext;
  const next: CallHandler = { handle: () => of(value) };
  return firstValueFrom(
    new ResponseInterceptor(reflector).intercept(ctx, next),
  );
};

describe('ResponseInterceptor', () => {
  it('wraps plain data with status and message', async () => {
    const out = await run(
      { id: 1 },
      { [RESPONSE_MESSAGE_KEY]: 'ok', [RESPONSE_STATUS_KEY]: 200 },
    );
    expect(out).toEqual({ statusCode: 200, message: 'ok', data: { id: 1 } });
  });

  it('wraps pages as data.results + data.paginationMeta', async () => {
    const page = toPage(['a', 'b'], 5, { page: 2, limit: 2 });
    const out = await run(page, { [RESPONSE_MESSAGE_KEY]: 'list' });
    expect(out).toEqual({
      statusCode: 200,
      message: 'list',
      data: {
        results: ['a', 'b'],
        paginationMeta: {
          pageCount: 2,
          totalPages: 3,
          totalCount: 5,
          previousPage: true,
          nextPage: true,
        },
      },
    });
  });

  it('defaults POST to 201 and null data to null', async () => {
    const out = await run(undefined, {}, 'POST');
    expect(out).toEqual({ statusCode: 201, message: 'Success', data: null });
  });

  it('leaves 204 bodies and raw routes untouched', async () => {
    expect(
      await run(undefined, { [RESPONSE_STATUS_KEY]: HttpStatus.NO_CONTENT }),
    ).toBeUndefined();
    expect(await run({ status: 'ok' }, { [RAW_RESPONSE_KEY]: true })).toEqual({
      status: 'ok',
    });
  });
});
