import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Roles } from '../authorization/roles.decorator.js';
import { ApiEndpoint } from '../common/api-endpoint.decorator.js';
import {
  offsetOf,
  type Paginated,
  PaginationQueryDto,
  toPage,
} from '../common/pagination.js';
import { Database } from '../database/database.js';
import { AuditLogDto } from './dto/audit-log.dto.js';
import { listAudit } from './audit.queries.js';

class AuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Exact action name', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorId?: string;
}

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly database: Database) {}

  @ApiEndpoint({
    summary: 'List audit log entries',
    description:
      'Returns a page of append-only audit entries, newest first, optionally filtered by action or actor. Requires the admin role.',
    message: 'Audit log retrieved',
    type: AuditLogDto,
    paginated: true,
    errors: [
      HttpStatus.BAD_REQUEST,
      HttpStatus.UNAUTHORIZED,
      HttpStatus.FORBIDDEN,
      HttpStatus.TOO_MANY_REQUESTS,
    ],
  })
  @Roles('admin')
  @Get()
  async list(@Query() query: AuditQueryDto): Promise<Paginated<AuditLogDto>> {
    const { rows, total } = await listAudit(this.database.db, query, {
      limit: query.limit,
      offset: offsetOf(query),
    });
    return toPage(rows, total, query);
  }
}
