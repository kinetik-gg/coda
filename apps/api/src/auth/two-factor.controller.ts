import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { activateTwoFactorSchema, disableTwoFactorSchema } from '@coda/contracts';
import type { Request } from 'express';
import { TwoFactorService } from './two-factor.service';

/**
 * Authenticated account endpoints for managing one's own TOTP two-factor:
 * enrollment, verify-to-activate, status, and disable. The login-time second
 * step lives on {@link AuthController} because it mints the session cookie.
 */
@Controller('api/v1/account/2fa')
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @Get()
  async status(@Req() request: Request) {
    return { data: await this.twoFactor.status(request.user!.id) };
  }

  @Post('enroll')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async enroll(@Req() request: Request) {
    return { data: await this.twoFactor.enroll(request.user!.id, request.user!.email) };
  }

  @Post('activate')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async activate(@Req() request: Request, @Body() body: unknown) {
    const input = activateTwoFactorSchema.parse(body);
    return { data: await this.twoFactor.activate(request.user!.id, input.code) };
  }

  @Post('disable')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async disable(@Req() request: Request, @Body() body: unknown) {
    const input = disableTwoFactorSchema.parse(body);
    return { data: await this.twoFactor.disable(request.user!.id, input.password, input.code) };
  }
}
