import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';
import {
  RAW_RESPONSE_KEY,
  RESPONSE_MESSAGE_KEY,
  RESPONSE_STATUS_KEY,
} from './api-endpoint.decorator.js';

export interface ResponseEnvelope<T> {
  statusCode: number;
  message: string;
  data: T | null;
}

/** Wraps every handler result as `{ statusCode, message, data }`. */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const handler = context.getHandler();
    const raw = this.reflector.getAllAndOverride<boolean | undefined>(
      RAW_RESPONSE_KEY,
      [handler, context.getClass()],
    );
    if (raw) return next.handle();

    // Nest applies @HttpCode after interceptors run, so res.statusCode is not final yet.
    const statusCode =
      this.reflector.get<number | undefined>(RESPONSE_STATUS_KEY, handler) ??
      (context.switchToHttp().getRequest<Request>().method === 'POST'
        ? HttpStatus.CREATED
        : HttpStatus.OK);
    const message =
      this.reflector.get<string | undefined>(RESPONSE_MESSAGE_KEY, handler) ??
      'Success';

    return next.handle().pipe(
      map((data: unknown): unknown =>
        statusCode === HttpStatus.NO_CONTENT
          ? data
          : ({
              statusCode,
              message,
              data: data ?? null,
            } satisfies ResponseEnvelope<unknown>),
      ),
    );
  }
}
