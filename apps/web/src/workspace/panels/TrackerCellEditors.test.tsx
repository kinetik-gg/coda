// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeTrackerUpload,
  createTrackerUpload,
  uploadFileWithProgress,
  type TransferOptions,
} from '../../api';
import { CellEditor, TitleCellInput, cellEditorKind } from './TrackerCellEditors';
import type { TrackerField } from '../../trackers/types';

vi.mock('../../api', () => ({
  createTrackerUpload: vi.fn(),
  completeTrackerUpload: vi.fn(),
  uploadFileWithProgress: vi.fn(),
}));

const mockedCreate = vi.mocked(createTrackerUpload);
const mockedTransfer = vi.mocked(uploadFileWithProgress);
const mockedComplete = vi.mocked(completeTrackerUpload);

afterEach(cleanup);

function field(type: string, options: TrackerField['options'] = []): TrackerField {
  return {
    id: `f-${type}`,
    name: `Field ${type}`,
    key: `field_${type}`,
    type,
    required: false,
    version: 1,
    options,
  };
}

const enumOptions = [
  { id: 'opt-1', label: 'Blue' },
  { id: 'opt-2', label: 'Red' },
];

function editor(type: string, onSave = vi.fn(), current: string | string[] = '') {
  const onCancel = vi.fn();
  render(
    <CellEditor
      field={field(type, enumOptions)}
      recordId="r1"
      current={current}
      onSave={onSave}
      onCancel={onCancel}
    />,
  );
  return { onSave, onCancel };
}

describe('cell editor kinds', () => {
  it('maps every field type onto its editor', () => {
    expect(cellEditorKind(field('text'))).toBe('text');
    expect(cellEditorKind(field('long_text'))).toBe('multiline');
    expect(cellEditorKind(field('integer'))).toBe('number');
    expect(cellEditorKind(field('float'))).toBe('number');
    expect(cellEditorKind(field('boolean'))).toBe('boolean');
    expect(cellEditorKind(field('date'))).toBe('date');
    expect(cellEditorKind(field('enum'))).toBe('enum');
    expect(cellEditorKind(field('multi_enum'))).toBe('multi');
    expect(cellEditorKind(field('file'))).toBe('media');
    expect(cellEditorKind(field('image'))).toBe('media');
    expect(cellEditorKind(field('video'))).toBe('media');
  });
});

describe('cell editors per type', () => {
  it('edits text with Enter commit and Escape cancel', () => {
    const { onSave, onCancel } = editor('text', vi.fn(), 'Old');
    const input = screen.getByLabelText(/Field text for record r1/i);
    fireEvent.change(input, { target: { value: 'New' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith({ type: 'text', value: 'New' }, undefined);
    fireEvent.keyDown(screen.getByLabelText(/Field text for record r1/i), { key: 'Escape' });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('validates integer cells and refuses non-whole input', () => {
    const onSave = vi.fn();
    editor('integer', onSave, '');
    const input = screen.getByLabelText(/Field integer for record r1/i);
    fireEvent.change(input, { target: { value: '4.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/whole number/i);
    const validInput = screen.getByLabelText(/Field integer for record r1/i);
    fireEvent.change(validInput, { target: { value: '42' } });
    fireEvent.keyDown(validInput, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith({ type: 'integer', value: 42 }, undefined);
  });

  it('commits float values', () => {
    const onSave = vi.fn();
    editor('float', onSave, '');
    const input = screen.getByLabelText(/Field float for record r1/i);
    fireEvent.change(input, { target: { value: '1.25' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith({ type: 'float', value: 1.25 }, undefined);
  });

  it('renders a date input whose commit is a date value', () => {
    const onSave = vi.fn();
    editor('date', onSave, '');
    const input = screen.getByLabelText(/Field date for record r1/i);
    expect(input.getAttribute('type')).toBe('date');
    fireEvent.change(input, { target: { value: '2026-08-24' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith({ type: 'date', value: '2026-08-24' }, undefined);
  });

  it('long-text edits run in a popover committed with Ctrl+Enter or Save', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(
      <CellEditor
        field={field('long_text')}
        recordId="r1"
        current="Line one"
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    const area = screen.getByRole('textbox', { name: /Field long_text for record r1/i });
    fireEvent.change(area, { target: { value: 'Line one\nLine two' } });
    fireEvent.keyDown(area, { key: 'Enter', ctrlKey: true });
    expect(onSave).toHaveBeenCalledWith({ type: 'long_text', value: 'Line one\nLine two' }, undefined);
  });

  it('boolean cells offer a tri-state select that commits immediately', async () => {
    const onSave = vi.fn();
    editor('boolean', onSave, '');
    fireEvent.click(screen.getByRole('button', { name: /Field boolean for record r1/i }));
    fireEvent.click(await screen.findByRole('option', { name: 'True' }));
    expect(onSave).toHaveBeenCalledWith({ type: 'boolean', value: true }, undefined);
  });

  it('enum cells commit the chosen option id', async () => {
    const onSave = vi.fn();
    editor('enum', onSave, '');
    fireEvent.click(screen.getByRole('button', { name: /Field enum for record r1/i }));
    fireEvent.click(await screen.findByRole('option', { name: 'Red' }));
    expect(onSave).toHaveBeenCalledWith({ type: 'enum', optionId: 'opt-2' }, undefined);
  });

  it('multi-enum cells save through the explicit Save action', async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(
      <CellEditor
        field={field('multi_enum', enumOptions)}
        recordId="r1"
        current={['opt-1']}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Field multi_enum for record r1/i }));
    fireEvent.click(await screen.findByRole('option', { name: 'Red' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await Promise.resolve();
    expect(onSave).toHaveBeenCalledWith(
      { type: 'multi_enum', optionIds: ['opt-1', 'opt-2'] },
      undefined,
    );
  });

  it('Tab commits and steps one column sideways', () => {
    const onSave = vi.fn();
    editor('text', onSave, '');
    const input = screen.getByLabelText(/Field text for record r1/i);
    fireEvent.change(input, { target: { value: 'Moved' } });
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: false });
    expect(onSave).toHaveBeenCalledWith({ type: 'text', value: 'Moved' }, { horizontal: 1 });
  });

  it('the title cell commits trimmed names and ignores empty ones', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <TitleCellInput recordId="r1" initial="Old" onCommit={onCommit} onCancel={onCancel} />,
    );
    const input = screen.getByLabelText(/Title for record r1/i);
    fireEvent.change(input, { target: { value: '  Renamed  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('Renamed', undefined);
    fireEvent.change(screen.getByLabelText(/Title for record r1/i), {
      target: { value: '   ' },
    });
    fireEvent.keyDown(screen.getByLabelText(/Title for record r1/i), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

describe('media cell editors (#382)', () => {
  beforeEach(() => {
    [mockedCreate, mockedTransfer, mockedComplete].forEach((fn) => fn.mockReset());
  });

  function mediaEditor(
    type: 'image' | 'file' | 'video',
    onSave = vi.fn(),
    current = '',
  ): { onSave: ReturnType<typeof vi.fn>; onCancel: ReturnType<typeof vi.fn> } {
    const onCancel = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CellEditor
          trackerId="t1"
          field={field(type)}
          recordId="r1"
          current={current}
          onSave={onSave}
          onCancel={onCancel}
        />
      </QueryClientProvider>,
    );
    return { onSave, onCancel };
  }

  function pickFile(name: string, type: string) {
    const input = screen.getByLabelText<HTMLInputElement>(/Upload .* for record r1/i);
    fireEvent.change(input, { target: { files: [new File(['bytes'], name, { type })] } });
  }

  it('uploads through reserve → PUT → complete and commits the storageObjectId', async () => {
    mockedCreate.mockResolvedValue({
      id: 'object-9',
      version: 1,
      status: 'PENDING',
      uploadUrl: '/api/v1/trackers/t1/uploads/object-9',
      directUpload: false,
    });
    let finish!: () => void;
    const transferred = new Promise<void>((resolve) => {
      finish = resolve;
    });
    mockedTransfer.mockImplementation((_target, _file, options?: TransferOptions) => {
      options?.onProgress?.(0.75);
      return transferred;
    });
    mockedComplete.mockResolvedValue({
      id: 'object-9',
      kind: 'IMAGE',
      status: 'READY',
      originalFilename: 'board.png',
      mimeType: 'image/png',
      sizeBytes: 5,
    });
    const { onSave } = mediaEditor('image');
    expect(screen.getByRole('button', { name: 'Upload' })).toBeTruthy();
    pickFile('board.png', 'image/png');
    // Live byte progress renders while the bytes are in flight.
    expect(await screen.findByRole('progressbar')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('75');
    finish();
    await waitFor(() => expect(mockedComplete).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith({ type: 'image', storageObjectId: 'object-9' });
    expect(mockedCreate).toHaveBeenCalledWith({
      trackerId: 't1',
      kind: 'image',
      filename: 'board.png',
      mimeType: 'image/png',
      sizeBytes: 5,
    });
  });

  it('shows replace and remove for a filled file cell and remove commits null', () => {
    const { onSave } = mediaEditor('file', vi.fn(), 'object-3');
    expect(screen.getByText('Attachment')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onSave).toHaveBeenCalledWith(null);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('cancels the in-flight upload without committing', async () => {
    let release!: () => void;
    mockedCreate.mockResolvedValue({
      id: 'object-4',
      version: 2,
      status: 'PENDING',
      uploadUrl: 'https://objects.test/x',
      directUpload: true,
    });
    mockedTransfer.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { onSave } = mediaEditor('video');
    pickFile('take-one.mp4', 'video/mp4');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload' })).toBeTruthy());
    expect(mockedComplete).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('surfaces API problem details from a rejected reservation', async () => {
    mockedCreate.mockRejectedValue(new Error('Upload exceeds the 10485760-byte limit'));
    mediaEditor('image');
    pickFile('huge.png', 'image/png');
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Upload exceeds the 10485760-byte limit',
    );
  });

  it('Escape cancels the editor', () => {
    const { onCancel } = mediaEditor('file');
    fireEvent.keyDown(screen.getByLabelText(/Upload file for record r1/i), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});
