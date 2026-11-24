import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';
import { HttpExceptionFilter } from './common/interceptors/http-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS abierto (ajusta en producción)
  app.enableCors({ origin: '*' });

  // Prefijo global: todas las rutas empiezan con /api
  app.setGlobalPrefix('api');

  // Interceptor global para envolver respuestas en { data, message, status }
  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));

  // Filtro global para envolver errores en el mismo formato
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.listen(process.env.PORT ?? 2260);
}
await bootstrap();