import {
  applyDecorators,
  HttpStatus,
  SetMetadata,
  HttpCode,
  type Type,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOperation,
  type ApiResponseSchemaHost,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { PaginationMetaDto } from './pagination.js';
import { ErrorResponseDto, ResponseEnvelopeDto } from './response.dto.js';

type SchemaObject = ApiResponseSchemaHost['schema'];

export const RESPONSE_MESSAGE_KEY = 'responseMessage';
export const RESPONSE_STATUS_KEY = 'responseStatus';
export const RAW_RESPONSE_KEY = 'rawResponse';

const ERROR_DESCRIPTIONS: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Validation failed',
  [HttpStatus.UNAUTHORIZED]: 'Missing, invalid or expired credentials',
  [HttpStatus.FORBIDDEN]: 'Caller lacks permission',
  [HttpStatus.NOT_FOUND]: 'Resource not found',
  [HttpStatus.CONFLICT]: 'Resource already exists',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Rate limit exceeded; see Retry-After',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Unexpected server error',
};

export interface ApiEndpointOptions {
  summary: string;
  description: string;
  /** Human-readable `message` carried in the response body. */
  message: string;
  /** Success status. Default 200. Use 204 for no body. */
  status?: HttpStatus;
  /** DTO of `data`, or of each item in `data.results` when `paginated`. */
  type?: Type;
  paginated?: boolean;
  errors?: readonly HttpStatus[];
}

const dataSchema = (
  type: Type | undefined,
  paginated: boolean,
): SchemaObject => {
  if (!type) return { type: 'object', nullable: true };
  if (!paginated) return { $ref: getSchemaPath(type) };
  return {
    type: 'object',
    required: ['results', 'paginationMeta'],
    properties: {
      results: { type: 'array', items: { $ref: getSchemaPath(type) } },
      paginationMeta: { $ref: getSchemaPath(PaginationMetaDto) },
    },
  };
};

/**
 * One decorator per route: operation docs, success + error schemas, status
 * code and the `message` the response interceptor puts in the envelope.
 */
export function ApiEndpoint(options: ApiEndpointOptions) {
  const {
    summary,
    description,
    message,
    status = HttpStatus.OK,
    type,
    paginated = false,
    errors = [],
  } = options;

  const success =
    status === HttpStatus.NO_CONTENT
      ? ApiResponse({ status, description: message })
      : ApiResponse({
          status,
          description: message,
          schema: {
            allOf: [
              { $ref: getSchemaPath(ResponseEnvelopeDto) },
              {
                type: 'object',
                required: ['data'],
                properties: { data: dataSchema(type, paginated) },
              },
            ],
          },
        });

  return applyDecorators(
    ApiOperation({ summary, description }),
    ApiExtraModels(
      ResponseEnvelopeDto,
      ErrorResponseDto,
      PaginationMetaDto,
      ...(type ? [type] : []),
    ),
    HttpCode(status),
    SetMetadata(RESPONSE_MESSAGE_KEY, message),
    SetMetadata(RESPONSE_STATUS_KEY, status),
    success,
    ...[...errors, HttpStatus.INTERNAL_SERVER_ERROR].map((s) =>
      ApiResponse({
        status: s,
        description: ERROR_DESCRIPTIONS[s] ?? HttpStatus[s],
        type: ErrorResponseDto,
      }),
    ),
  );
}

/** Opts a route out of the envelope (probes whose callers expect their own shape). */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);
