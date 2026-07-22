const MAX_COLUMN_WIDTH = 1600;

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * The resize floor is the rendered header label plus its cell padding. Keeping
 * this calculation separate makes custom-field headers behave exactly like
 * built-in columns without imposing an unrelated generic minimum.
 */
export function headerMinimumColumnWidth(
  labelWidth: number,
  paddingLeft: number,
  paddingRight: number,
): number {
  return Math.max(
    1,
    Math.ceil(
      finiteNonNegative(labelWidth) +
        finiteNonNegative(paddingLeft) +
        finiteNonNegative(paddingRight),
    ),
  );
}

export function resizedColumnWidth(value: number, minimum: number): number {
  return Math.max(Math.max(1, minimum), Math.min(MAX_COLUMN_WIDTH, Math.round(value)));
}
