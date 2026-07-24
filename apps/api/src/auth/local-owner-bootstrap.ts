import { Injectable, Logger } from '@nestjs/common';
import { createToken } from '../common/crypto';
import { runtimeCapabilities } from '../config/runtime-capabilities';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

/** Local address used for the auto-provisioned desktop owner. Never receives mail. */
export const LOCAL_OWNER_EMAIL = 'owner@coda.localhost';
export const LOCAL_OWNER_DISPLAY_NAME = 'Local Owner';
const LOCAL_OWNER_PASSWORD_BYTES = 32;

/**
 * Desktop-profile counterpart to the setup-token ceremony: when the capability map selects a local
 * owner, the first boot of an uninitialized instance provisions the single local owner directly,
 * skipping the operator-facing token flow. A high-entropy password is generated and only its hash
 * is stored; the desktop shell holds the local session, so no human ever types this password.
 *
 * Under the server profile this is a no-op — the token ceremony (SetupTokenService) governs owner
 * creation, so server boot behavior is unchanged.
 */
@Injectable()
export class LocalOwnerBootstrap {
  private readonly logger = new Logger(LocalOwnerBootstrap.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async ensureLocalOwner(): Promise<void> {
    if (runtimeCapabilities().setupTokenBootstrap !== 'local-owner') return;
    if ((await this.prisma.instanceSettings.count()) > 0) return;
    await this.auth.setupOwner({
      displayName: LOCAL_OWNER_DISPLAY_NAME,
      email: LOCAL_OWNER_EMAIL,
      password: createToken(LOCAL_OWNER_PASSWORD_BYTES),
    });
    this.logger.log(
      `Initialized local single-user owner <${LOCAL_OWNER_EMAIL}> for desktop profile`,
    );
  }
}
