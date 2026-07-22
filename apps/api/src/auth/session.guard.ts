import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PUBLIC_ROUTE } from './public.decorator';

function credentialRouteAllowed(request: Request, projectId: string): boolean {
  const method = request.method.toUpperCase();
  if (
    method === 'GET' &&
    ['/api/v1/token/context', '/api/v1/openapi.json'].includes(request.path)
  ) {
    return true;
  }
  if (method === 'POST' && request.path === '/api/v1/uploads') return true;

  const root = `/api/v1/projects/${projectId}`;
  if (!request.path.startsWith(root)) return false;
  const suffix = request.path.slice(root.length);
  const exact = new Set([
    'GET ',
    'PATCH ',
    'POST /entity-types',
    'GET /items',
    'POST /items',
    'POST /fields',
    'POST /source-documents',
    'GET /activity',
  ]);
  if (exact.has(`${method} ${suffix}`)) return true;

  const rules: Array<[string, RegExp]> = [
    ['PATCH', /^\/entity-types\/[^/]+$/],
    ['DELETE', /^\/entity-types\/[^/]+$/],
    ['PATCH', /^\/items\/[^/]+$/],
    ['PATCH', /^\/items\/[^/]+\/reorder$/],
    ['GET', /^\/entity-types\/[^/]+\/fields$/],
    ['GET', /^\/fields\/[^/]+$/],
    ['PATCH', /^\/fields\/[^/]+$/],
    ['PATCH', /^\/fields\/[^/]+\/reorder$/],
    ['PUT', /^\/items\/[^/]+\/fields\/[^/]+$/],
    ['POST', /^\/uploads\/[^/]+\/complete$/],
    ['GET', /^\/storage-objects\/[^/]+\/content$/],
    ['POST', /^\/items\/[^/]+\/source-references$/],
    ['GET', /^\/items\/[^/]+\/comments$/],
    ['POST', /^\/items\/[^/]+\/comments$/],
    ['PATCH', /^\/comments\/[^/]+$/],
    ['GET', /^\/exports\/levels\/[^/]+\.csv$/],
    ['GET', /^\/exports\/project\.json$/],
  ];
  return rules.some(([allowedMethod, pattern]) => method === allowedMethod && pattern.test(suffix));
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.authenticationFailure) {
      throw new UnauthorizedException(request.authenticationFailure);
    }
    if (request.apiCredential) {
      if (
        request.params.projectId &&
        request.params.projectId !== request.apiCredential.projectId
      ) {
        throw new NotFoundException('Project not found');
      }
      if (!credentialRouteAllowed(request, request.apiCredential.projectId)) {
        throw new ForbiddenException('Bearer credentials cannot access this endpoint');
      }
    }
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    if (!request.user) throw new UnauthorizedException('Authentication required');
    return true;
  }
}
