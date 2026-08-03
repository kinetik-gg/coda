import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const lifecycle = readFileSync('scripts/ops/validate-recovery-lifecycle.sh', 'utf8');

describe('recovery lifecycle source startup', () => {
  it('retries once from an empty disposable stack after a bind failure', () => {
    expect(lifecycle).toContain('start_source_stack()');
    expect(lifecycle).toContain('down --volumes --remove-orphans || true');
    expect(lifecycle).toContain("echo 'Source stack startup failed;");
    expect(lifecycle).toMatch(/start_source_stack\(\)[\s\S]*?sleep 3[\s\S]*?up --detach/u);
    expect(lifecycle).toMatch(/docker pull "\$old_image"\s+start_source_stack/u);
  });
});
