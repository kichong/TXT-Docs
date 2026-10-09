import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import electronBinary from 'electron';
import { _electron as electron } from 'playwright';

await mkdir('output/lists-spacing', { recursive: true });
const profile = await mkdtemp(resolve('output/lists-spacing/profile-'));
const path = resolve(profile, 'lists.docx');
const packaged = process.argv.includes('--packaged');
const errors = [];
let app;
let page;
async function launch(file) {
  app = await electron.launch({ executablePath: packaged ? resolve('release/win-unpacked/TXT Docs.exe') : electronBinary, args: [...(packaged ? [] : [resolve('.')]), `--user-data-dir=${profile}`, ...(file ? [path] : [])] });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('.document-editor').waitFor();
  if (file) await page.waitForFunction(() => document.querySelector('.document-editor').textContent.includes('Body'));
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); dialog.showMessageBox = async () => ({ response: 1 }); }, path);
}
async function assertState(spacing) {
  const state = await page.evaluate(() => {
    const root = document.querySelector('.document-editor');
    return {
      starts: [...root.querySelectorAll('ol')].map((node) => Number(node.getAttribute('start') || 1)),
      bullets: root.querySelectorAll('ul').length,
      paragraphs: [...root.querySelectorAll('p')].map((node) => {
        const css = getComputedStyle(node);
        return { ratio: parseFloat(css.lineHeight) / parseFloat(css.fontSize), before: css.marginTop, after: css.marginBottom };
      }),
    };
  });
  assert.deepEqual(state.starts, [5, 3, 9, 1]);
  assert.equal(state.bullets, 1);
  assert.ok(state.paragraphs.every((p) => Math.abs(p.ratio - Number(spacing)) < 0.01), JSON.stringify(state.paragraphs));
  assert.ok(state.paragraphs.every((p) => p.before === '0px' && p.after === '0px'));
}
async function selectAll() {
  await page.waitForTimeout(100);
  await page.locator('.document-editor').focus();
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(100);
}
async function save() {
  await app.evaluate(({ ipcMain }) => {
    globalThis.saved = false;
    const original = ipcMain._invokeHandlers.get('documents:save');
    ipcMain.removeHandler('documents:save');
    ipcMain.handle('documents:save', async (...args) => { const result = await original(...args); globalThis.saved = true; return result; });
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => !document.title.includes('*'));
  for (let i = 0; i < 100; i++) {
    if (await app.evaluate(() => globalThis.saved)) return;
    await page.waitForTimeout(50);
  }
  throw new Error('Save did not complete');
}
try {
  await launch(false);
  const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const list = (start, nested = []) => ({ type: 'orderedList', attrs: { start }, content: [
    { type: 'listItem', content: [p('First'), ...nested] }, { type: 'listItem', content: [p('Second')] },
  ] });
  const content = [p('Body'), list(5, [{ type: 'bulletList', content: [{ type: 'listItem', content: [p('Bullet'), list(3)] }] }]), p('Gap'), list(9), p('Gap'), list(1)];
  await page.evaluate((content) => document.querySelector('.document-editor').editor.commands.setContent({ type: 'doc', content }), content);
  await assertState('1');
  for (const spacing of ['1.15', '1.5', '2', '1']) {
    await selectAll();
    await page.getByLabel('Line spacing', { exact: true }).selectOption(spacing);
    await assertState(spacing);
    await save();
    await app.close();
    await launch(true);
    await assertState(spacing);
  }
  await selectAll();
  await page.getByLabel('Line spacing', { exact: true }).selectOption('2');
  await selectAll();
  await page.getByLabel('Paragraph style', { exact: true }).selectOption('normal');
  await assertState('1');
  await save();
  await app.close();
  await launch(true);
  await assertState('1');
  await page.evaluate(() => {
    const editor = document.querySelector('.document-editor').editor;
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', attrs: { lineHeight: '14pt', lineSpacingRule: 'exact' }, content: [{ type: 'text', text: 'Body exact spacing' }] }] });
  });
  await selectAll();
  assert.equal(await page.getByLabel('Line spacing', { exact: true }).inputValue(), '14pt');
  await save();
  await app.close();
  await launch(true);
  assert.equal(await page.getByLabel('Line spacing', { exact: true }).inputValue(), '14pt');
  await selectAll();
  await page.getByLabel('Line spacing', { exact: true }).selectOption('1');
  const attrs = await page.evaluate(() => document.querySelector('.document-editor').editor.getJSON().content[0].attrs);
  assert.equal(attrs.lineHeight, '1');
  assert.equal(attrs.lineSpacingRule, null);
  await save();
  assert.deepEqual(errors, []);
  console.log('PASS: list starts, nested bullets, line spacing, Normal style, repeated save and reopen');
} finally {
  await app?.close();
}
