import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { ResponseMessage } from '../../common/decorators/response-message.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // POST /api/auth/login
  // Recibe username y password, valida las credenciales
  // y devuelve los datos del usuario (sin password).
  @Post('login')
  @ResponseMessage('Usuario autenticado correctamente')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.validateUser(loginDto);
  }
}
