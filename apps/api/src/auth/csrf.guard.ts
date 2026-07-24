import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PUBLIC_ROUTE } from './public.decorator';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    // Public routes authorize by their own means (a signed token, a setup token),
    // never by the session cookie, so the cookie-forgery attack CSRF defends does
    // not apply — a same-origin browser PUT to a signed proxy URL carries no CSRF
    // header and must not be rejected for lacking one.
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
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
