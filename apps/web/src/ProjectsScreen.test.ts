import { describe, expect, it } from 'vitest';
import type { Project } from './ProjectsScreen';
import { groupProjects } from './project-list';

const projects: Project[] = [
  {
    id: 'owned',
    name: 'Owned project',
    description: null,
    ownerUserId: 'current-user',
    updatedAt: '2026-07-22T00:00:00.000Z',
  },
  {
    id: 'shared',
    name: 'Shared project',
    description: null,
    ownerUserId: 'another-user',
    updatedAt: '2026-07-22T00:00:00.000Z',
  },
];

describe('groupProjects', () => {
  it('separates projects owned by the current user from shared projects', () => {
    expect(groupProjects(projects, 'current-user')).toEqual({
      owned: [projects[0]],
      shared: [projects[1]],
    });
  });

  it('does not present any project as owned before the session is known', () => {
    expect(groupProjects(projects, undefined)).toEqual({ owned: [], shared: projects });
  });
});
