// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InlineDocumentTitle } from './InlineDocumentTitle';

afterEach(cleanup);

describe('InlineDocumentTitle', () => {
  it('commits with Enter and blur without swapping the input', async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(<InlineDocumentTitle value="Original" noun="screenplay" canEdit onCommit={onCommit} />);
    const input = screen.getByRole('textbox', { name: 'Rename screenplay' });

    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('Renamed'));
    expect(screen.getByRole('textbox', { name: 'Rename screenplay' })).toBe(input);

    fireEvent.change(input, { target: { value: 'Renamed again' } });
    fireEvent.blur(input);
    await waitFor(() => expect(onCommit).toHaveBeenLastCalledWith('Renamed again'));
  });

  it('reverts with Escape without writing', () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(<InlineDocumentTitle value="Original" noun="breakdown" canEdit onCommit={onCommit} />);
    const input = screen.getByRole('textbox', { name: 'Rename breakdown' });

    input.focus();
    fireEvent.change(input, { target: { value: 'Discard me' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input).toHaveValue('Original');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('restores the committed title and exposes a visible error when saving fails', async () => {
    const onCommit = vi.fn().mockRejectedValue(new Error('Rename was rejected.'));
    render(<InlineDocumentTitle value="Original" noun="screenplay" canEdit onCommit={onCommit} />);
    const input = screen.getByRole('textbox', { name: 'Rename screenplay' });

    fireEvent.change(input, { target: { value: 'Unsaved' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByRole('alert')).toHaveTextContent('Rename was rejected.');
    expect(input).toHaveValue('Original');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('renders a non-editable title presentation for read-only access', () => {
    render(
      <InlineDocumentTitle
        value="Read only"
        noun="screenplay"
        canEdit={false}
        onCommit={vi.fn()}
      />,
    );

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('screenplay name')).toHaveTextContent('Read only');
    expect(screen.getByRole('heading', { name: 'Read only' })).toBeInTheDocument();
  });
});
