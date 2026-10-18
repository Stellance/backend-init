import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Roles } from '../authorization/roles.decorator.js';
import { type Page, PaginationQueryDto, toPage } from '../common/pagination.js';
import { Database } from '../database/database.js';
import { listAudit } from './audit.queries.js';

class AuditQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @IsOptional()
  @IsUUID()
  actorId?: string;
}

@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly database: Database) {}

  @Roles('admin')
  @Get()
  async list(@Query() query: AuditQueryDto): Promise<Page<unknown>> {
    const { rows, total } = await listAudit(this.database.db, query, query);
    return toPage(rows, total, query);
  }
}
