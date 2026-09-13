import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Shared page/limit pair for every list endpoint. Because the global
 * ValidationPipe runs with `forbidNonWhitelisted: true`, a query DTO that wants
 * paging must EXTEND this class rather than declare `page`/`limit` alongside it —
 * an unrelated class merely also having those two properties doesn't satisfy Nest's
 * whitelist, which is keyed off the validated class's own declared properties.
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
