import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BulkModule } from './modules/bulk/bulk.module.js';
import { User } from './modules/whatsapp/entities/user.entity.js';
import { WhatsappSession } from './modules/whatsapp/entities/whatsapp-session.entity.js';
import { BulkBatch } from './modules/bulk/entities/bulk-batch.entity.js';
import { BulkMessageLog } from './modules/bulk/entities/bulk-message-log.entity.js';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      // Incluimos las 4 entidades para que TypeORM las registre
      entities: [User, WhatsappSession, BulkBatch, BulkMessageLog],
      synchronize: true,
      logging: false,
    }),

    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),

    WhatsappModule,
    UsersModule,
    AuthModule,
    BulkModule,
  ],
})
export class AppModule {}