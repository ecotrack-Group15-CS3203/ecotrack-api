import { IsString, MinLength } from 'class-validator';

export class AddTaskNoteDto {
  @IsString()
  @MinLength(1)
  note: string;
}
