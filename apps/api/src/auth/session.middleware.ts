import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { hashToken } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ApiCredentialsService } from './api-credentials.service';
import { RequestAuthContext, type CredentialAudience } from './request-auth-context';

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: ApiCredentialsService,
    private readonly authContext: RequestAuthContext,
  ) {}

  async use(request: Request, _response: Response, next: NextFunction): Promise<void> {
    const authorization = request.get('authorization');
    if (authorization) {
      const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization);
      const audience = request.get('x-coda-token-audience') ?? 'api';
      const expectedKind: CredentialAudience | undefined =
        audience === 'api' ? 'API_KEY' : audience === 'mcp' ? 'MCP_TOKEN' : undefined;
      if (match?.[1] && expectedKind) {
        try {
          const authenticated = await this.credentials.authenticate(match[1], expectedKind);
          request.user = authenticated.user;
          request.apiCredential = authenticated.credential;
          request.authenticationType = 'credential';
        } catch {
          request.authenticationFailure = 'Bearer credential is invalid';
        }
      } else {
        request.authenticationFailure = 'Bearer credential is invalid';
      }
      this.authContext.run({ credential: request.apiCredential }, next);
      return;
    }

    const token = request.cookies?.[env().SESSION_COOKIE_NAME] as string | undefined;
    if (token) {
      const session = await this.prisma.session.findUnique({
        where: { tokenHash: hashToken(token) },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              displayName: true,
              company: true,
              department: true,
              theme: true,
              fontSize: true,
              motionPreference: true,
              pdfAppearance: true,
              status: true,
            },
          },
        },
      });
      if (session && session.expiresAt > new Date() && session.user.status === 'ACTIVE') {
        request.user = session.user;
        request.sessionId = session.id;
        request.authenticationType = 'session';
      }
    }
    this.authContext.run({}, next);
  }
}
