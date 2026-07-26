// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PanelHeader } from './PanelHeader';

afterEach(cleanup);

describe('PanelHeader — crumbs variant (account/admin/instance-settings)', () => {
  it('renders the last crumb as the page heading and the rest as the breadcrumb prefix', () => {
    render(<PanelHeader crumbs={['Administration', 'Instance Settings', 'Storage']} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Storage' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByText('Administration')).toBeInTheDocument();
    expect(within(nav).getByText('Instance Settings')).toBeInTheDocument();
  });

  it('renders trailing actions when provided', () => {
    render(
      <PanelHeader
        crumbs={['Administration', 'Users']}
        actions={<button type="button">Search</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
  });

  it('renders a single crumb with no breadcrumb prefix and no actions', () => {
    render(<PanelHeader crumbs={['Overview']} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toHaveTextContent(/^Overview$/);
  });
});

describe('PanelHeader — title variant (content-list pages)', () => {
  it('renders the panel header, search, and action buttons', () => {
    const onChange = vi.fn();
    const onClick = vi.fn();
    render(
      <PanelHeader
        title="Screenplays"
        count={4}
        search={{ value: 'q', onChange, label: 'Search screenplays' }}
        actions={<button onClick={onClick}>New</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Screenplays' })).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search screenplays' }), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(onChange).toHaveBeenCalledWith('x');
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders a title with no count and no search (e.g. Manage screenplay)', () => {
    render(<PanelHeader title="Manage screenplay" actions={<button>Back</button>} />);
    expect(screen.getByRole('heading', { name: 'Manage screenplay' })).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });
});
