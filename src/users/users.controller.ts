import {
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth-user.js';
import { assertCan } from '../authorization/assert-can.js';
import { CheckPolicies } from '../authorization/policies.decorator.js';
import { Roles } from '../authorization/roles.decorator.js';
import { ApiEndpoint } from '../common/api-endpoint.decorator.js';
import {
  offsetOf,
  type Paginated,
  PaginationQueryDto,
  toPage,
} from '../common/pagination.js';
import { Database } from '../database/database.js';
import { UserSummaryDto } from './dto/user.dto.js';
import { findUserById, listUsers } from './users.queries.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly database: Database) {}

  @ApiEndpoint({
    summary: 'List users',
    description:
      'Returns a page of users, newest first. Requires the admin role.',
    message: 'Users retrieved',
    type: UserSummaryDto,
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
  async list(
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<UserSummaryDto>> {
    const { rows, total } = await listUsers(this.database.db, {
      limit: query.limit,
      offset: offsetOf(query),
    });
    return toPage(rows, total, query);
  }

  @ApiEndpoint({
    summary: 'Get a user',
    description:
      'Returns one user by id. Admins can read any user; other callers only themselves.',
    message: 'User retrieved',
    type: UserSummaryDto,
    errors: [
      HttpStatus.BAD_REQUEST,
      HttpStatus.UNAUTHORIZED,
      HttpStatus.FORBIDDEN,
      HttpStatus.NOT_FOUND,
      HttpStatus.TOO_MANY_REQUESTS,
    ],
  })
  @CheckPolicies((ability) => ability.can('read', 'User'))
  @Get(':id')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<UserSummaryDto> {
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
