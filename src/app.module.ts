import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module.js';
import { User } from './modules/whatsapp/entities/user.entity.js';
import { WhatsappSession } from './modules/whatsapp/entities/whatsapp-session.entity.js';
import { UsersModule } from './modules/users/users.module.js';
import { AuthModule } from './modules/auth/auth.module.js';

@Module({
  imports: [
    // Configuración de TypeORM con PostgreSQL.
    // entities lista todas las entidades que TypeORM debe conocer.
    // synchronize: true crea/actualiza las tablas automáticamente (solo desarrollo).
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [User, WhatsappSession],
      synchronize: true,
      logging: false,
    }),

    // Módulo de WhatsApp con el gestor de sesiones
    WhatsappModule,
    UsersModule,
    AuthModule,
  ],
})
export class AppModule {}
