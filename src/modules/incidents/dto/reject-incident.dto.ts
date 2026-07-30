import { IsString, MinLength } from 'class-validator';

export class RejectIncidentDto {
  @IsString()
  @MinLength(1)
  reason: string;
}
