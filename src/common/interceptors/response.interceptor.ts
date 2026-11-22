import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RESPONSE_MESSAGE } from '../decorators/response-message.decorator.js';
import { SKIP_TRANSFORM } from '../decorators/skip-transform.decorator.js';

export interface Response<T> {
  data: T;
  message: string;
  status: number;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, Response<T>> {
  constructor(private reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    const response = context.switchToHttp().getResponse();
    const statusCode = response.statusCode;

    const message =
      this.reflector.get<string>(RESPONSE_MESSAGE, context.getHandler()) ||
      'Operación realizada con éxito';

    const skipTransform = this.reflector.get<boolean>(
      SKIP_TRANSFORM,
      context.getHandler(),
    );

    return next.handle().pipe(
      map((data) => {
        // Si el handler pidió saltarse el envelope, devolvemos tal cual
        if (skipTransform) {
          return data as unknown as Response<T>;
        }
        return {
          data,
          message,
          status: statusCode,
        };
      }),
    );
  }
}
