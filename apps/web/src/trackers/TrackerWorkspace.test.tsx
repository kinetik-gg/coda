// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackerWorkspace } from './TrackerWorkspace';

vi.mock('../workspace/TrackerWorkspaceScreen', () => ({
  TrackerWorkspaceScreen: (props: { trackerId: string; onBack: () => void }) => (
    <div data-testid="screen">{props.trackerId}</div>
  ),
}));

afterEach(cleanup);

describe('TrackerWorkspace route entry', () => {
  it('renders the tracker workspace screen for the routed tracker', () => {
    const onBack = vi.fn();
    render(
      <TrackerWorkspace
        trackerId="tracker-9"
        currentUser={{ id: 'user-1', displayName: 'Ari' }}
        onBack={onBack}
      />,
    );
    expect(screen.getByTestId('screen')).toHaveTextContent('tracker-9');
  });
});
