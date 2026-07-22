import { describe, expect, it } from 'vitest';
import {
  createBulkInstanceInvitationSchema,
  createInstanceInvitationSchema,
  createFieldDefinitionSchema,
  createApiCredentialSchema,
  createRoleSchema,
  createScreenplaySchema,
  createSourceReferenceSchema,
  fieldValueInputSchema,
  listItemsQuerySchema,
  setupOwnerSchema,
  itemFilterSchema,
  updateAccountProfileSchema,
  updateAccountPreferencesSchema,
  updateFieldDefinitionSchema,
  importScreenplaySchema,
  updateScreenplaySchema,
} from './index';

describe('contracts', () => {
  it('validates screenplay creation, updates, and Fountain imports', () => {
    expect(createScreenplaySchema.parse({ title: '  The Last Light  ' })).toEqual({
      title: 'The Last Light',
    });
    expect(updateScreenplaySchema.parse({ sourceText: '', version: 1 })).toEqual({
      sourceText: '',
      version: 1,
    });
    expect(() => updateScreenplaySchema.parse({ version: 1 })).toThrow(
      'At least one screenplay field is required',
    );
    expect(
      importScreenplaySchema.parse({
        filename: 'script.FOUNTAIN',
        sourceText: 'Title: Script\n',
      }),
    ).toEqual({ filename: 'script.FOUNTAIN', sourceText: 'Title: Script\n' });
    expect(() =>
      importScreenplaySchema.parse({ filename: 'script.pdf', sourceText: 'not a PDF' }),
    ).toThrow('Filename must use');
  });

  it('normalizes owner email addresses', () => {
    const result = setupOwnerSchema.parse({
      displayName: 'Owner',
      email: ' OWNER@Example.COM ',
      password: 'a-secure-password',
    });
    expect(result.email).toBe('owner@example.com');
  });

  it('defaults instance invitations to never expire', () => {
    expect(createInstanceInvitationSchema.parse({ email: 'CLIENT@Example.COM' })).toEqual({
      email: 'client@example.com',
      expiresIn: 'never',
    });
  });

  it('requires project and role together for automatic membership assignment', () => {
    expect(() =>
      createInstanceInvitationSchema.parse({
        email: 'client@example.com',
        projectId: crypto.randomUUID(),
      }),
    ).toThrow();
    expect(() =>
      createInstanceInvitationSchema.parse({
        email: 'client@example.com',
        roleId: crypto.randomUUID(),
      }),
    ).toThrow();
  });

  it('requires bulk invitations to expire', () => {
    expect(createBulkInstanceInvitationSchema.parse({ expiresIn: '7_days' })).toEqual({
      expiresIn: '7_days',
    });
    expect(() => createBulkInstanceInvitationSchema.parse({ expiresIn: 'never' })).toThrow();
    expect(() =>
      createBulkInstanceInvitationSchema.parse({
        expiresIn: '24_hours',
        projectId: crypto.randomUUID(),
      }),
    ).toThrow();
    expect(() =>
      createBulkInstanceInvitationSchema.parse({
        expiresIn: '24_hours',
        roleId: crypto.randomUUID(),
      }),
    ).toThrow();
  });

  it('requires at least one account profile change', () => {
    expect(() => updateAccountProfileSchema.parse({})).toThrow();
    expect(updateAccountProfileSchema.parse({ company: null })).toEqual({ company: null });
  });

  it('rejects duplicate API credential permissions', () => {
    expect(() =>
      createApiCredentialSchema.parse({
        projectId: crypto.randomUUID(),
        name: 'Automation',
        kind: 'api_key',
        permissions: ['read_project', 'read_project'],
      }),
    ).toThrow();
  });

  it('accepts only supported account preferences', () => {
    expect(
      updateAccountPreferencesSchema.parse({
        theme: 'nord',
        fontSize: 'large',
        motion: 'reduced',
        pdfAppearance: 'dark',
      }),
    ).toEqual({
      theme: 'nord',
      fontSize: 'large',
      motion: 'reduced',
      pdfAppearance: 'dark',
    });
    expect(() =>
      updateAccountPreferencesSchema.parse({
        theme: 'unknown',
        fontSize: 'giant',
        motion: 'reduced',
        pdfAppearance: 'dark',
      }),
    ).toThrow();
  });

  it('rejects inverted source page ranges', () => {
    expect(() =>
      createSourceReferenceSchema.parse({
        sourceDocumentId: crypto.randomUUID(),
        startPage: 4,
        endPage: 2,
      }),
    ).toThrow();
  });

  it('rejects unsafe integer field values', () => {
    expect(() =>
      fieldValueInputSchema.parse({ type: 'integer', value: Number.MAX_SAFE_INTEGER }),
    ).toThrow();
  });

  it('rejects duplicate permissions in a project role', () => {
    expect(() =>
      createRoleSchema.parse({
        name: 'Duplicate role',
        permissions: ['read_project', 'read_project'],
      }),
    ).toThrow();
  });

  it('parses typed field filters from an HTTP query string', () => {
    const fieldId = crypto.randomUUID();
    const result = listItemsQuerySchema.parse({
      entityTypeId: crypto.randomUUID(),
      filters: JSON.stringify([{ fieldId, operator: 'greater_than', value: 12 }]),
    });
    expect(result.filters).toEqual([{ fieldId, operator: 'greater_than', value: 12 }]);
  });

  it('rejects malformed field filter JSON', () => {
    expect(() =>
      listItemsQuerySchema.parse({
        entityTypeId: crypto.randomUUID(),
        filters: '{broken',
      }),
    ).toThrow();
  });

  it('accepts every supported custom field type', () => {
    const entityTypeId = crypto.randomUUID();
    const types = [
      'text',
      'long_text',
      'enum',
      'multi_enum',
      'integer',
      'float',
      'boolean',
      'date',
      'file',
      'image',
      'video',
    ] as const;

    for (const type of types) {
      expect(
        createFieldDefinitionSchema.parse({
          entityTypeId,
          name: `Field ${type}`,
          key: `field_${type}`,
          type,
          ...(type === 'enum' || type === 'multi_enum'
            ? { options: [{ label: 'Ready', color: '#33cc66' }] }
            : {}),
        }).type,
      ).toBe(type);
    }
  });

  it('rejects options on field types that cannot use them', () => {
    expect(() =>
      createFieldDefinitionSchema.parse({
        entityTypeId: crypto.randomUUID(),
        name: 'Heading',
        key: 'heading',
        type: 'text',
        options: [{ label: 'Invalid' }],
      }),
    ).toThrow('Options are only supported');
  });

  it('rejects duplicate field option labels and multi-enum values', () => {
    expect(() =>
      createFieldDefinitionSchema.parse({
        entityTypeId: crypto.randomUUID(),
        name: 'Status',
        key: 'status',
        type: 'enum',
        options: [{ label: 'Ready' }, { label: 'ready' }],
      }),
    ).toThrow('Option labels must be unique');

    const optionId = crypto.randomUUID();
    expect(() =>
      fieldValueInputSchema.parse({
        type: 'multi_enum',
        optionIds: [optionId, optionId],
      }),
    ).toThrow('Option IDs must be unique');
  });

  it('requires filter values only for operators that consume them', () => {
    const fieldId = crypto.randomUUID();
    expect(itemFilterSchema.parse({ fieldId, operator: 'is_empty' })).toEqual({
      fieldId,
      operator: 'is_empty',
    });
    expect(() => itemFilterSchema.parse({ fieldId, operator: 'equals' })).toThrow(
      'A value is required',
    );
    expect(
      listItemsQuerySchema.parse({ entityTypeId: crypto.randomUUID(), filters: undefined }).filters,
    ).toEqual([]);
    expect(
      listItemsQuerySchema.parse({ entityTypeId: crypto.randomUUID(), filters: [] }).filters,
    ).toEqual([]);
  });

  it('allows field updates to preserve option identity and ordering', () => {
    const optionId = crypto.randomUUID();
    const update = updateFieldDefinitionSchema.parse({
      name: 'Status',
      required: true,
      configuration: { display: 'badge' },
      options: [
        { id: optionId, label: 'In progress', color: '#ffaa00' },
        { label: 'Approved', color: null },
      ],
      version: 4,
    });

    expect(update.options?.[0]?.id).toBe(optionId);
    expect(update.version).toBe(4);
  });
});
