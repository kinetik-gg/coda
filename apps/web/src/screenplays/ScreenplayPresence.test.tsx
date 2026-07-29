// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ScreenplayCollaborator } from './screenplay-collaboration-provider';
import { ScreenplayPresence } from './ScreenplayPresence';

afterEach(cleanup);

function collaborator(
  userId: string,
  displayName: string,
  isLocal = false,
): ScreenplayCollaborator {
  return {
    clientId: userId.length,
    userId,
    displayName,
    color: 'var(--coda-focus)',
    isLocal,
  };
}

describe('ScreenplayPresence', () => {
  it('renders one identity chip per member, preferring the local session', () => {
    render(
      <ScreenplayPresence
        collaborators={[
          collaborator('ada', 'Ada Remote'),
          collaborator('ada', 'Ada', true),
          collaborator('bob', 'Bob'),
        ]}
      />,
    );

    expect(screen.getByLabelText('2 collaborators present')).toBeInTheDocument();
    expect(screen.getByText('Ada (You)')).toBeInTheDocument();
    expect(screen.queryByText('Ada Remote')).not.toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('keeps dense chrome bounded when more than four members are present', () => {
    render(
      <ScreenplayPresence
        collaborators={[
          collaborator('one', 'One', true),
          collaborator('two', 'Two'),
          collaborator('three', 'Three'),
          collaborator('four', 'Four'),
          collaborator('five', 'Five'),
          collaborator('six', 'Six'),
        ]}
      />,
    );

    expect(screen.getByLabelText('2 more collaborators')).toHaveTextContent('+2');
    expect(screen.queryByText('Five')).not.toBeInTheDocument();
    expect(screen.queryByText('Six')).not.toBeInTheDocument();
  });
});
