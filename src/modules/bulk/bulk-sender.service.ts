import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionManagerService } from '../whatsapp/session-manager.service.js';
import { BulkMediaStorage } from './bulk-media.storage.js';
import { BulkBatch } from './entities/bulk-batch.entity.js';
import { BulkMessageLog } from './entities/bulk-message-log.entity.js';

@Injectable()
export class BulkSenderService {
  private readonly logger = new Logger(BulkSenderService.name);

  constructor(
    @InjectRepository(BulkBatch) private batchRepo: Repository<BulkBatch>,
    @InjectRepository(BulkMessageLog)
    private logRepo: Repository<BulkMessageLog>,
    private sessionManager: SessionManagerService,
    private mediaStorage: BulkMediaStorage,
  ) {}

  private personalizeMessage(
    template: string,
    recipient: Record<string, string>,
  ): string {
    let result = template;
    for (const [key, value] of Object.entries(recipient)) {
      if (key === 'phone' || !value) continue;
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
    }
    return result;
  }

  private async isRunning(batchId: string, runToken: string | undefined) {
    const batch = await this.batchRepo.findOneBy({ id: batchId });
    return (
      batch?.status === 'PROCESSING' &&
      (batch.runToken ?? null) === (runToken ?? null)
    );
  }

  private async hasCurrentRun(
    batchId: string,
    runToken: string | undefined,
  ): Promise<boolean> {
    const batch = await this.batchRepo.findOneBy({ id: batchId });
    return Boolean(
      batch && (batch.runToken ?? null) === (runToken ?? null),
    );
  }

  private async waitWhileRunning(
    batchId: string,
    runToken: string | undefined,
    delayMs: number,
  ): Promise<boolean> {
    let remaining = delayMs;
    while (remaining > 0) {
      const interval = Math.min(remaining, 1000);
      await new Promise((resolve) => setTimeout(resolve, interval));
      remaining -= interval;
      if (!(await this.isRunning(batchId, runToken))) return false;
    }
    return this.isRunning(batchId, runToken);
  }

  private async saveProgress(
    batch: BulkBatch,
    runToken: string | undefined,
  ): Promise<boolean> {
    const current = await this.batchRepo.findOneBy({ id: batch.id });
    if (!current || (current.runToken ?? null) !== (runToken ?? null))
      return false;

    current.processed = batch.processed;
    current.sent = batch.sent;
    current.failed = batch.failed;
    current.invalid = batch.invalid;
    current.currentSessionId = batch.currentSessionId;
    await this.batchRepo.save(current);
    return current.status === 'PROCESSING';
  }

  async processBatch(
    batchId: string,
    runToken?: string,
  ): Promise<void> {
    const batch = await this.batchRepo.findOneBy({ id: batchId });
    if (
      !batch ||
      batch.status !== 'PENDING' ||
      (batch.runToken ?? null) !== (runToken ?? null)
    ) {
      return;
    }

    batch.status = 'PROCESSING';
    await this.batchRepo.save(batch);

    const {
      sessionIds,
      recipients,
      message,
      delayBetweenMessagesMs,
      batchSize,
      longPauseMs,
      verifyDelayMs,
      verifyNumbers = true,
    } = batch.config;

    let videoData: Buffer | null = null;
    if (batch.videoKey) {
      try {
        videoData = await this.mediaStorage.read(batch.videoKey);
      } catch (error: unknown) {
        batch.status = 'FAILED';
        await this.batchRepo.save(batch);
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `No se pudo leer el video del lote ${batchId}: ${message}`,
        );
        throw error;
      }
    }
    const video =
      videoData && batch.videoMimeType && batch.videoFileName
        ? {
            data: videoData.toString('base64'),
            mimetype: batch.videoMimeType,
            filename: batch.videoFileName,
            filesize: videoData.length,
          }
        : null;

    const activeSessions = sessionIds.filter((id) =>
      this.sessionManager['clients'].has(id),
    );
    if (activeSessions.length === 0) {
      batch.status = 'FAILED';
      await this.batchRepo.save(batch);
      throw new Error('No hay sesiones activas para procesar el lote');
    }

    const sessionDetails =
      await this.sessionManager.getSessionDetails(activeSessions);
    let currentSessionIndex = 0;
    let messagesInCurrentBatch = 0;

    for (const recipient of recipients) {
      if (!(await this.isRunning(batchId, runToken))) return;

      const phone = recipient.phone.replace(/\D/g, '');
      if (!phone) {
        batch.invalid++;
        batch.processed++;
        if (!(await this.saveProgress(batch, runToken))) return;
        continue;
      }

      let sent = false;
      let messageSent = false;
      let attemptLogged = false;
      let attempts = 0;

      while (!sent && attempts < activeSessions.length) {
        if (!(await this.isRunning(batchId, runToken))) {
          if (!attemptLogged) return;
          break;
        }
        if (currentSessionIndex >= activeSessions.length) currentSessionIndex = 0;

        const sessionId = activeSessions[currentSessionIndex];
        batch.currentSessionId = sessionId;

        if (!this.sessionManager['clients'].has(sessionId)) {
          this.logger.warn(
            `Sesión ${sessionId} ya no está activa, eliminándola de la rotación`,
          );
          activeSessions.splice(currentSessionIndex, 1);
          if (activeSessions.length === 0) break;
          currentSessionIndex %= activeSessions.length;
          continue;
        }

        if (verifyNumbers) {
          let numberId: string | null;
          try {
            numberId = await this.sessionManager.verifyNumber(sessionId, phone);
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            if (!(await this.hasCurrentRun(batchId, runToken))) return;
            this.logger.error(
              `Error verificando ${phone} con ${sessionId}: ${errorMessage}`,
            );
            await this.logRepo.save({
              batchId,
              phoneNumber: phone,
              sessionId,
              sessionPhoneNumber:
                sessionDetails.get(sessionId)?.phoneNumber ?? null,
              sessionName: sessionDetails.get(sessionId)?.name ?? null,
              status: 'FAILED',
              errorMessage: `Error de verificación: ${errorMessage}`,
            });
            attemptLogged = true;

            if (!this.sessionManager['clients'].has(sessionId)) {
              activeSessions.splice(currentSessionIndex, 1);
              if (activeSessions.length === 0) break;
              currentSessionIndex %= activeSessions.length;
            } else {
              attempts++;
              currentSessionIndex =
                (currentSessionIndex + 1) % activeSessions.length;
            }

            if (
              !(await this.waitWhileRunning(
                batchId,
                runToken,
                verifyDelayMs,
              ))
            ) {
              break;
            }
            continue;
          }

          if (!numberId) {
            if (!(await this.hasCurrentRun(batchId, runToken))) return;
            await this.logRepo.save({
              batchId,
              phoneNumber: phone,
              sessionId,
              sessionPhoneNumber:
                sessionDetails.get(sessionId)?.phoneNumber ?? null,
              sessionName: sessionDetails.get(sessionId)?.name ?? null,
              status: 'INVALID',
              errorMessage: 'Número no registrado en WhatsApp',
            });
            attemptLogged = true;
            batch.invalid++;
            sent = true;
            currentSessionIndex =
              (currentSessionIndex + 1) % activeSessions.length;
            break;
          }

          if (!(await this.isRunning(batchId, runToken))) {
            if (!attemptLogged) return;
            break;
          }
          if (
            !(await this.waitWhileRunning(batchId, runToken, verifyDelayMs))
          ) {
            if (!attemptLogged) return;
            break;
          }
        }

        const personalizedMessage = this.personalizeMessage(message, recipient);
        try {
          if (video) {
            await this.sessionManager.sendVideo(
              sessionId,
              phone,
              personalizedMessage,
              video,
            );
          } else {
            await this.sessionManager.sendMessage(
              sessionId,
              phone,
              personalizedMessage,
            );
          }
          if (!(await this.hasCurrentRun(batchId, runToken))) return;
          await this.logRepo.save({
            batchId,
            phoneNumber: phone,
            sessionId,
            sessionPhoneNumber:
              sessionDetails.get(sessionId)?.phoneNumber ?? null,
            sessionName: sessionDetails.get(sessionId)?.name ?? null,
            status: 'SENT',
          });
          attemptLogged = true;
          batch.sent++;
          sent = true;
          messageSent = true;
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          const errorDetails =
            error instanceof Error ? (error.stack ?? error.message) : errorMessage;
          if (!(await this.hasCurrentRun(batchId, runToken))) return;
          this.logger.error(
            `Error enviando a ${phone} con ${sessionId}${video ? ` (video ${video.filename}, ${video.mimetype}, ${video.filesize} bytes)` : ''}: ${errorMessage}`,
            error instanceof Error ? error.stack : undefined,
          );
          await this.logRepo.save({
            batchId,
            phoneNumber: phone,
            sessionId,
            sessionPhoneNumber:
              sessionDetails.get(sessionId)?.phoneNumber ?? null,
            sessionName: sessionDetails.get(sessionId)?.name ?? null,
            status: 'FAILED',
            errorMessage: errorDetails,
          });
          attemptLogged = true;

          if (!this.sessionManager['clients'].has(sessionId)) {
            activeSessions.splice(currentSessionIndex, 1);
            if (activeSessions.length === 0) break;
            currentSessionIndex %= activeSessions.length;
          } else {
            attempts++;
            currentSessionIndex =
              (currentSessionIndex + 1) % activeSessions.length;
          }
        }

      }

      if (!sent) batch.failed++;
      batch.processed++;
      messagesInCurrentBatch++;
      if (messageSent && activeSessions.length > 0) {
        currentSessionIndex = (currentSessionIndex + 1) % activeSessions.length;
      }
      if (!(await this.saveProgress(batch, runToken))) return;

      if (activeSessions.length === 0) {
        batch.status = 'FAILED';
        batch.currentSessionId = '';
        await this.batchRepo.save(batch);
        this.logger.error(
          `Lote ${batchId} abortado: todas las sesiones se desconectaron`,
        );
        return;
      }

      const delay =
        messagesInCurrentBatch >= batchSize
          ? longPauseMs
          : delayBetweenMessagesMs;
      if (messagesInCurrentBatch >= batchSize) {
        this.logger.log(
          `Pausa larga de ${longPauseMs}ms después de ${batchSize} mensajes`,
        );
        messagesInCurrentBatch = 0;
      }
      if (!(await this.waitWhileRunning(batchId, runToken, delay))) return;
    }

    const current = await this.batchRepo.findOneBy({ id: batchId });
    if (
      !current ||
      current.status !== 'PROCESSING' ||
      (current.runToken ?? null) !== (runToken ?? null)
    ) {
      return;
    }
    current.status = 'COMPLETED';
    current.currentSessionId = '';
    await this.batchRepo.save(current);
    this.logger.log(
      `Lote ${batchId} completado. Enviados: ${current.sent}, Fallidos: ${current.failed}, Inválidos: ${current.invalid}`,
    );
  }
}
