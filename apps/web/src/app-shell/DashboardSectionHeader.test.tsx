// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DashboardSectionHeader } from './DashboardSectionHeader';

afterEach(cleanup);

describe('DashboardSectionHeader', () => {
  it('renders the last crumb as the page heading and the rest as the breadcrumb prefix', () => {
    render(<DashboardSectionHeader crumbs={['Administration', 'Instance Settings', 'Storage']} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Storage' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByText('Administration')).toBeInTheDocument();
    expect(within(nav).getByText('Instance Settings')).toBeInTheDocument();
  });

  it('renders trailing actions when provided', () => {
    render(
      <DashboardSectionHeader
        crumbs={['Administration', 'Users']}
        actions={<button type="button">Search</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
  });
});
