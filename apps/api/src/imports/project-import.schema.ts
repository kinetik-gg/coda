import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { z } from 'zod';

export const MAX_PROJECT_IMPORT_BYTES = 25 * 1024 * 1024;

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable();
const fieldType = z.enum([
  'TEXT',
  'LONG_TEXT',
  'ENUM',
  'MULTI_ENUM',
  'INTEGER',
  'FLOAT',
  'BOOLEAN',
  'DATE',
  'FILE',
  'IMAGE',
  'VIDEO',
]);

const optionSchema = z
  .object({
    id: uuid,
    label: z.string().trim().min(1).max(120),
    color: z.string().max(32).nullable(),
    position: z.string().min(1).max(64),
  })
  .strict();

const fieldSchema = z
  .object({
    id: uuid,
    entityTypeId: uuid,
    name: z.string().trim().min(1).max(120),
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,63}$/),
    type: fieldType,
    required: z.boolean(),
    position: z.string().min(1).max(64),
    configuration: z.record(z.string(), z.unknown()),
    version: z.number().int().positive(),
    options: z.array(optionSchema).max(10_000),
  })
  .strict();

const valueSchema = z
  .object({
    id: uuid,
    fieldId: uuid,
    textValue: z.string().nullable(),
    integerValue: z.number().int().min(-2_147_483_648).max(2_147_483_647).nullable(),
    floatValue: z.number().finite().nullable(),
    booleanValue: z.boolean().nullable(),
    dateValue: z.string().datetime().nullable(),
    optionId: nullableUuid,
    storageObjectId: nullableUuid,
    optionIds: z.array(uuid).max(100),
  })
  .strict();

const sourceReferenceSchema = z
  .object({
    id: uuid,
    sourceDocumentId: uuid,
    startPage: z.number().int().positive(),
    endPage: z.number().int().positive(),
    position: z.string().min(1).max(64),
  })
  .strict();

const itemSchema = z
  .object({
    id: uuid,
    entityTypeId: uuid,
    parentId: nullableUuid,
    title: z.string().trim().min(1).max(300),
    displayCode: z.string().trim().max(80).nullable(),
    description: z.string().max(20_000).nullable(),
    position: z.string().min(1).max(64),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    values: z.array(valueSchema).max(10_000),
    sourceReferences: z.array(sourceReferenceSchema).max(10_000),
  })
  .strict();

const entityTypeSchema = z
  .object({
    id: uuid,
    parentTypeId: nullableUuid,
    singularName: z.string().trim().min(1).max(80),
    pluralName: z.string().trim().min(1).max(80),
    displayPrefix: z.string().trim().max(20).nullable(),
    level: z.number().int().min(1).max(3),
    position: z.string().min(1).max(64),
    enabled: z.boolean(),
    version: z.number().int().positive(),
  })
  .strict();

export const projectImportDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    exportedAt: z.string().datetime(),
    project: z
      .object({
        id: uuid,
        name: z.string().trim().min(1).max(160),
        description: z.string().max(4000).nullable(),
        version: z.number().int().positive(),
        revision: z.number().int().positive(),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
        roles: z.array(z.unknown()).max(100),
        entityTypes: z.array(entityTypeSchema).min(1).max(3),
        fields: z.array(fieldSchema).max(5000),
        items: z.array(itemSchema).max(250_000),
        sourceDocuments: z.array(z.unknown()).max(10_000),
        storageObjects: z.array(z.unknown()).max(100_000),
      })
      .strict(),
  })
  .strict();

export type ProjectImportDocument = z.infer<typeof projectImportDocumentSchema>;
type ImportProject = ProjectImportDocument['project'];
type ImportEntityType = ImportProject['entityTypes'][number];
type ImportField = ImportProject['fields'][number];
type ImportValue = ImportProject['items'][number]['values'][number];

function duplicate(values: string[]): string | undefined {
  const seen = new Set<string>();
  return values.find((value) => (seen.has(value) ? true : (seen.add(value), false)));
}

export function parseProjectImport(raw: string): ProjectImportDocument {
  if (Buffer.byteLength(raw, 'utf8') > MAX_PROJECT_IMPORT_BYTES) {
    throw new PayloadTooLargeException('Project import exceeds the 25 MB limit');
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw) as unknown;
  } catch {
    throw new BadRequestException('Project import is not valid JSON');
  }
  const parsed = projectImportDocumentSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? issue.path.join('.') : 'document';
    throw new BadRequestException(
      `Invalid project import at ${path}: ${issue?.message ?? 'invalid value'}`,
    );
  }
  validateProjectImportReferences(parsed.data);
  return parsed.data;
}

function validateUniqueObjectIds(project: ImportProject): void {
  const { entityTypes, fields, items } = project;
  const duplicateEntity = duplicate(entityTypes.map((entry) => entry.id));
  const duplicateField = duplicate(fields.map((entry) => entry.id));
  const duplicateItem = duplicate(items.map((entry) => entry.id));
  if (duplicateEntity || duplicateField || duplicateItem) {
    throw new BadRequestException('Project import contains duplicate object identifiers');
  }
}

function validateEntityTypeChain(entityTypes: ImportEntityType[]): Map<string, ImportEntityType> {
  const orderedTypes = [...entityTypes].sort((left, right) => left.level - right.level);
  if (orderedTypes.some((entry, index) => entry.level !== index + 1)) {
    throw new BadRequestException(
      'Entity levels must form one continuous one-to-three-level chain',
    );
  }
  for (const [index, entityType] of orderedTypes.entries()) {
    const expectedParent = index === 0 ? null : orderedTypes[index - 1]!.id;
    if (entityType.parentTypeId !== expectedParent) {
      throw new BadRequestException('Entity type parents must follow the imported level chain');
    }
  }
  return new Map(entityTypes.map((entry) => [entry.id, entry]));
}

function validateFields(
  fields: ImportField[],
  typeById: Map<string, ImportEntityType>,
): { fieldById: Map<string, ImportField>; optionToField: Map<string, string> } {
  const fieldById = new Map(fields.map((entry) => [entry.id, entry]));
  const optionToField = new Map<string, string>();
  for (const field of fields) {
    if (!typeById.has(field.entityTypeId)) {
      throw new BadRequestException(`Field ${field.key} references an unknown entity type`);
    }
    if (duplicate(field.options.map((option) => option.id))) {
      throw new BadRequestException(`Field ${field.key} contains duplicate option identifiers`);
    }
    for (const option of field.options) {
      if (optionToField.has(option.id)) {
        throw new BadRequestException('Project import contains duplicate option identifiers');
      }
      optionToField.set(option.id, field.id);
    }
  }
  return { fieldById, optionToField };
}

type PopulatedValueSlots = Record<
  'text' | 'integer' | 'float' | 'boolean' | 'date' | 'option' | 'options' | 'storage',
  boolean
>;

function populatedSlots(value: ImportValue): PopulatedValueSlots {
  return {
    text: value.textValue !== null,
    integer: value.integerValue !== null,
    float: value.floatValue !== null,
    boolean: value.booleanValue !== null,
    date: value.dateValue !== null,
    option: value.optionId !== null,
    options: value.optionIds.length > 0,
    storage: value.storageObjectId !== null,
  };
}

function onlySlot(populated: PopulatedValueSlots, slot: keyof PopulatedValueSlots): boolean {
  return Object.entries(populated).every(([key, value]) => (key === slot ? value : !value));
}

function valueMatchesField(value: ImportValue, field: ImportField): boolean {
  const populated = populatedSlots(value);
  switch (field.type) {
    case 'TEXT':
    case 'LONG_TEXT':
      return onlySlot(populated, 'text');
    case 'INTEGER':
      return onlySlot(populated, 'integer');
    case 'FLOAT':
      return onlySlot(populated, 'float');
    case 'BOOLEAN':
      return onlySlot(populated, 'boolean');
    case 'DATE':
      return onlySlot(populated, 'date');
    case 'ENUM':
      return onlySlot(populated, 'option');
    case 'MULTI_ENUM':
      return Object.entries(populated).every(
        ([key, populatedValue]) => key === 'options' || !populatedValue,
      );
    case 'FILE':
    case 'IMAGE':
    case 'VIDEO':
      return onlySlot(populated, 'storage');
  }
}

function validateItemValue(
  itemId: string,
  itemEntityTypeId: string,
  value: ImportValue,
  fieldById: Map<string, ImportField>,
  optionToField: Map<string, string>,
): void {
  const field = fieldById.get(value.fieldId);
  if (!field || field.entityTypeId !== itemEntityTypeId) {
    throw new BadRequestException(`Item ${itemId} contains a value for an unrelated field`);
  }
  if (value.optionId && optionToField.get(value.optionId) !== field.id) {
    throw new BadRequestException(`Item ${itemId} references an invalid enum option`);
  }
  if (value.optionIds.some((optionId) => optionToField.get(optionId) !== field.id)) {
    throw new BadRequestException(`Item ${itemId} references an invalid multi-enum option`);
  }
  if (!valueMatchesField(value, field)) {
    throw new BadRequestException(
      `Item ${itemId} contains a value that does not match field ${field.key}`,
    );
  }
}

function validateItems(
  project: ImportProject,
  typeById: Map<string, ImportEntityType>,
  fieldById: Map<string, ImportField>,
  optionToField: Map<string, string>,
): void {
  const itemById = new Map(project.items.map((entry) => [entry.id, entry]));

  for (const item of project.items) {
    const type = typeById.get(item.entityTypeId);
    if (!type) throw new BadRequestException(`Item ${item.id} references an unknown entity type`);
    if (type.level === 1 && item.parentId !== null) {
      throw new BadRequestException('Level-one items cannot have parents');
    }
    if (type.level > 1) {
      const parent = item.parentId ? itemById.get(item.parentId) : undefined;
      if (!parent || parent.entityTypeId !== type.parentTypeId) {
        throw new BadRequestException(`Item ${item.id} does not reference a valid parent item`);
      }
    }
    if (duplicate(item.values.map((value) => value.fieldId))) {
      throw new BadRequestException(`Item ${item.id} contains duplicate field values`);
    }
    for (const value of item.values) {
      validateItemValue(item.id, item.entityTypeId, value, fieldById, optionToField);
    }
  }
}

export function validateProjectImportReferences(document: ProjectImportDocument): void {
  validateUniqueObjectIds(document.project);
  const typeById = validateEntityTypeChain(document.project.entityTypes);
  const { fieldById, optionToField } = validateFields(document.project.fields, typeById);
  validateItems(document.project, typeById, fieldById, optionToField);
}
