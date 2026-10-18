import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth-user.js';
import { assertCan } from '../authorization/assert-can.js';
import { CheckPolicies } from '../authorization/policies.decorator.js';
import { Roles } from '../authorization/roles.decorator.js';
import { type Page, PaginationQueryDto, toPage } from '../common/pagination.js';
import { Database } from '../database/database.js';
import type { Role } from '../database/schema/index.js';
import { findUserById, listUsers } from './users.queries.js';

interface UserSummary {
  id: string;
  email: string;
  role: Role;
  createdAt: Date;
}

@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly database: Database) {}

  @Roles('admin')
  @Get()
  async list(@Query() query: PaginationQueryDto): Promise<Page<UserSummary>> {
    const { rows, total } = await listUsers(this.database.db, query);
    return toPage(rows, total, query);
  }

  @CheckPolicies((ability) => ability.can('read', 'User'))
  @Get(':id')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<UserSummary> {
    const user = await findUserById(this.database.db, id);
    // Authorise before 404 so non-admins cannot probe which ids exist.
    if (!user) {
      assertCan(req.ability, 'read', 'User', { id });
      throw new NotFoundException();
    }
    assertCan(req.ability, 'read', 'User', user);
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    };
  }
}
