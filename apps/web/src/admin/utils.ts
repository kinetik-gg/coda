import { ApiError } from '../api';
import type { ByteValue } from './types';

export function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError ? (error.problem.detail ?? error.problem.title) : fallback;
}

export function bytes(value: ByteValue | undefined) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Unavailable';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let current = amount;
  let index = 0;
  while (current >= 1000 && index < units.length - 1) {
    current /= 1000;
    index += 1;
  }
  return `${current.toLocaleString(undefined, { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
}

export function duration(seconds: number) {
  if (!Number.isFinite(seconds)) return 'Unavailable';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', `${minutes}m`]
    .filter(Boolean)
    .join(' ');
}

export function dateTime(value: string | null | undefined) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Unavailable' : date.toLocaleString();
}

export function metadataEntries(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value)
    .slice(0, 6)
    .map(([key, entry]) => [
      key.replaceAll('_', ' '),
      typeof entry === 'object' ? 'Structured data' : String(entry),
    ]);
}
