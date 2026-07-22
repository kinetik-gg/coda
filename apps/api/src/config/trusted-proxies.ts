import type { INestApplication } from '@nestjs/common';

interface ExpressSettings {
  set(name: string, value: unknown): void;
}

export function configureTrustedProxies(
  app: Pick<INestApplication, 'getHttpAdapter'>,
  trustedProxyCidrs: string[],
): void {
  const instance = app.getHttpAdapter().getInstance() as ExpressSettings;
  instance.set('trust proxy', trustedProxyCidrs);
}
