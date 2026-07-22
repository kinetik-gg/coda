import { randomUUID } from 'node:crypto';
import { allPermissions, workspaceLayoutSchema } from '@coda/contracts';
import {
  ActivityAction,
  FieldType,
  Prisma,
  StorageKind,
  StorageStatus,
  UserStatus,
} from '@prisma/client';

type Transaction = Prisma.TransactionClient;

export interface SeedDatabaseInput {
  projectId: string;
  storageObjectId: string;
  sourceDocumentId: string;
  objectKey: string;
  pdfLength: number;
  email: string;
  displayName: string;
  passwordHash: string;
}

interface SeedHierarchy {
  entityTypeIds: [string, string, string];
  sequenceSynopsisId: string;
  sceneLocationId: string;
  sceneTime: { id: string; options: Array<{ id: string; label: string }> };
  shotDescriptionId: string;
  shotSize: { id: string; options: Array<{ id: string }> };
  shotDurationId: string;
}

async function clearInstance(tx: Transaction): Promise<void> {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(1122334455)`);
  await tx.instanceInvitationRedemption.deleteMany();
  await tx.instanceInvitation.deleteMany();
  await tx.passwordResetToken.deleteMany();
  await tx.session.deleteMany();
  await tx.apiCredential.deleteMany();
  await tx.instanceSettings.deleteMany();
  await tx.project.deleteMany();
  await tx.screenplay.deleteMany();
  await tx.user.deleteMany();
}

async function createRoles(tx: Transaction, projectId: string) {
  const ownerRole = await tx.projectRole.create({
    data: {
      projectId,
      name: 'owner',
      isOwner: true,
      position: 'a0',
      permissions: { create: allPermissions.map((permission) => ({ permission })) },
    },
  });
  const roles = [
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
  ];
  for (const [index, role] of roles.entries()) {
    await tx.projectRole.create({
      data: {
        projectId,
        name: role.name,
        position: `a${index + 1}`,
        permissions: { create: role.permissions.map((permission) => ({ permission })) },
      },
    });
  }
  return ownerRole;
}

async function createAccountAndProject(tx: Transaction, input: SeedDatabaseInput) {
  const user = await tx.user.create({
    data: {
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      status: UserStatus.ACTIVE,
    },
  });
  await tx.instanceSettings.create({ data: { ownerUserId: user.id } });
  await tx.project.create({
    data: {
      id: input.projectId,
      ownerUserId: user.id,
      name: 'The Quiet Signal',
      description: 'A compact fictional project for exploring Coda.',
    },
  });
  const ownerRole = await createRoles(tx, input.projectId);
  const membership = await tx.projectMembership.create({
    data: { projectId: input.projectId, userId: user.id, roleId: ownerRole.id },
  });
  return { user, membership };
}

async function createEntityTypes(tx: Transaction, projectId: string) {
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
  return { sequenceType, sceneType, shotType };
}

async function createFields(tx: Transaction, projectId: string): Promise<SeedHierarchy> {
  const { sequenceType, sceneType, shotType } = await createEntityTypes(tx, projectId);
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
  return {
    entityTypeIds: [sequenceType.id, sceneType.id, shotType.id],
    sequenceSynopsisId: sequenceSynopsis.id,
    sceneLocationId: sceneLocation.id,
    sceneTime,
    shotDescriptionId: shotDescription.id,
    shotSize,
    shotDurationId: shotDuration.id,
  };
}

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
  ['Relay station in the wind.', 'Mara arrives at the gate.', 'A status lamp repeats a pattern.'],
  ['The console powers on.', 'The signal rises above static.', 'A direction is marked on the map.'],
  [
    'Fog clears from the walkway.',
    'Jon points to the old antenna.',
    'They turn it toward the signal.',
  ],
  ['Characters appear on the receiver.', 'The warning is understood.', 'Harbor lights switch on.'],
];

async function createSequences(tx: Transaction, projectId: string, hierarchy: SeedHierarchy) {
  const sequences = [];
  for (const [index, row] of sequenceRows.entries()) {
    const item = await tx.breakdownItem.create({
      data: {
        projectId,
        entityTypeId: hierarchy.entityTypeIds[0],
        title: row.title,
        displayCode: row.code,
        description: row.description,
        position: `a${index}`,
      },
    });
    sequences.push(item);
    await tx.fieldValue.create({
      data: { itemId: item.id, fieldId: hierarchy.sequenceSynopsisId, textValue: row.description },
    });
  }
  return sequences;
}

async function createShots(
  tx: Transaction,
  input: SeedDatabaseInput,
  hierarchy: SeedHierarchy,
  scene: { id: string },
  sceneIndex: number,
): Promise<void> {
  const sceneRow = sceneRows[sceneIndex]!;
  for (const [shotIndex, description] of shotLines[sceneIndex]!.entries()) {
    const shot = await tx.breakdownItem.create({
      data: {
        projectId: input.projectId,
        entityTypeId: hierarchy.entityTypeIds[2],
        parentId: scene.id,
        title: description,
        displayCode: `${sceneRow.code}_SH${String(shotIndex + 1).padStart(2, '0')}`,
        position: `a${shotIndex}`,
      },
    });
    await tx.fieldValue.createMany({
      data: [
        { itemId: shot.id, fieldId: hierarchy.shotDescriptionId, textValue: description },
        {
          itemId: shot.id,
          fieldId: hierarchy.shotSize.id,
          optionId: hierarchy.shotSize.options[shotIndex]!.id,
        },
        { itemId: shot.id, fieldId: hierarchy.shotDurationId, floatValue: 3 + shotIndex },
      ],
    });
    await tx.itemSourceReference.create({
      data: {
        itemId: shot.id,
        sourceDocumentId: input.sourceDocumentId,
        startPage: sceneRow.page,
        endPage: sceneRow.page,
        position: 'a0',
      },
    });
  }
}

async function createItems(
  tx: Transaction,
  input: SeedDatabaseInput,
  hierarchy: SeedHierarchy,
): Promise<void> {
  const sequences = await createSequences(tx, input.projectId, hierarchy);
  for (const [sceneIndex, row] of sceneRows.entries()) {
    const scene = await tx.breakdownItem.create({
      data: {
        projectId: input.projectId,
        entityTypeId: hierarchy.entityTypeIds[1],
        parentId: sequences[row.parent]!.id,
        title: row.title,
        displayCode: row.code,
        description: `Page ${row.page} of the demo source.`,
        position: `a${sceneIndex}`,
      },
    });
    await tx.fieldValue.createMany({
      data: [
        { itemId: scene.id, fieldId: hierarchy.sceneLocationId, textValue: row.location },
        {
          itemId: scene.id,
          fieldId: hierarchy.sceneTime.id,
          optionId: hierarchy.sceneTime.options.find((option) => option.label === row.time)!.id,
        },
      ],
    });
    await createShots(tx, input, hierarchy, scene, sceneIndex);
  }
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

async function createSourceDocument(tx: Transaction, input: SeedDatabaseInput): Promise<void> {
  await tx.storageObject.create({
    data: {
      id: input.storageObjectId,
      projectId: input.projectId,
      kind: StorageKind.SOURCE_DOCUMENT,
      status: StorageStatus.READY,
      objectKey: input.objectKey,
      originalFilename: 'the-quiet-signal.pdf',
      mimeType: 'application/pdf',
      sizeBytes: BigInt(input.pdfLength),
    },
  });
  await tx.sourceDocument.create({
    data: {
      id: input.sourceDocumentId,
      projectId: input.projectId,
      storageObjectId: input.storageObjectId,
      title: 'The Quiet Signal',
      pageCount: 5,
    },
  });
}

async function createWorkspace(
  tx: Transaction,
  input: SeedDatabaseInput,
  entityTypeIds: string[],
  userId: string,
  membershipId: string,
): Promise<void> {
  const layout = workspaceLayout(entityTypeIds, input.sourceDocumentId) as Prisma.InputJsonValue;
  await tx.projectWorkspaceDefault.create({
    data: {
      projectId: input.projectId,
      layout,
      schemaVersion: 1,
      publishedById: userId,
      publishedAt: new Date(),
    },
  });
  await tx.projectMembershipWorkspaceLayout.create({
    data: { membershipId, layout, schemaVersion: 1, basedOnDefaultRevision: 0 },
  });
  await tx.activityEvent.create({
    data: {
      projectId: input.projectId,
      actorId: userId,
      action: ActivityAction.CREATED,
      resourceType: 'project',
      resourceId: input.projectId,
    },
  });
}

export async function seedDatabase(tx: Transaction, input: SeedDatabaseInput): Promise<void> {
  await clearInstance(tx);
  const { user, membership } = await createAccountAndProject(tx, input);
  const hierarchy = await createFields(tx, input.projectId);
  await createSourceDocument(tx, input);
  await createItems(tx, input, hierarchy);
  await createWorkspace(tx, input, hierarchy.entityTypeIds, user.id, membership.id);
}
