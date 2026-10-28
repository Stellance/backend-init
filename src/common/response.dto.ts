import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Fields shared by every success body; `data` is added per endpoint. */
export class ResponseEnvelopeDto {
  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiProperty({ example: 'Users retrieved' })
  message: string;
}

export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({
    description: 'Stable machine-readable name of the HTTP status',
    example: 'BAD_REQUEST',
  })
  code: string;

  @ApiProperty({ example: 'Validation failed' })
  message: string;

  @ApiPropertyOptional({
    description: 'Per-field validation messages',
    type: [String],
  })
  details?: string[];

  @ApiPropertyOptional({ description: 'Echoes the x-request-id header' })
  requestId?: string;

  @ApiPropertyOptional({ description: 'W3C trace id (32 hex chars)' })
  traceId?: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: '/v1/users' })
  path: string;
}
