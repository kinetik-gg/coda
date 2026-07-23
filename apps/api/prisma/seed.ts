import { randomUUID } from 'node:crypto';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Prisma, PrismaClient } from '@prisma/client';
import { argon2id, hash } from 'argon2';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { z } from 'zod';
import { seedDatabase } from './seed-database';

const seedEnvironmentSchema = z.object({
  CODA_DEMO_RESET: z.literal('true'),
  NODE_ENV: z.enum(['development', 'test']).default('development'),
  DATABASE_URL: z.string().min(1),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(8),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true'),
  SEED_ADMIN_EMAIL: z.string().email().default('demo@coda.local'),
  SEED_ADMIN_PASSWORD: z.string().min(12).max(256).default('CodaSeedOwner2026!'),
  SEED_ADMIN_DISPLAY_NAME: z.string().trim().min(1).max(120).default('Demo Owner'),
});

const prisma = new PrismaClient();

function assertLocalTarget(databaseUrl: string, storageUrl: string): void {
  const allowed = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  for (const value of [databaseUrl, storageUrl]) {
    const hostname = new URL(value).hostname;
    if (!allowed.has(hostname)) {
      throw new Error('The demo reset is restricted to loopback database and storage endpoints.');
    }
  }
}

async function createDemoPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('The Quiet Signal — Demo Source');
  pdf.setAuthor('Coda demo');
  pdf.setSubject('Original fictional material for the Coda development seed');
  pdf.setCreator('Coda');
  const regular = await pdf.embedFont(StandardFonts.Courier);
  const bold = await pdf.embedFont(StandardFonts.CourierBold);

  const pages = [
    {
      heading: 'THE QUIET SIGNAL',
      lines: [
        '',
        'An original fictional demo source',
        '',
        'A coastal radio operator follows a brief signal',
        'and discovers a message meant for the whole town.',
      ],
    },
    {
      heading: 'EXT. COASTAL RELAY — DAWN',
      lines: [
        'Wind moves through tall grass around a compact relay station.',
        'MARA arrives by bicycle and unlocks the gate.',
        'A status lamp blinks once, pauses, then blinks twice.',
      ],
    },
    {
      heading: 'INT. RELAY CONTROL ROOM — MORNING',
      lines: [
        'Mara powers the console. A thin signal rises above the static.',
        'She records the pattern and marks its direction on a paper map.',
        'The signal repeats, clearer now: three measured tones.',
      ],
    },
    {
      heading: 'EXT. LIGHTHOUSE WALKWAY — MORNING',
      lines: [
        'Mara crosses the walkway as fog pulls away from the water.',
        'JON, the lighthouse keeper, points toward an old antenna.',
        'Together they rotate it until the receiver tone becomes steady.',
      ],
    },
    {
      heading: 'INT. LIGHTHOUSE RADIO ROOM — LATER',
      lines: [
        'The decoded message appears one character at a time.',
        'It is a weather warning sent automatically by a drifting buoy.',
        'Mara relays the warning. Across town, harbor lights switch on.',
      ],
    },
  ];

  for (const [index, content] of pages.entries()) {
    const page = pdf.addPage([612, 792]);
    page.drawText(content.heading, {
      x: 72,
      y: 700,
      size: index === 0 ? 20 : 12,
      font: bold,
      color: rgb(0.08, 0.08, 0.08),
    });
    content.lines.forEach((line, lineIndex) => {
      page.drawText(line, {
        x: 72,
        y: 650 - lineIndex * 22,
        size: 11,
        font: regular,
        color: rgb(0.08, 0.08, 0.08),
      });
    });
    page.drawText(String(index + 1), {
      x: 300,
      y: 42,
      size: 9,
      font: regular,
      color: rgb(0.25, 0.25, 0.25),
    });
  }

  return pdf.save();
}

async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

async function clearBucket(client: S3Client, bucket: string): Promise<void> {
  let continuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }),
    );
    const objects = (page.Contents ?? [])
      .map((entry) => entry.Key)
      .filter((key): key is string => Boolean(key))
      .map((Key) => ({ Key }));
    if (objects.length) {
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

async function seed(): Promise<void> {
  const input = seedEnvironmentSchema.parse(process.env);
  assertLocalTarget(input.DATABASE_URL, input.S3_ENDPOINT);

  const pdf = await createDemoPdf();
  const projectId = randomUUID();
  const storageObjectId = randomUUID();
  const sourceDocumentId = randomUUID();
  const objectKey = `demo/${projectId}/source.pdf`;
  const s3 = new S3Client({
    endpoint: input.S3_ENDPOINT,
    region: input.S3_REGION,
    forcePathStyle: input.S3_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId: input.S3_ACCESS_KEY, secretAccessKey: input.S3_SECRET_KEY },
  });
  await ensureBucket(s3, input.S3_BUCKET);
  await clearBucket(s3, input.S3_BUCKET);
  await s3.send(
    new PutObjectCommand({
      Bucket: input.S3_BUCKET,
      Key: objectKey,
      Body: pdf,
      ContentType: 'application/pdf',
    }),
  );

  try {
    const passwordHash = await hash(input.SEED_ADMIN_PASSWORD, { type: argon2id });
    await prisma.$transaction(
      (tx) =>
        seedDatabase(tx, {
          projectId,
          storageObjectId,
          sourceDocumentId,
          objectKey,
          pdfLength: pdf.length,
          email: input.SEED_ADMIN_EMAIL,
          displayName: input.SEED_ADMIN_DISPLAY_NAME,
          passwordHash,
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 },
    );
  } catch (error) {
    await s3.send(new DeleteObjectCommand({ Bucket: input.S3_BUCKET, Key: objectKey }));
    throw error;
  }

  console.log('Reset the local demo instance.');
  console.log(`Sign in with ${input.SEED_ADMIN_EMAIL} and the configured demo password.`);
}

seed()
  .catch((error: unknown) => {
    console.error(`Seed failed (${error instanceof Error ? error.message : 'UnknownError'}).`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
