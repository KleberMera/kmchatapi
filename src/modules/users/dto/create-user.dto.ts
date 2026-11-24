import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

// DTO (Data Transfer Object) que define la estructura y reglas
// de los datos que recibimos al crear un usuario.
// class-validator valida automáticamente estos campos antes de que
// lleguen al controlador.
export class CreateUserDto {
  // Nombres: obligatorio, string, entre 2 y 50 caracteres
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  firstName: string;

  // Apellidos: obligatorio, string, entre 2 y 50 caracteres
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  lastName: string;

  // Username: obligatorio, string, entre 3 y 30 caracteres.
  // Debe ser único en la BD (lo validamos en el servicio).
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(30)
  username: string;

  // Contraseña: obligatorio, mínimo 6 caracteres.
  // Se hasheará antes de guardar en la BD.
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}
