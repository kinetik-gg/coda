import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';

function appendVary(response: Response, value: string): void {
  const current = response.getHeader('Vary');
  const values = (Array.isArray(current) ? current : String(current ?? '').split(','))
    .map((entry) => String(entry).trim())
    .filter(Boolean);
  if (!values.some((entry) => entry.toLowerCase() === value.toLowerCase())) values.push(value);
  response.setHeader('Vary', values.join(', '));
}

@Injectable()
export class ScreenplayCacheControlInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'private,no-store');
    appendVary(response, 'Cookie');
    return next.handle();
  }
}
