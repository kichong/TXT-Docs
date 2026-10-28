import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import electronBinary from 'electron';
import { _electron as electron } from 'playwright';

await mkdir('output/playwright', { recursive: true });
const profile = await mkdtemp(resolve('output/playwright/search-profile-'));
const packaged = process.argv.includes('--packaged');
const app = await electron.launch({
  executablePath: packaged ? resolve('release/win-unpacked/TXT Docs.exe') : electronBinary,
  args: [...(packaged ? [] : [resolve('.')]), `--user-data-dir=${profile}`],
});
try {
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('.document-editor').waitFor();
  await page.evaluate(() => {
    const content = Array.from({ length: 150 }, (_, i) => ({
      type: 'paragraph', content: [{ type: 'text', text: [20, 75, 135].includes(i) ? `Needle ${i}` : `Paragraph ${i}: ordinary document text.` }],
    }));
    document.querySelector('.document-editor').editor.commands.setContent({ type: 'doc', content });
  });
  await page.keyboard.press('Control+f');
  const input = page.getByRole('textbox', { name: 'Find in document' });
  await input.fill('Needle');
  async function check(index) {
    await page.waitForFunction((index) => {
      const match = document.querySelector('.document-search-match.is-current');
      const canvas = document.querySelector('.canvas-scroll');
      if (!match || !canvas) return false;
      const rect = match.getBoundingClientRect();
      const viewport = canvas.getBoundingClientRect();
      return document.querySelector('.find-count').textContent === `${index} of 3`
        && rect.top >= viewport.top && rect.bottom <= viewport.bottom
        && document.activeElement?.getAttribute('aria-label') === 'Find in document';
    }, index);
  }
  await check(1);
  await input.press('Enter');
  await check(2);
  await input.press('Enter');
  await check(3);
  await input.press('Enter');
  await check(1);
  await input.press('Shift+Enter');
  await check(3);
  await page.getByRole('button', { name: 'Previous match', exact: true }).click();
  await check(2);
  await page.getByRole('button', { name: 'Next match', exact: true }).click();
  await check(3);
  await input.fill('absent term');
  await page.getByText('No matches', { exact: true }).waitFor();
  await input.fill('Needle');
  await check(1);
  await page.screenshot({ path: 'output/playwright/search-navigation.png' });
  await input.press('Escape');
  assert.equal(await page.locator('.find-bar').count(), 0);
  assert.equal(await page.locator('.document-search-match').count(), 0);
  assert.ok(await page.locator('.document-editor').evaluate((el) => el.contains(document.activeElement)));
  assert.deepEqual(errors, []);
  console.log('PASS: Find reveals distant matches, keyboard/button cycling and wrapping, input focus, no matches, Escape');
} finally {
  await app.close();
}
