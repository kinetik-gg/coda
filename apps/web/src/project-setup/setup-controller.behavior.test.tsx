// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import {
  addProjectMember,
  configureEntityTypes,
  publishProjectWorkspace,
  uploadProjectSource,
} from './setup-operations';
import { useProjectSetupController } from './useProjectSetupController';

vi.mock('../api', () => ({ api: vi.fn() }));
vi.mock('./setup-operations', () => ({
  addProjectMember: vi.fn().mockResolvedValue(undefined),
  configureEntityTypes: vi.fn().mockResolvedValue({ id: 'project', entityTypes: [] }),
  publishProjectWorkspace: vi.fn().mockResolvedValue(undefined),
  uploadProjectSource: vi.fn().mockResolvedValue(undefined),
}));

const mockedApi = vi.mocked(api);
const mockedConfigure = vi.mocked(configureEntityTypes);
const mockedPublish = vi.mocked(publishProjectWorkspace);
const mockedUpload = vi.mocked(uploadProjectSource);
const mockedMember = vi.mocked(addProjectMember);
const options = {
  users: [{ id: 'user', displayName: 'User', email: 'user@example.com' }],
  roles: [
    { id: 'role', name: 'viewer' },
    { id: 'editor', name: 'editor' },
  ],
  templates: [
    {
      id: 'movie',
      name: 'Movie',
      description: 'Movie template',
      levels: [{ singularName: 'Scene', pluralName: 'Scenes' }],
    },
  ],
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  );
}
function pdf(name = 'source.pdf') {
  return new File(['pdf'], name, { type: 'application/pdf' });
}

afterEach(cleanup);
beforeEach(() => {
  mockedApi.mockReset();
  mockedConfigure.mockClear();
  mockedPublish.mockClear();
  mockedUpload.mockClear();
  mockedMember.mockClear();
  mockedApi.mockImplementation((url, init) => {
    if (String(url).endsWith('/creation-options')) return Promise.resolve(options);
    if (String(url).endsWith('/from-template')) return Promise.resolve({ id: 'template-project' });
    if (String(url).endsWith('/projects') && init?.method === 'POST')
      return Promise.resolve({ id: 'blank-project' });
    if (String(url).endsWith('/projects/template-project'))
      return Promise.resolve({ id: 'template-project', entityTypes: [] });
    return Promise.resolve(undefined);
  });
});

describe('project setup controller', () => {
  it('derives options, updates levels, validates sources, and navigates steps', async () => {
    const { result } = renderHook(() => useProjectSetupController(vi.fn()), { wrapper });
    await waitFor(() => expect(result.current.options.data).toEqual(options));
    expect(result.current.roleOptions).toEqual([
      { value: 'viewer', label: 'Viewer' },
      { value: 'editor', label: 'Editor' },
    ]);
    expect(result.current.userOptions[1]?.label).toContain('user@example.com');
    expect(result.current.templateOptions.map((entry) => entry.value)).toEqual(['blank', 'movie']);

    act(() => result.current.chooseTemplate('movie'));
    expect(result.current.levelCount).toBe(1);
    expect(result.current.selectedTemplate?.name).toBe('Movie');
    act(() => result.current.updateLevel(0, 'singular', 'Beat'));
    expect(result.current.levels[0]?.singular).toBe('Beat');
    act(() => result.current.chooseSource(new File(['text'], 'notes.txt', { type: 'text/plain' })));
    expect(result.current.sourceError).toBe('Choose a PDF document.');
    act(() => result.current.chooseSource(pdf()));
    expect(result.current.sourceFile?.name).toBe('source.pdf');
    act(() => result.current.nextStep());
    expect(result.current.stepIndex).toBe(1);
    act(() => result.current.previousStep());
    expect(result.current.stepIndex).toBe(0);
  });

  it('creates a blank project once and completes every setup operation', async () => {
    const onCreated = vi.fn();
    const { result } = renderHook(() => useProjectSetupController(onCreated), { wrapper });
    await waitFor(() => expect(result.current.options.data).toBeTruthy());
    act(() => {
      result.current.setName('  Film  ');
      result.current.setDescription('  Description  ');
      result.current.setSelectedUserId('user');
      result.current.setSelectedRoleName('editor');
      result.current.chooseSource(pdf());
    });
    await act(() => result.current.create());
    expect(mockedApi).toHaveBeenCalledWith(
      '/api/v1/projects',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Film', description: 'Description' }),
      }),
    );
    expect(mockedConfigure).toHaveBeenCalled();
    expect(mockedPublish).toHaveBeenCalled();
    expect(mockedUpload).toHaveBeenCalled();
    expect(mockedMember).toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith('blank-project');
    await act(() => result.current.create());
    expect(mockedApi.mock.calls.filter(([url]) => String(url) === '/api/v1/projects')).toHaveLength(
      1,
    );
  });

  it('creates from a template without reconfiguring levels', async () => {
    const onCreated = vi.fn();
    const { result } = renderHook(() => useProjectSetupController(onCreated), { wrapper });
    await waitFor(() => expect(result.current.options.data).toBeTruthy());
    act(() => {
      result.current.setName('Template Film');
      result.current.chooseTemplate('movie');
    });
    await act(() => result.current.create());
    expect(mockedApi).toHaveBeenCalledWith(
      '/api/v1/projects/from-template',
      expect.objectContaining({
        body: JSON.stringify({ name: 'Template Film', description: null, templateId: 'movie' }),
      }),
    );
    expect(mockedConfigure).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith('template-project');
  });

  it('ignores incomplete creation and reports safe failure messages', async () => {
    const { result } = renderHook(() => useProjectSetupController(vi.fn()), { wrapper });
    await act(() => result.current.create());
    expect(mockedApi.mock.calls.some(([url]) => String(url) === '/api/v1/projects')).toBe(false);
    act(() => {
      result.current.setName('Film');
      result.current.chooseSource(pdf());
    });
    mockedApi.mockRejectedValueOnce('offline');
    await act(() => result.current.create());
    expect(result.current.error).toBe('Breakdown setup failed.');
    expect(result.current.progress).toBe('');
    expect(result.current.busy).toBe(false);
  });
});
