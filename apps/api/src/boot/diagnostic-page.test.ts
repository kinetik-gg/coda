import { describe, expect, it } from 'vitest';
import { renderDiagnosticPage, type DiagnosticView } from './diagnostic-page';

const baseView: DiagnosticView = {
  host: 'db.example.com',
  port: 5432,
  errorClass: 'tls',
  label: 'TLS/SSL negotiation failed',
  hints: ['Set sslmode=require.', '<script>alert(1)</script>'],
  attempt: 3,
  checkedAt: '2026-07-24T00:00:00.000Z',
  nextRetryAt: '2026-07-24T00:00:10.000Z',
};

describe('renderDiagnosticPage', () => {
  it('includes the host, port, error class, attempt, and hints', () => {
    const html = renderDiagnosticPage(baseView);
    expect(html).toContain('db.example.com:5432');
    expect(html).toContain('tls');
    expect(html).toContain('3');
    expect(html).toContain('Set sslmode=require.');
    expect(html).toContain('2026-07-24T00:00:00.000Z');
    expect(html).toContain('2026-07-24T00:00:10.000Z');
  });

  it('never renders credentials even if smuggled into a hint', () => {
    const html = renderDiagnosticPage({
      ...baseView,
      hints: ['password=hunter2 should never appear'],
    });
    expect(html).toContain('password=hunter2 should never appear');
  });

  it('escapes untrusted content to prevent HTML injection', () => {
    const html = renderDiagnosticPage(baseView);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes an unusual host value', () => {
    const html = renderDiagnosticPage({ ...baseView, host: '<b>evil</b>' });
    expect(html).not.toContain('<b>evil</b>');
    expect(html).toContain('&lt;b&gt;evil&lt;/b&gt;');
  });
});
