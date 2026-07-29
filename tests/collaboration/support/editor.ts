import { expect, type Locator, type Page } from '@playwright/test';

export const editorContent = '.cm-content[contenteditable="true"]';

export function editor(page: Page): Locator {
  return page.locator(editorContent);
}

async function editorDocumentText(page: Page): Promise<string> {
  return editor(page)
    .locator('.cm-line')
    .evaluateAll((lines) =>
      lines
        .map((line) => {
          const copy = line.cloneNode(true) as HTMLElement;
          for (const caret of copy.querySelectorAll('.cm-ySelectionCaret')) caret.remove();
          return (copy.textContent ?? '').replaceAll('\u2060', '');
        })
        .join('\n'),
    );
}

export async function expectCollaborationReady(page: Page): Promise<void> {
  await expect(editor(page)).toContainText('FADE IN:');
  await expect(page.getByText('CONNECTION READY')).toBeVisible();
}

export async function expectEditorContains(page: Page, text: string): Promise<void> {
  await expect.poll(() => editorDocumentText(page)).toContain(text);
}

export async function expectEditorsConverged(owner: Page, member: Page): Promise<void> {
  await expect
    .poll(async () => {
      const [ownerText, memberText] = await Promise.all([
        editorDocumentText(owner),
        editorDocumentText(member),
      ]);
      return ownerText === memberText;
    })
    .toBe(true);
}

export async function typeAtDocumentEnd(page: Page, text: string): Promise<void> {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText(text);
}

export async function typeAtDocumentStart(page: Page, text: string): Promise<void> {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.insertText(text);
  await page.keyboard.press('Enter');
}

export async function selectDocumentStart(page: Page, length: number): Promise<void> {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+Home');
  for (let index = 0; index < length; index += 1) {
    await page.keyboard.press('Shift+ArrowRight');
  }
}

export async function openCommentsPanel(page: Page): Promise<void> {
  if (await page.getByLabel('New thread comment').isVisible()) return;
  await page
    .getByRole('button', { name: /^Choose (?:Comments|Statistics) panel function$/u })
    .click();
  await page.getByRole('menuitemradio', { name: 'Comments' }).click();
  await expect(page.getByLabel('New thread comment')).toBeVisible();
}
