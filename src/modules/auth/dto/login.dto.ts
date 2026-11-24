import { IsString, IsNotEmpty } from 'class-validator';

// DTO para el login.
// Solo necesitamos username y password.
export class LoginDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}