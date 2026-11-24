import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service.js';
import { LoginDto } from './dto/login.dto.js';

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

  // Valida las credenciales del usuario.
  // 1. Busca el usuario por username.
  // 2. Compara la contraseña enviada con el hash guardado en la BD.
  // 3. Si todo coincide, devuelve los datos del usuario (sin password).
  async validateUser(loginDto: LoginDto) {
    const { username, password } = loginDto;

    // Buscamos el usuario por username
    const user = await this.usersService.findByUsername(username);

    // Si no existe, lanzamos UnauthorizedException (401).
    // Usamos el mismo mensaje que si la contraseña fuera incorrecta
    // para no revelar si el username existe o no.
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Comparamos la contraseña en texto plano con el hash guardado.
    // bcrypt.compare() hace el trabajo: extrae la sal del hash,
    // hashea la contraseña enviada y compara.
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Devolvemos el usuario sin el password
    const { password: _, ...result } = user;
    return result;
  }
}
