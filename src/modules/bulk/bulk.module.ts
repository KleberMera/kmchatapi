import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { BulkBatch } from './entities/bulk-batch.entity.js';
import { BulkMessageLog } from './entities/bulk-message-log.entity.js';
import { BulkSenderService } from './bulk-sender.service.js';
import { BulkProcessor } from './bulk.processor.js';
import { BulkController } from './bulk.controller.js';
import { WhatsappModule } from '../whatsapp/whatsapp.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([BulkBatch, BulkMessageLog]),
    BullModule.registerQueue({ name: 'bulk-send' }),
    WhatsappModule,
  ],
  controllers: [BulkController],
  providers: [BulkSenderService, BulkProcessor],
})
export class BulkModule {}