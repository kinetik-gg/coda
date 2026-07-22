import type { PrismaClient } from '@prisma/client';

export type BreakdownTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface FieldOptionCreateInput {
  label: string;
  color?: string | null;
}

export interface FieldOptionUpdateInput extends FieldOptionCreateInput {
  id?: string;
}
