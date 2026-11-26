import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { BulkSenderService } from './bulk-sender.service.js';

// Este procesador escucha la cola 'bulk-send'.
// Cuando hay un trabajo, ejecuta processBatch en segundo plano.
// Si el worker falla, BullMQ reintenta según la configuración del job.
@Processor('bulk-send')
export class BulkProcessor extends WorkerHost {
  constructor(private readonly bulkSenderService: BulkSenderService) {
    super();
  }

  async process(job: Job<{ batchId: string; runToken?: string }>): Promise<void> {
    await this.bulkSenderService.processBatch(
      job.data.batchId,
      job.data.runToken,
    );
  }
}