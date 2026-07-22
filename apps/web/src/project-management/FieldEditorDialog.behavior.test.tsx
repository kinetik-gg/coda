// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FieldEditorDialog } from './FieldEditorDialog';

const entityType = { id: 'type', singularName: 'Shot', pluralName: 'Shots', level: 2, version: 1 };

afterEach(cleanup);

describe('FieldEditorDialog', () => {
  it('derives keys, configures enum options, and submits normalized values', () => {
    const onSubmit = vi.fn();
    render(
      <FieldEditorDialog
        entityType={entityType}
        busy={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Shooting Location' } });
    expect(screen.getByPlaceholderText('shooting_location')).toHaveValue('shooting_location');
    fireEvent.click(screen.getByRole('button', { name: 'Field type' }));
    fireEvent.click(screen.getByRole('option', { name: 'Single select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add option' }));
    expect(screen.getByRole('button', { name: 'Create field' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Option 1 label'), { target: { value: 'Exterior' } });
    fireEvent.click(screen.getByLabelText('Required field'));
    fireEvent.click(screen.getByRole('button', { name: 'Create field' }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Shooting Location',
      key: 'shooting_location',
      type: 'enum',
      required: true,
      options: [{ label: 'Exterior' }],
    });
  });

  it('edits immutable field types, sanitizes keys, removes options, and closes safely', () => {
    const close = vi.fn();
    render(
      <FieldEditorDialog
        field={{
          id: 'field',
          entityTypeId: 'type',
          name: 'Status',
          key: 'status',
          type: 'ENUM',
          required: false,
          version: 1,
          options: [{ id: 'option', label: 'Ready' }],
        }}
        entityType={entityType}
        busy={false}
        error="Save failed"
        onClose={close}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Field type' })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('shooting_location'), {
      target: { value: 'Bad Key!' },
    });
    expect(screen.getByPlaceholderText('shooting_location')).toHaveValue('badkey');
    fireEvent.click(screen.getByRole('button', { name: 'Remove option 1' }));
    expect(screen.getByRole('button', { name: 'Save field' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Save failed');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalled();
  });
});
