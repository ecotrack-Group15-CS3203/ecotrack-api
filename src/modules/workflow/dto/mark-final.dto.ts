import { IsBoolean } from 'class-validator';

export class MarkFinalDto {
  @IsBoolean()
  isFinal: boolean;
}
