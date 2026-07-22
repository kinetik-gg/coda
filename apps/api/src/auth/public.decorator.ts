import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ROUTE = 'coda:public';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
