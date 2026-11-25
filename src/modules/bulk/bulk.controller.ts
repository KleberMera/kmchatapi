import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BulkBatch } from './entities/bulk-batch.entity.js';
import { BulkMessageLog } from './entities/bulk-message-log.entity.js';

@Controller('bulk')
export class BulkController {
  constructor(
    @InjectQueue('bulk-send') private readonly bulkQueue: Queue,
    @InjectRepository(BulkBatch)
    private readonly batchRepo: Repository<BulkBatch>,
    @InjectRepository(BulkMessageLog)
    private readonly logRepo: Repository<BulkMessageLog>,
  ) {}

  // ============================================================
  // POST /api/bulk/start
  // Crea un lote de envío masivo y lo encola en BullMQ.
  // Responde inmediatamente con el batchId (no espera al envío).
  //
  // Body esperado:
  // {
  //   sessionIds: string[],                    // Sesiones a usar
  //   recipients: [{ phone, nombre?, ... }],   // Destinatarios con campos dinámicos
  //   message: string,                         // Plantilla con {placeholders}
  //   delayBetweenMessagesMs: number,          // Pausa entre mensajes (ms)
  //   batchSize: number,                       // Mensajes antes de pausa larga
  //   longPauseMs: number,                     // Duración pausa larga (ms)
  //   verifyDelayMs: number                    // Pausa entre verificaciones (ms)
  // }
  // ============================================================
  @Post('start')
  async start(
    @Body()
    body: {
      sessionIds: string[];
      recipients: Array<{ phone: string; [key: string]: string }>;
      message: string;
      delayBetweenMessagesMs: number;
      batchSize: number;
      longPauseMs: number;
      verifyDelayMs: number;
    },
  ) {
    // 1. Creamos el registro en la BD con estado PENDING
    const batch = this.batchRepo.create({
      config: body,
      total: body.recipients.length,
      status: 'PENDING',
    });
    await this.batchRepo.save(batch);

    // 2. Encolamos el trabajo en BullMQ. Se ejecutará en segundo plano.
    //    attempts: 3 → si el worker falla, reintenta hasta 3 veces
    //    backoff: exponential → espera 5s, 10s, 20s entre reintentos
    await this.bulkQueue.add(
      'send-batch',
      { batchId: batch.id },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    // 3. Respondemos inmediatamente con el ID del lote
    return {
      batchId: batch.id,
      total: batch.total,
      status: batch.status,
      message: 'Envío masivo iniciado en segundo plano',
    };
  }

  // ============================================================
  // GET /api/bulk
  // Lista todos los lotes ordenados por fecha de creación descendente.
  // Soporta paginación con ?page=1&limit=20
  // Útil para que el frontend muestre el historial de envíos.
  // ============================================================
  @Get()
  async findAll(@Query('page') page = '1', @Query('limit') limit = '20') {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    // findAndCount devuelve [items, total] en una sola consulta
    const [items, total] = await this.batchRepo.findAndCount({
      order: { createdAt: 'DESC' },
      skip,
      take: limitNum,
      // No incluimos el config completo en el listado para no enviar
      // todo el array de recipients (puede ser enorme).
      select: {
        id: true,
        total: true,
        processed: true,
        sent: true,
        failed: true,
        invalid: true,
        status: true,
        currentSessionId: true,
        createdAt: true,
      },
    });

    return {
      items: items.map((b) => ({
        ...b,
        progress: b.total > 0 ? Math.round((b.processed / b.total) * 100) : 0,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  }

  // ============================================================
  // GET /api/bulk/status/:batchId
  // Devuelve solo el progreso del lote (para polling del frontend).
  // Es ligero: no incluye config ni logs.
  // ============================================================
  @Get('status/:batchId')
  async getStatus(@Param('batchId') batchId: string) {
    const batch = await this.batchRepo.findOneBy({ id: batchId });
    if (!batch) throw new Error('Lote no encontrado');

    const progress =
      batch.total > 0 ? Math.round((batch.processed / batch.total) * 100) : 0;

    return {
      id: batch.id,
      total: batch.total,
      processed: batch.processed,
      sent: batch.sent,
      failed: batch.failed,
      invalid: batch.invalid,
      progress,
      status: batch.status,
      currentSessionId: batch.currentSessionId,
      createdAt: batch.createdAt,
    };
  }

  // ============================================================
  // GET /api/bulk/:batchId
  // Devuelve el detalle completo del lote, incluyendo la config
  // original (sesiones, mensaje, parámetros de pausa).
  // Útil para una pantalla de "detalle del lote".
  // ============================================================
  @Get(':batchId')
  async findOne(@Param('batchId') batchId: string) {
    const batch = await this.batchRepo.findOneBy({ id: batchId });
    if (!batch) throw new Error('Lote no encontrado');

    return {
      ...batch,
      progress:
        batch.total > 0 ? Math.round((batch.processed / batch.total) * 100) : 0,
    };
  }

  // ============================================================
  // GET /api/bulk/:batchId/logs
  // Devuelve el detalle de cada mensaje del lote.
  // Soporta filtro por status: ?status=SENT|FAILED|INVALID
  // Devuelve todos los logs, incluyendo el identificador y número de sesión.
  // ============================================================
  @Get(':batchId/logs')
  async getLogs(
    @Param('batchId') batchId: string,
    @Query('status') status?: string,
  ) {
    // Construimos el where dinámicamente según si viene status
    const where: any = { batchId };
    if (status) where.status = status;

    const items = await this.logRepo.find({
      where,
      order: { sentAt: 'DESC' },
    });
    const total = items.length;

    return {
      items,
      pagination: {
        page: 1,
        limit: total,
        total,
        totalPages: total === 0 ? 0 : 1,
      },
    };
  }

  // DELETE /api/bulk/:batchId
  // Elimina un lote y todos sus logs asociados (CASCADE en la BD).
  @Delete(':batchId')
  async remove(@Param('batchId') batchId: string) {
    const batch = await this.batchRepo.findOneBy({ id: batchId });
    if (!batch) throw new NotFoundException('Lote no encontrado');
    // Al borrar el batch, los logs se borran en cascada por onDelete: 'CASCADE'
    await this.batchRepo.remove(batch);
    return { deleted: true, batchId };
  }

  // DELETE /api/bulk
  // Elimina TODOS los lotes (y sus logs en cascada).
  // Opcional: ?status=FAILED para borrar solo los fallidos.
  @Delete()
  async removeAll(@Query('status') status?: string) {
    if (status) {
      // Borrar solo los de un estado específico
      const result = await this.batchRepo.delete({ status });
      return { deleted: result.affected ?? 0, filter: { status } };
    }
    // Borrar todos
    const result = await this.batchRepo.clear(); // clear() vacía la tabla
    return { deleted: 'all', message: 'Todos los lotes eliminados' };
  }
}
