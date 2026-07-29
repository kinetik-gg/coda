import { z } from 'zod';

const encodedRelativePositionSchema = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, {
    message: 'Anchor must be base64-encoded Yjs relative-position bytes',
  });

const screenplayCommentBodySchema = z.string().trim().min(1).max(10_000);

export const screenplayCommentThreadStatusSchema = z.enum(['OPEN', 'RESOLVED']);
export type ScreenplayCommentThreadStatus = z.infer<typeof screenplayCommentThreadStatusSchema>;

export const listScreenplayCommentThreadsQuerySchema = z
  .object({
    status: z.enum(['open', 'resolved', 'all']).default('open'),
  })
  .strict();
export type ListScreenplayCommentThreadsQuery = z.infer<
  typeof listScreenplayCommentThreadsQuerySchema
>;

export const createScreenplayCommentThreadSchema = z
  .object({
    anchorStart: encodedRelativePositionSchema,
    anchorEnd: encodedRelativePositionSchema,
    quotedText: z.string().max(512),
    body: screenplayCommentBodySchema,
  })
  .strict();
export type CreateScreenplayCommentThread = z.infer<typeof createScreenplayCommentThreadSchema>;

export const createScreenplayCommentSchema = z
  .object({ body: screenplayCommentBodySchema })
  .strict();
export type CreateScreenplayComment = z.infer<typeof createScreenplayCommentSchema>;

export const updateScreenplayCommentSchema = createScreenplayCommentSchema;
export type UpdateScreenplayComment = z.infer<typeof updateScreenplayCommentSchema>;

export const resolveScreenplayCommentThreadSchema = z.object({ resolved: z.boolean() }).strict();
export type ResolveScreenplayCommentThread = z.infer<typeof resolveScreenplayCommentThreadSchema>;

export interface ScreenplayCommentAuthor {
  id: string;
  displayName: string;
}

export interface ScreenplayCommentView {
  id: string;
  threadId: string;
  authorUserId: string;
  author: ScreenplayCommentAuthor;
  body: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface ScreenplayCommentThreadView {
  id: string;
  screenplayId: string;
  authorUserId: string;
  author: ScreenplayCommentAuthor;
  anchorStart: string;
  anchorEnd: string;
  quotedText: string;
  status: ScreenplayCommentThreadStatus;
  resolvedAt: string | null;
  resolvedById: string | null;
  createdAt: string;
  updatedAt: string;
  comments: ScreenplayCommentView[];
}
