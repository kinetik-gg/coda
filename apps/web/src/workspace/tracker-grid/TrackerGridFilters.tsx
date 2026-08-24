import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { CustomMultiSelect, CustomSelect } from '../../components/CustomSelect';
import type { TrackerField } from '../../trackers/types';
import { PanelCommandMenu } from '../PanelCommandMenu';
import type { GridPanel } from '../tracker-model';
import styles from './TrackerGrid.module.css';

type Filter = GridPanel['config']['filters'][number];
type FilterOperator = Filter['operator'];

const OPERATORS_BY_TYPE: Record<string, FilterOperator[]> = {
  text: ['contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty'],
  long_text: ['contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty'],
  integer: ['equals', 'not_equals', 'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal', 'is_empty', 'is_not_empty'],
  float: ['equals', 'not_equals', 'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal', 'is_empty', 'is_not_empty'],
  date: ['equals', 'greater_or_equal', 'less_or_equal', 'is_empty', 'is_not_empty'],
  boolean: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  enum: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  multi_enum: ['has_any', 'has_all', 'is_empty', 'is_not_empty'],
};

function operatorsFor(field: TrackerField): FilterOperator[] {
  return OPERATORS_BY_TYPE[field.type.toLowerCase()] ?? OPERATORS_BY_TYPE.text!;
}

function needsValue(operator: string): boolean {
  return operator !== 'is_empty' && operator !== 'is_not_empty';
}

const OPERATOR_LABELS: Record<string, string> = {
  contains: 'contains',
  equals: '=',
  not_equals: '≠',
  greater_than: '>',
  greater_or_equal: '≥',
  less_than: '<',
  less_or_equal: '≤',
  is_empty: 'is empty',
  is_not_empty: 'is set',
  has_any: 'has any of',
  has_all: 'has all of',
};

/**
 * Typed filter chips over the shared operator set (#379): one chip per active filter, with an
 * operator control and a value editor shaped by the field type. Chips serialize straight into
 * the panel config that drives the server-side record query.
 */
export function TrackerGridFilters({
  panel,
  fields,
  onPanelChange,
}: {
  panel: GridPanel;
  fields: TrackerField[];
  onPanelChange: (panel: GridPanel) => void;
}) {
  const filters = panel.config.filters;
  const replace = (next: Filter[]) =>
    onPanelChange({ ...panel, config: { ...panel.config, filters: next } });
  const patchFilter = (index: number, changes: Partial<Filter>) =>
    replace(filters.map((filter, i) => (i === index ? { ...filter, ...changes } : filter)));
  const addFilter = (fieldId: string) => {
    const field = fields.find((entry) => entry.id === fieldId);
    if (!field) return;
    replace([...filters, { fieldId, operator: operatorsFor(field)[0]!, value: '' }]);
  };
  const unfiltered = fields.filter((field) => !filters.some((filter) => filter.fieldId === field.id));

  return (
    <div className={styles.filterBar}>
      {filters.map((filter, index) => {
        const field = fields.find((entry) => entry.id === filter.fieldId);
        if (!field) return null;
        const operators = operatorsFor(field);
        return (
          <span key={filter.fieldId} className={styles.filterChip}>
            <span className={styles.filterField}>{field.name}</span>
            <CustomSelect
              ariaLabel={`Operator for ${field.name}`}
              size="compact"
              className={styles.filterOperator}
              value={String(filter.operator)}
              onChange={(operator) =>
                patchFilter(index, { operator: operator as FilterOperator, value: '' })
              }
              options={operators.map((operator) => ({
                value: operator,
                label: OPERATOR_LABELS[operator] ?? operator,
              }))}
            />
            {needsValue(String(filter.operator)) && (
              <FilterValueInput
                field={field}
                value={filter.value}
                onChange={(value) => patchFilter(index, { value })}
              />
            )}
            <button
              type="button"
              className={styles.filterRemove}
              aria-label={`Remove ${field.name} filter`}
              onClick={() => replace(filters.filter((_, i) => i !== index))}
            >
              <XIcon size={10} weight="bold" />
            </button>
          </span>
        );
      })}
      {unfiltered.length > 0 && (
        <PanelCommandMenu
          label="Filter"
          triggerContent={<PlusIcon size={12} aria-hidden="true" />}
          items={unfiltered.map((field) => ({
            label: field.name,
            action: () => addFilter(field.id),
          }))}
        />
      )}
    </div>
  );
}

function FilterValueInput({
  field,
  value,
  onChange,
}: {
  field: TrackerField;
  value: Filter['value'];
  onChange: (value: Filter['value']) => void;
}) {
  const type = field.type.toLowerCase();
  if (type === 'enum') {
    return (
      <CustomSelect
        ariaLabel={`Value for ${field.name}`}
        size="compact"
        className={styles.filterValueSelect}
        value={typeof value === 'string' ? value : ''}
        placeholder="Any"
        onChange={onChange}
        options={[
          { value: '', label: 'Any' },
          ...field.options.map((option) => ({ value: option.id, label: option.label })),
        ]}
      />
    );
  }
  if (type === 'boolean') {
    return (
      <CustomSelect
        ariaLabel={`Value for ${field.name}`}
        size="compact"
        className={styles.filterValueSelect}
        value={typeof value === 'boolean' ? String(value) : ''}
        placeholder="Any"
        onChange={(next) => onChange(next === '' ? '' : next === 'true')}
        options={[
          { value: '', label: 'Any' },
          { value: 'true', label: 'True' },
          { value: 'false', label: 'False' },
        ]}
      />
    );
  }
  if (type === 'multi_enum') {
    return (
      <CustomMultiSelect
        ariaLabel={`Values for ${field.name}`}
        size="compact"
        className={styles.filterValueSelect}
        value={Array.isArray(value) ? value : []}
        onChange={onChange}
        options={field.options.map((option) => ({ value: option.id, label: option.label }))}
      />
    );
  }
  return (
    <input
      className={styles.filterValue}
      aria-label={`Value for ${field.name}`}
      type={type === 'integer' || type === 'float' ? 'number' : type === 'date' ? 'date' : 'text'}
      step={type === 'float' ? 'any' : undefined}
      value={value === undefined || typeof value === 'object' ? '' : String(value)}
      onChange={(event) => {
        const raw = event.target.value;
        if ((type === 'integer' || type === 'float') && raw && Number.isFinite(Number(raw))) {
          onChange(Number(raw));
          return;
        }
        onChange(raw);
      }}
    />
  );
}
