import { ArrayMinSize, IsUUID } from 'class-validator';

export class AssignVolunteersDto {
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  volunteerUserIds: string[];
}
