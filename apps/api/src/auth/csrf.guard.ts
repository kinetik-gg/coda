import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      !request.user ||
      request.authenticationType === 'credential' ||
      ['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    )
      return true;
    const cookie = request.cookies?.coda_csrf as string | undefined;
    const header = request.get('x-coda-csrf');
    if (!cookie || !header || cookie !== header)
      throw new ForbiddenException('CSRF token is missing or invalid');
    return true;
  }
}
