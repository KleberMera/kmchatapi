import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres', // antes decía 'mysql'
      host: 'localhost',
      port: 5432, // el puerto por defecto de Postgres es 5432
      username: 'postgres',
      password: '0928213727',
      database: 'kmchat',
      entities: [],
      synchronize: true, // solo para desarrollo; en producción ponlo en false
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
