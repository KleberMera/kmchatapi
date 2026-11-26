import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { BulkBatch } from './entities/bulk-batch.entity.js';
import { BulkMessageLog } from './entities/bulk-message-log.entity.js';
import { BulkMediaStorage } from './bulk-media.storage.js';

type BulkStartRequest = BulkBatch['config'];
type UploadedVideo = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
};

const MAX_VIDEO_SIZE = 16 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseStartRequest(body: unknown): BulkStartRequest {
  let value = body;
  if (isRecord(body) && typeof body.config === 'string') {
    try {
      value = JSON.parse(body.config) as unknown;
    } catch {
      throw new BadRequestException('La configuración del lote no es válida');
    }
  }
  if (
    !isRecord(value) ||
    !Array.isArray(value.sessionIds) ||
    value.sessionIds.length === 0 ||
    !value.sessionIds.every((id) => typeof id === 'string') ||
    !Array.isArray(value.recipients) ||
    value.recipients.length === 0 ||
    !value.recipients.every(
      (recipient) =>
        isRecord(recipient) && typeof recipient.phone === 'string',
    ) ||
    typeof value.message !== 'string' ||
    typeof value.delayBetweenMessagesMs !== 'number' ||
    typeof value.batchSize !== 'number' ||
    typeof value.longPauseMs !== 'number' ||
    typeof value.verifyDelayMs !== 'number' ||
    !Number.isFinite(value.delayBetweenMessagesMs) ||
    !Number.isInteger(value.batchSize) ||
    value.batchSize < 1 ||
    !Number.isFinite(value.longPauseMs) ||
    !Number.isFinite(value.verifyDelayMs) ||
    value.delayBetweenMessagesMs < 0 ||
    value.longPauseMs < 0 ||
    value.verifyDelayMs < 0 ||
    (value.verifyNumbers !== undefined &&
      typeof value.verifyNumbers !== 'boolean')
  ) {
    throw new BadRequestException('La configuración del lote no es válida');
  }

  return {
    sessionIds: value.sessionIds,
    recipients: value.recipients,
    message: value.message,
    delayBetweenMessagesMs: value.delayBetweenMessagesMs,
    batchSize: value.batchSize,
    longPauseMs: value.longPauseMs,
    verifyDelayMs: value.verifyDelayMs,
    verifyNumbers: value.verifyNumbers ?? true,
  };
}

@Controller('bulk')
export class BulkController {
  private readonly logger = new Logger(BulkController.name);

  constructor(
    @InjectQueue('bulk-send') private readonly bulkQueue: Queue,
    @InjectRepository(BulkBatch)
    private readonly batchRepo: Repository<BulkBatch>,
    @InjectRepository(BulkMessageLog)
    private readonly logRepo: Repository<BulkMessageLog>,
    private readonly mediaStorage: BulkMediaStorage,
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
  //   verifyNumbers?: boolean                  // Verificar antes de enviar (por defecto true)
  //   video?: archivo de video opcional        // Máximo 16 MB, se envía como caption
  // }
  // ============================================================
  @Post('start')
  @UseInterceptors(
    FileInterceptor('video', {
      limits: {
        fileSize: MAX_VIDEO_SIZE,
        fieldSize: 16 * 1024 * 1024,
        files: 1,
      },
      fileFilter: (_request, file, callback) => {
        if (!file.mimetype.startsWith('video/')) {
          callback(new BadRequestException('El archivo adjunto debe ser un video'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  async start(
    @Body() body: unknown,
    @UploadedFile() video?: UploadedVideo,
  ) {
    const config = parseStartRequest(body);
    if (video && video.buffer.length === 0) {
      throw new BadRequestException('El video adjunto está vacío');
    }
    if (video && video.buffer.length > MAX_VIDEO_SIZE) {
      throw new BadRequestException('El video no puede superar los 16 MB');
    }
    const runToken = randomUUID();
    const videoKey = video ? await this.mediaStorage.save(video.buffer) : null;

    // 1. Creamos el registro en la BD con estado PENDING
    const batch = this.batchRepo.create({
      config,
      runToken,
      videoKey,
      videoMimeType: video?.mimetype ?? null,
      videoFileName:
        video?.originalname.split(/[\\/]/).pop()?.slice(0, 255) ?? null,
      total: config.recipients.length,
      status: 'PENDING',
    });
    try {
      await this.batchRepo.save(batch);
    } catch (error: unknown) {
      if (videoKey) {
        try {
          await this.mediaStorage.remove(videoKey);
        } catch (cleanupError: unknown) {
          const message =
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError);
          this.logger.error(`No se pudo limpiar el video ${videoKey}: ${message}`);
        }
      }
      throw error;
    }

    // 2. Encolamos el trabajo en BullMQ. Se ejecutará en segundo plano.
    await this.enqueueBatch(batch.id, runToken);

    // 3. Respondemos inmediatamente con el ID del lote
    return {
      batchId: batch.id,
      total: batch.total,
      status: batch.status,
      message: 'Envío masivo iniciado en segundo plano',
    };
  }

  private enqueueBatch(batchId: string, runToken: string) {
    return this.bulkQueue.add(
      'send-batch',
      { batchId, runToken },
      {
        jobId: `bulk-${batchId}-${runToken}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }

  @Post(':batchId/pause')
  async pause(@Param('batchId') batchId: string) {
    const batch = await this.batchRepo.findOneBy({ id: batchId });
    if (!batch) throw new NotFoundException('Lote no encontrado');
    if (batch.status === 'PAUSED') return { batchId, status: batch.status };
    if (batch.status !== 'PENDING' && batch.status !== 'PROCESSING') {
      throw new ConflictException('Solo se puede pausar un lote activo');
    }

    batch.status = 'PAUSED';
    await this.batchRepo.save(batch);
    return { batchId, status: batch.status };
  }

  @Post(':batchId/restart')
  async restart(@Param('batchId') batchId: string) {
    const batch = await this.batchRepo.findOneBy({ id: batchId });
    if (!batch) throw new NotFoundException('Lote no encontrado');

    const runToken = randomUUID();
    batch.runToken = runToken;
    batch.status = 'PENDING';
    batch.processed = 0;
    batch.sent = 0;
    batch.failed = 0;
    batch.invalid = 0;
    batch.currentSessionId = '';
    await this.batchRepo.save(batch);
    await this.logRepo.delete({ batchId });
    await this.enqueueBatch(batch.id, runToken);
    return { batchId, status: batch.status, message: 'Lote reiniciado' };
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
    if (!batch) throw new NotFoundException('Lote no encontrado');

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
    if (!batch) throw new NotFoundException('Lote no encontrado');

    const { runToken: _runToken, videoKey: _videoKey, ...details } = batch;
    return {
      ...details,
      hasVideo: Boolean(batch.videoFileName),
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
    if (batch.videoKey) await this.mediaStorage.remove(batch.videoKey);
    return { deleted: true, batchId };
  }

  // DELETE /api/bulk
  // Elimina TODOS los lotes (y sus logs en cascada).
  // Opcional: ?status=FAILED para borrar solo los fallidos.
  @Delete()
  async removeAll(@Query('status') status?: string) {
    const batches = await this.batchRepo.find({
      ...(status ? { where: { status } } : {}),
      select: { id: true, videoKey: true },
    });

    let deleted: number | string;
    if (status) {
      // Borrar solo los de un estado específico
      const result = await this.batchRepo.delete({ status });
      deleted = result.affected ?? 0;
    } else {
      // clear() vacía la tabla
      await this.batchRepo.clear();
      deleted = 'all';
    }

    for (const batch of batches) {
      if (batch.videoKey) await this.mediaStorage.remove(batch.videoKey);
    }
    return {
      deleted,
      ...(status
        ? { filter: { status } }
        : { message: 'Todos los lotes eliminados' }),
    };
  }
}
