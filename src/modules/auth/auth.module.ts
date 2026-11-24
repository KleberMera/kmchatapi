import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';

@Module({
  // Importamos UsersModule para poder inyectar UsersService.
  // AuthService lo necesita para buscar usuarios por username.
  imports: [UsersModule],

  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
