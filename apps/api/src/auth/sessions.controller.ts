import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { signOutEverywhereSchema } from '@coda/contracts';
import type { Request } from 'express';
import { SessionsService } from './sessions.service';

@Controller('api/v1/account/sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  async list(@Req() request: Request) {
    return { data: await this.sessions.list(request.user!.id, request.sessionId) };
  }

  @Delete(':sessionId')
  async revoke(@Req() request: Request, @Param('sessionId') sessionId: string) {
    return { data: await this.sessions.revoke(request.user!.id, sessionId) };
  }

  @Post('sign-out-everywhere')
  async signOutEverywhere(@Req() request: Request, @Body() body: unknown) {
    const input = signOutEverywhereSchema.parse(body ?? {});
    return {
      data: await this.sessions.signOutEverywhere(
        request.user!.id,
        request.sessionId,
        input.keepCurrent ?? true,
      ),
    };
  }
}
