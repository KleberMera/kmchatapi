import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller.js';
import { WhatsappService } from './whatsapp.service.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappSession } from './entities/whatsapp-session.entity.js';
import { User } from './entities/user.entity.js';
import { SessionManagerController } from './session-manager.controller.js';
import { SessionManagerService } from './session-manager.service.js';

@Module({
  // forFeature registra las entidades para que sus repositorios
  // puedan ser inyectados en los servicios de este módulo
  imports: [TypeOrmModule.forFeature([WhatsappSession, User])],

  // Controladores que exponen las rutas HTTP
  controllers: [SessionManagerController],

  // Servicios que contienen la lógica de negocio
  providers: [SessionManagerService],

  // Exportamos el servicio para que otros módulos puedan inyectarlo
  exports: [SessionManagerService],
})
export class WhatsappModule {}
