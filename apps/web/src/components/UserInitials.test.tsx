// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { initialsForName, UserInitials } from './UserInitials';

afterEach(cleanup);

describe('UserInitials', () => {
  it('uses the first two name parts and a stable blank-name fallback', () => {
    expect(initialsForName('Ada Lovelace Byron')).toBe('AL');
    expect(initialsForName('álvaro')).toBe('Á');
    expect(initialsForName('   ')).toBe('A');
  });

  it('is decorative when the surrounding control or row already names the user', () => {
    render(<UserInitials name="Ada Lovelace" />);
    expect(screen.getByText('AL')).toHaveAttribute('aria-hidden', 'true');
  });
});
