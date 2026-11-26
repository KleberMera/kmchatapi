import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';
import { HttpExceptionFilter } from './common/interceptors/http-exception.filter.js';
import { isTransientWhatsAppBrowserError } from './common/is-transient-whatsapp-error.js';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const { AppModule } = await import('./app.module.js');

const processLogger = new Logger('Process');
process.on('unhandledRejection', (reason: unknown) => {
  const error =
    reason instanceof Error ? reason : new Error(String(reason));
  if (isTransientWhatsAppBrowserError(error)) {
    processLogger.warn(
      `Fallo transitorio al inicializar WhatsApp Web: ${error.message}\n${error.stack ?? ''}`,
    );
    return;
  }

  processLogger.error(
    `Rechazo de promesa no controlado: ${error.message}`,
    error.stack,
  );
  setImmediate(() => {
    throw reason;
  });
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS abierto (ajusta en producción)
  app.enableCors({ origin: '*' });

  // Prefijo global: todas las rutas empiezan con /api
  app.setGlobalPrefix('api');

  // Validación global: cualquier DTO con decoradores de class-validator
  // se validará automáticamente antes de llegar al controlador.
  // whitelist: true elimina propiedades que no estén en el DTO.
  // forbidNonWhitelisted: true lanza error si llegan propiedades extra.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Interceptor global para envolver respuestas en { data, message, status }
  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));

  // Filtro global para envolver errores en el mismo formato
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.listen(process.env.PORT ?? 2261);
}
await bootstrap();
