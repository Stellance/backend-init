import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export const MAX_PAGE_SIZE = 100;

export class PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit = 20;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}

export interface Page<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export const toPage = <T>(
  data: T[],
  total: number,
  q: PaginationQueryDto,
): Page<T> => ({ data, total, limit: q.limit, offset: q.offset });
