import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionManagerService } from '../whatsapp/session-manager.service.js';
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
  ) {}

  // Reemplaza los placeholders {campo} del mensaje con los valores
  // del destinatario. Si un placeholder no existe en el objeto,
  // se deja tal cual (o se puede reemplazar por string vacío).
  private personalizeMessage(
    template: string,
    recipient: Record<string, string>,
  ): string {
    let result = template;

    // Recorremos todos los campos del destinatario (excepto phone)
    for (const [key, value] of Object.entries(recipient)) {
      if (key === 'phone' || !value) continue;

      // Reemplaza todas las ocurrencias de {key} con el valor.
      // Usamos una regex global para reemplazar todas las apariciones.
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
    }

    // Opcional: limpiar placeholders que no se reemplazaron.
    // Si prefieres dejarlos visibles, comenta esta línea.
    // result = result.replace(/\{[^}]+\}/g, '');

    return result;
  }

  // Método principal que ejecuta el Worker de BullMQ.
  async processBatch(batchId: string): Promise<void> {
    const batch = await this.batchRepo.findOneBy({ id: batchId });
    if (!batch || batch.status !== 'PENDING') return;

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
    } = batch.config;

    // Filtramos las sesiones activas en memoria.
    // Usamos una copia mutable (activeSessions) para poder eliminar
    // sesiones que se deslogueen durante el proceso.
    const activeSessions = sessionIds.filter((id) =>
      this.sessionManager['clients'].has(id),
    );
    if (activeSessions.length === 0) {
      batch.status = 'FAILED';
      await this.batchRepo.save(batch);
      throw new Error('No hay sesiones activas para procesar el lote');
    }

    let currentSessionIndex = 0;
    let messagesInCurrentBatch = 0;

    for (const recipient of recipients) {
      const phone = recipient.phone.replace(/\D/g, '');
      if (!phone) {
        batch.invalid++;
        batch.processed++;
        await this.batchRepo.save(batch);
        continue;
      }

      let sent = false;
      // Reiniciamos los intentos para cada destinatario.
      // El máximo de intentos es el número de sesiones activas actuales
      // (que puede haber disminuido si alguna se deslogueó).
      let attempts = 0;

      // Si ya no quedan sesiones activas, abortamos el lote
      if (activeSessions.length === 0) {
        this.logger.error(
          `Lote ${batchId} abortado: todas las sesiones se desconectaron`,
        );
        batch.status = 'FAILED';
        batch.currentSessionId = '';
        await this.batchRepo.save(batch);
        return;
      }

      while (!sent && attempts < activeSessions.length) {
        // Protección por si el índice quedó fuera de rango tras eliminar sesiones
        if (currentSessionIndex >= activeSessions.length) {
          currentSessionIndex = 0;
        }

        const sessionId = activeSessions[currentSessionIndex];
        batch.currentSessionId = sessionId;
        await this.batchRepo.save(batch);

        // Comprobación previa: si la sesión ya no está activa (se deslogueó
        // entre iteraciones), la eliminamos de la rotación y saltamos
        // a la siguiente sin gastar un intento de envío.
        if (!this.sessionManager['clients'].has(sessionId)) {
          this.logger.warn(
            `Sesión ${sessionId} ya no está activa, eliminándola de la rotación`,
          );
          activeSessions.splice(currentSessionIndex, 1);
          if (activeSessions.length === 0) break; // salir del while
          currentSessionIndex = currentSessionIndex % activeSessions.length;
          continue;
        }

        // 1. Verificar si el número tiene WhatsApp
        const numberId = await this.sessionManager.verifyNumber(
          sessionId,
          phone,
        );

        if (!numberId) {
          await this.logRepo.save({
            batchId,
            phoneNumber: phone,
            sessionId,
            status: 'INVALID',
            errorMessage: 'Número no registrado en WhatsApp',
          });
          batch.invalid++;
          sent = true;
          break;
        }

        // 2. Personalizar el mensaje con los datos de esta fila
        const personalizedMessage = this.personalizeMessage(message, recipient);

        // 3. Intentar enviar
        try {
          await this.sessionManager.sendMessage(
            sessionId,
            phone,
            personalizedMessage,
          );
          await this.logRepo.save({
            batchId,
            phoneNumber: phone,
            sessionId,
            status: 'SENT',
          });
          batch.sent++;
          sent = true;
        } catch (error: any) {
          this.logger.warn(
            `Fallo con sesión ${sessionId} al enviar a ${phone}: ${error.message}. Rotando sesión...`,
          );
          await this.logRepo.save({
            batchId,
            phoneNumber: phone,
            sessionId,
            status: 'FAILED',
            errorMessage: error.message,
          });

          // Si la sesión ya no existe en memoria (se deslogueó),
          // la eliminamos de la rotación para no volver a intentarla.
          if (!this.sessionManager['clients'].has(sessionId)) {
            this.logger.warn(
              `Sesión ${sessionId} se desconectó durante el envío, eliminándola`,
            );
            activeSessions.splice(currentSessionIndex, 1);
            if (activeSessions.length === 0) {
              this.logger.error(
                `Lote ${batchId} abortado: todas las sesiones se desconectaron`,
              );
              batch.status = 'FAILED';
              batch.currentSessionId = '';
              await this.batchRepo.save(batch);
              return;
            }
            currentSessionIndex = currentSessionIndex % activeSessions.length;
          } else {
            // La sesión sigue activa, solo rotamos
            attempts++;
            currentSessionIndex =
              (currentSessionIndex + 1) % activeSessions.length;
          }
        }

        await new Promise((r) => setTimeout(r, verifyDelayMs));
      }

      if (!sent) {
        batch.failed++;
      }

      batch.processed++;
      messagesInCurrentBatch++;
      await this.batchRepo.save(batch);

      // Si todas las sesiones se cayeron, no tiene sentido seguir con pausas
      if (activeSessions.length === 0) {
        this.logger.error(
          `Lote ${batchId} abortado: todas las sesiones se desconectaron`,
        );
        batch.status = 'FAILED';
        batch.currentSessionId = '';
        await this.batchRepo.save(batch);
        return;
      }

      // Aplicar pausas
      if (messagesInCurrentBatch >= batchSize) {
        this.logger.log(
          `Pausa larga de ${longPauseMs}ms después de ${batchSize} mensajes`,
        );
        await new Promise((r) => setTimeout(r, longPauseMs));
        messagesInCurrentBatch = 0;
        currentSessionIndex = (currentSessionIndex + 1) % activeSessions.length;
      } else {
        await new Promise((r) => setTimeout(r, delayBetweenMessagesMs));
      }
    }

    batch.status = 'COMPLETED';
    batch.currentSessionId = '';
    await this.batchRepo.save(batch);
    this.logger.log(
      `Lote ${batchId} completado. Enviados: ${batch.sent}, Fallidos: ${batch.failed}, Inválidos: ${batch.invalid}`,
    );
  }
}
