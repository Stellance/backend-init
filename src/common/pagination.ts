import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export const MAX_PAGE_SIZE = 100;
// Keeps (page - 1) * limit well inside Number.MAX_SAFE_INTEGER.
export const MAX_PAGE = 1_000_000;

export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: '1-based page number',
    minimum: 1,
    maximum: MAX_PAGE,
    default: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page = 1;

  @ApiPropertyOptional({
    description: 'Items per page',
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: 20,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit = 20;
}

export class PaginationMetaDto {
  @ApiProperty({ description: 'Items in this page', example: 20 })
  pageCount: number;

  @ApiProperty({ description: 'Pages available at this page size', example: 5 })
  totalPages: number;

  @ApiProperty({ description: 'Items across all pages', example: 93 })
  totalCount: number;

  @ApiProperty({ description: 'A page exists before this one' })
  previousPage: boolean;

  @ApiProperty({ description: 'A page exists after this one' })
  nextPage: boolean;
}

/** Handler return type that the response interceptor wraps as paginated data. */
export class Paginated<T> {
  constructor(
    readonly results: T[],
    readonly paginationMeta: PaginationMetaDto,
  ) {}
}

export const offsetOf = (q: PaginationQueryDto): number =>
  (q.page - 1) * q.limit;

export const toPage = <T>(
  results: T[],
  totalCount: number,
  q: PaginationQueryDto,
): Paginated<T> => {
  const totalPages = Math.ceil(totalCount / q.limit);
  return new Paginated(results, {
    pageCount: results.length,
    totalPages,
    totalCount,
    previousPage: q.page > 1,
    nextPage: q.page < totalPages,
  });
};
