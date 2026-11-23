import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module.js';
import { User } from './modules/whatsapp/entities/user.entity.js';
import { WhatsappSession } from './modules/whatsapp/entities/whatsapp-session.entity.js';

@Module({
  imports: [
    // Configuración de TypeORM con PostgreSQL.
    // entities lista todas las entidades que TypeORM debe conocer.
    // synchronize: true crea/actualiza las tablas automáticamente (solo desarrollo).
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USER ?? 'postgres',
      password: process.env.DB_PASSWORD ?? '0928213727',
      database: process.env.DB_NAME ?? 'kmchat',
      entities: [User, WhatsappSession],
      synchronize: true,
      logging: false,
    }),

    // Módulo de WhatsApp con el gestor de sesiones
    WhatsappModule,
  ],
})
export class AppModule {}