import { z } from 'zod';

/**
 * Scalar shapes shared by every domain contract. They live in their own leaf
 * module so a domain module can depend on them without importing the barrel,
 * which would be a cycle.
 */

export const uuidSchema = z.string().uuid();
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
