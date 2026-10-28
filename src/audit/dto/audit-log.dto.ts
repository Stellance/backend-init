import { ApiProperty } from '@nestjs/swagger';

export class AuditLogDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ type: String, format: 'date-time' })
  at: Date;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  actorId: string | null;

  @ApiProperty({ example: 'auth.login_failed' })
  action: string;

  @ApiProperty({ type: String, nullable: true })
  resourceType: string | null;

  @ApiProperty({ type: String, nullable: true })
  resourceId: string | null;

  @ApiProperty({ type: String, nullable: true })
  requestId: string | null;

  @ApiProperty({ type: String, nullable: true })
  traceId: string | null;

  @ApiProperty({ type: String, nullable: true })
  ip: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  metadata: Record<string, unknown>;
}
