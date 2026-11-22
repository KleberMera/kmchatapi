import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = this.extractMessage(exception);

    // Log completo en el servidor (incluye stack), pero no se envía al cliente
    this.logger.error(
      `${request.method} ${request.url} → ${status} ${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(status).json({
      data: null,
      message,
      status,
    });
  }

  private extractMessage(exception: unknown): string {
    // 1. HttpException: extrae el mensaje del response de Nest
    if (exception instanceof HttpException) {
      const res = exception.getResponse();

      if (typeof res === 'string') {
        return res;
      }

      if (typeof res === 'object' && res !== null) {
        const msg = (res as any).message;
        // Nest a veces devuelve message como array (errores de validación)
        return Array.isArray(msg) ? msg.join(', ') : (msg ?? exception.message);
      }

      return exception.message;
    }

    // 2. Errores de PostgreSQL: código alfanumérico de 5 caracteres (ej: 23505, 42P01)
    const pgCode = (exception as any)?.code;
    if (typeof pgCode === 'string' && /^[0-9A-Z]{5}$/.test(pgCode)) {
      // En producción conviene no exponer 'detail'; en desarrollo es muy útil
      return (
        (exception as any).detail ??
        (exception as any).message ??
        'Error en la base de datos'
      );
    }

    // 3. Cualquier otro error: mensaje genérico
    return 'Error interno del servidor';
  }
}
