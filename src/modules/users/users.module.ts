import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../whatsapp/entities/user.entity.js';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';

@Module({
  // Registramos la entidad User para poder inyectar su repositorio
  imports: [TypeOrmModule.forFeature([User])],

  // Controladores que exponen las rutas de usuarios
  controllers: [UsersController],

  // Servicios que contienen la lógica de negocio
  providers: [UsersService],

  // Exportamos UsersService para que AuthModule pueda usarlo
  exports: [UsersService],
})
export class UsersModule {}