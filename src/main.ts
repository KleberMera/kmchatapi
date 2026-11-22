import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';
import { HttpExceptionFilter } from './common/interceptors/http-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*',
  });

  app.setGlobalPrefix('api');
  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(process.env.PORT ?? 2210);
}
await bootstrap();
