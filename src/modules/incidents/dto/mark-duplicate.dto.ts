import { IsUUID } from 'class-validator';

export class MarkDuplicateDto {
  @IsUUID()
  duplicateOfId: string;
}
