import { ApiProperty } from '@nestjs/swagger';
import { roleEnum, type Role } from '../../database/schema/index.js';

export class UserSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'email' })
  email: string;

  @ApiProperty({ enum: roleEnum.enumValues })
  role: Role;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}
