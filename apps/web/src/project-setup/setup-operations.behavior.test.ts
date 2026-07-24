import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, uploadFile } from '../api';
import {
  addProjectMember,
  configureEntityTypes,
  publishProjectWorkspace,
  uploadProjectSource,
} from './setup-operations';

vi.mock('../api', () => ({ api: vi.fn(), uploadFile: vi.fn() }));

const detail = {
  id: 'project',
  name: 'Feature Film',
  description: null,
  version: 1,
  entityTypes: [
    {
      id: '10000000-0000-4000-8000-000000000001',
      singularName: 'Old scene',
      pluralName: 'Old scenes',
      level: 1,
      version: 2,
    },
  ],
  roles: [
    { id: 'owner', name: 'owner', isOwner: true },
    { id: 'editor', name: 'editor', isOwner: false },
  ],
  memberships: [],
  sourceDocuments: [],
};

beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(uploadFile).mockReset();
});

describe('project setup operations', () => {
  it('updates existing hierarchy levels and creates missing levels with progress', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        ...detail,
        entityTypes: [{ ...detail.entityTypes[0]!, singularName: 'Scene', pluralName: 'Scenes' }],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ ...detail, entityTypes: [] });
    const progress = vi.fn();
    await configureEntityTypes({
      projectId: 'project',
      levelCount: 2,
      levels: [
        { singular: ' Scene ', plural: ' Scenes ' },
        { singular: 'Shot', plural: 'Shots' },
        { singular: 'Element', plural: 'Elements' },
      ],
      onProgress: progress,
    });

    expect(progress).toHaveBeenCalledWith('Configuring entity structure…');
    expect(api).toHaveBeenCalledWith(
      '/api/v1/projects/project/entity-types/10000000-0000-4000-8000-000000000001',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(api).toHaveBeenCalledWith(
      '/api/v1/projects/project/entity-types',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('saves and publishes the generated workspace recipe at current revisions', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({ personal: { revision: 4 }, default: { revision: 2 } })
      .mockResolvedValueOnce({ revision: 5 })
      .mockResolvedValueOnce({});
    await publishProjectWorkspace({ projectId: 'project', detail, onProgress: vi.fn() });
    expect(api).toHaveBeenNthCalledWith(
      3,
      '/api/v1/projects/project/workspace-layout/publish',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"personalRevision":5') as string,
      }),
    );
  });

  it('resumes source upload checkpoints without repeating completed work', async () => {
    const file = new File(['pdf bytes'], 'script.pdf', { type: 'application/pdf' });
    const pending = { current: {} };
    vi.mocked(api)
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce({
        id: 'upload',
        version: 1,
        uploadUrl: 'https://objects.test/upload',
        directUpload: true,
      })
      .mockResolvedValueOnce({ completed: true })
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce({ id: 'document' });
    await uploadProjectSource({
      projectId: 'project',
      sourceFile: file,
      pending,
      onProgress: vi.fn(),
    });
    expect(uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ uploadUrl: 'https://objects.test/upload' }),
      file,
    );
    expect(api).toHaveBeenCalledWith(
      '/api/v1/projects/project/source-documents',
      expect.objectContaining({ body: expect.stringContaining('"title":"script"') as string }),
    );

    vi.clearAllMocks();
    vi.mocked(api).mockResolvedValueOnce({ ...detail, sourceDocuments: [{ id: 'existing' }] });
    await uploadProjectSource({
      projectId: 'project',
      sourceFile: file,
      pending,
      onProgress: vi.fn(),
    });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('skips absent or existing members and rejects missing roles', async () => {
    await addProjectMember({
      projectId: 'project',
      selectedUserId: '',
      selectedRoleName: 'editor',
      onProgress: vi.fn(),
    });
    expect(api).not.toHaveBeenCalled();

    vi.mocked(api).mockResolvedValueOnce({
      ...detail,
      memberships: [{ user: { id: 'existing' } }],
    });
    await addProjectMember({
      projectId: 'project',
      selectedUserId: 'existing',
      selectedRoleName: 'editor',
      onProgress: vi.fn(),
    });
    expect(api).toHaveBeenCalledTimes(1);

    vi.mocked(api).mockResolvedValueOnce(detail);
    await expect(
      addProjectMember({
        projectId: 'project',
        selectedUserId: 'new-user',
        selectedRoleName: 'missing',
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow('role is no longer available');

    vi.mocked(api).mockResolvedValueOnce(detail).mockResolvedValueOnce({ id: 'membership' });
    await addProjectMember({
      projectId: 'project',
      selectedUserId: 'new-user',
      selectedRoleName: 'editor',
      onProgress: vi.fn(),
    });
    expect(api).toHaveBeenLastCalledWith(
      '/api/v1/projects/project/memberships',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
