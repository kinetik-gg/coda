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
import { allPermissions, workspaceLayoutSchema } from '@coda/contracts';
import {
  ActivityAction,
  FieldType,
  Prisma,
  PrismaClient,
  StorageKind,
  StorageStatus,
  UserStatus,
} from '@prisma/client';
import { argon2id, hash } from 'argon2';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { z } from 'zod';

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
  SEED_ADMIN_PASSWORD: z.string().min(8).max(256).default('codademo'),
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

function workspaceLayout(entityTypeIds: string[], sourceDocumentId: string) {
  const panel = (type: 'entity_table' | 'inspector' | 'pdf', entityTypeId?: string) => ({
    kind: 'panel' as const,
    id: randomUUID(),
    panel: {
      id: randomUUID(),
      type,
      configVersion: 1,
      config:
        type === 'entity_table'
          ? {
              entityTypeId: entityTypeId ?? null,
              search: '',
              sort: 'manual',
              direction: 'asc',
              filters: [],
              hiddenColumns: [],
              visibleCustomFieldIds: [],
              columnWidths: {},
            }
          : type === 'pdf'
            ? { sourceDocumentId, page: 1, zoom: 1 }
            : { section: 'details', search: '' },
    },
  });
  return workspaceLayoutSchema.parse({
    schemaVersion: 1,
    root: {
      kind: 'split',
      id: randomUUID(),
      axis: 'horizontal',
      ratioBasisPoints: 6200,
      first: {
        kind: 'split',
        id: randomUUID(),
        axis: 'horizontal',
        ratioBasisPoints: 3300,
        first: {
          kind: 'split',
          id: randomUUID(),
          axis: 'vertical',
          ratioBasisPoints: 1700,
          first: panel('entity_table', entityTypeIds[0]),
          second: panel('entity_table', entityTypeIds[1]),
        },
        second: {
          kind: 'split',
          id: randomUUID(),
          axis: 'vertical',
          ratioBasisPoints: 4880,
          first: panel('entity_table', entityTypeIds[2]),
          second: panel('inspector'),
        },
      },
      second: panel('pdf'),
    },
    view: { zoom: 1, textScale: 1.2 },
  });
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
      async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(1122334455)`);
        await tx.instanceInvitationRedemption.deleteMany();
        await tx.instanceInvitation.deleteMany();
        await tx.passwordResetToken.deleteMany();
        await tx.session.deleteMany();
        await tx.apiCredential.deleteMany();
        await tx.instanceSettings.deleteMany();
        await tx.project.deleteMany();
        await tx.user.deleteMany();

        const user = await tx.user.create({
          data: {
            email: input.SEED_ADMIN_EMAIL.toLowerCase(),
            displayName: input.SEED_ADMIN_DISPLAY_NAME,
            passwordHash,
            status: UserStatus.ACTIVE,
          },
        });
        await tx.instanceSettings.create({ data: { ownerUserId: user.id } });
        await tx.project.create({
          data: {
            id: projectId,
            ownerUserId: user.id,
            name: 'The Quiet Signal',
            description: 'A compact fictional project for exploring Coda.',
          },
        });

        const ownerRole = await tx.projectRole.create({
          data: {
            projectId,
            name: 'owner',
            isOwner: true,
            position: 'a0',
            permissions: {
              create: allPermissions.map((permission) => ({ permission })),
            },
          },
        });
        for (const [index, role] of [
          {
            name: 'admin',
            permissions: allPermissions.filter((value) => value !== 'delete_project'),
          },
          {
            name: 'editor',
            permissions: [
              'read_project',
              'manage_items',
              'manage_source_documents',
              'manage_storage_objects',
              'comment',
            ],
          },
          { name: 'viewer', permissions: ['read_project'] },
        ].entries()) {
          await tx.projectRole.create({
            data: {
              projectId,
              name: role.name,
              position: `a${index + 1}`,
              permissions: { create: role.permissions.map((permission) => ({ permission })) },
            },
          });
        }
        const membership = await tx.projectMembership.create({
          data: { projectId, userId: user.id, roleId: ownerRole.id },
        });

        const sequenceType = await tx.entityType.create({
          data: {
            projectId,
            singularName: 'Sequence',
            pluralName: 'Sequences',
            displayPrefix: 'SEQ',
            level: 1,
            position: 'a0',
          },
        });
        const sceneType = await tx.entityType.create({
          data: {
            projectId,
            parentTypeId: sequenceType.id,
            singularName: 'Scene',
            pluralName: 'Scenes',
            displayPrefix: 'SC',
            level: 2,
            position: 'a1',
          },
        });
        const shotType = await tx.entityType.create({
          data: {
            projectId,
            parentTypeId: sceneType.id,
            singularName: 'Shot',
            pluralName: 'Shots',
            displayPrefix: 'SH',
            level: 3,
            position: 'a2',
          },
        });

        const sequenceSynopsis = await tx.fieldDefinition.create({
          data: {
            projectId,
            entityTypeId: sequenceType.id,
            name: 'Synopsis',
            key: 'synopsis',
            type: FieldType.LONG_TEXT,
            position: 'a0',
          },
        });
        const sceneLocation = await tx.fieldDefinition.create({
          data: {
            projectId,
            entityTypeId: sceneType.id,
            name: 'Location',
            key: 'location',
            type: FieldType.TEXT,
            position: 'a0',
          },
        });
        const sceneTime = await tx.fieldDefinition.create({
          data: {
            projectId,
            entityTypeId: sceneType.id,
            name: 'Time of day',
            key: 'time_of_day',
            type: FieldType.ENUM,
            position: 'a1',
            options: {
              create: [
                { label: 'Dawn', position: 'a0' },
                { label: 'Morning', position: 'a1' },
                { label: 'Later', position: 'a2' },
              ],
            },
          },
          include: { options: true },
        });
        const shotDescription = await tx.fieldDefinition.create({
          data: {
            projectId,
            entityTypeId: shotType.id,
            name: 'Description',
            key: 'description',
            type: FieldType.LONG_TEXT,
            position: 'a0',
          },
        });
        const shotSize = await tx.fieldDefinition.create({
          data: {
            projectId,
            entityTypeId: shotType.id,
            name: 'Shot size',
            key: 'shot_size',
            type: FieldType.ENUM,
            position: 'a1',
            options: {
              create: [
                { label: 'Wide', position: 'a0' },
                { label: 'Medium', position: 'a1' },
                { label: 'Close-up', position: 'a2' },
              ],
            },
          },
          include: { options: true },
        });
        const shotDuration = await tx.fieldDefinition.create({
          data: {
            projectId,
            entityTypeId: shotType.id,
            name: 'Duration',
            key: 'duration',
            type: FieldType.FLOAT,
            position: 'a2',
          },
        });

        await tx.storageObject.create({
          data: {
            id: storageObjectId,
            projectId,
            kind: StorageKind.SOURCE_DOCUMENT,
            status: StorageStatus.READY,
            objectKey,
            originalFilename: 'the-quiet-signal.pdf',
            mimeType: 'application/pdf',
            sizeBytes: BigInt(pdf.length),
          },
        });
        await tx.sourceDocument.create({
          data: {
            id: sourceDocumentId,
            projectId,
            storageObjectId,
            title: 'The Quiet Signal',
            pageCount: 5,
          },
        });

        const sequenceRows = [
          {
            code: 'SEQ01',
            title: 'Arrival',
            description: 'A radio operator finds an unusual repeating signal.',
          },
          {
            code: 'SEQ02',
            title: 'Response',
            description: 'The signal is traced and its warning is shared.',
          },
        ];
        const sceneRows = [
          {
            parent: 0,
            page: 2,
            code: 'SC01',
            title: 'Coastal Relay',
            location: 'Coastal relay',
            time: 'Dawn',
          },
          {
            parent: 0,
            page: 3,
            code: 'SC02',
            title: 'Control Room',
            location: 'Relay control room',
            time: 'Morning',
          },
          {
            parent: 1,
            page: 4,
            code: 'SC03',
            title: 'Lighthouse Walkway',
            location: 'Lighthouse walkway',
            time: 'Morning',
          },
          {
            parent: 1,
            page: 5,
            code: 'SC04',
            title: 'Radio Room',
            location: 'Lighthouse radio room',
            time: 'Later',
          },
        ];
        const shotLines = [
          [
            'Relay station in the wind.',
            'Mara arrives at the gate.',
            'A status lamp repeats a pattern.',
          ],
          [
            'The console powers on.',
            'The signal rises above static.',
            'A direction is marked on the map.',
          ],
          [
            'Fog clears from the walkway.',
            'Jon points to the old antenna.',
            'They turn it toward the signal.',
          ],
          [
            'Characters appear on the receiver.',
            'The warning is understood.',
            'Harbor lights switch on.',
          ],
        ];
        const sequences = [];
        for (const [index, row] of sequenceRows.entries()) {
          const item = await tx.breakdownItem.create({
            data: {
              projectId,
              entityTypeId: sequenceType.id,
              title: row.title,
              displayCode: row.code,
              description: row.description,
              position: `a${index}`,
            },
          });
          sequences.push(item);
          await tx.fieldValue.create({
            data: { itemId: item.id, fieldId: sequenceSynopsis.id, textValue: row.description },
          });
        }
        for (const [sceneIndex, row] of sceneRows.entries()) {
          const scene = await tx.breakdownItem.create({
            data: {
              projectId,
              entityTypeId: sceneType.id,
              parentId: sequences[row.parent]!.id,
              title: row.title,
              displayCode: row.code,
              description: `Page ${row.page} of the demo source.`,
              position: `a${sceneIndex}`,
            },
          });
          await tx.fieldValue.createMany({
            data: [
              { itemId: scene.id, fieldId: sceneLocation.id, textValue: row.location },
              {
                itemId: scene.id,
                fieldId: sceneTime.id,
                optionId: sceneTime.options.find((option) => option.label === row.time)!.id,
              },
            ],
          });
          for (const [shotIndex, description] of shotLines[sceneIndex]!.entries()) {
            const shot = await tx.breakdownItem.create({
              data: {
                projectId,
                entityTypeId: shotType.id,
                parentId: scene.id,
                title: description,
                displayCode: `${row.code}_SH${String(shotIndex + 1).padStart(2, '0')}`,
                position: `a${shotIndex}`,
              },
            });
            await tx.fieldValue.createMany({
              data: [
                { itemId: shot.id, fieldId: shotDescription.id, textValue: description },
                {
                  itemId: shot.id,
                  fieldId: shotSize.id,
                  optionId: shotSize.options[shotIndex]!.id,
                },
                { itemId: shot.id, fieldId: shotDuration.id, floatValue: 3 + shotIndex },
              ],
            });
            await tx.itemSourceReference.create({
              data: {
                itemId: shot.id,
                sourceDocumentId,
                startPage: row.page,
                endPage: row.page,
                position: 'a0',
              },
            });
          }
        }

        const layout = workspaceLayout(
          [sequenceType.id, sceneType.id, shotType.id],
          sourceDocumentId,
        ) as unknown as Prisma.InputJsonValue;
        await tx.projectWorkspaceDefault.create({
          data: {
            projectId,
            layout,
            schemaVersion: 1,
            publishedById: user.id,
            publishedAt: new Date(),
          },
        });
        await tx.projectMembershipWorkspaceLayout.create({
          data: {
            membershipId: membership.id,
            layout,
            schemaVersion: 1,
            basedOnDefaultRevision: 0,
          },
        });
        await tx.activityEvent.create({
          data: {
            projectId,
            actorId: user.id,
            action: ActivityAction.CREATED,
            resourceType: 'project',
            resourceId: projectId,
          },
        });
      },
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
