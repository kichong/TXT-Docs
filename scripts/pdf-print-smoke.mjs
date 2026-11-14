import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const directory = await mkdtemp(join(tmpdir(), 'txt-docs-pdf-print-'));
const packaged = process.argv.includes('--packaged');
const app = await electron.launch({ ...(packaged ? { executablePath: resolve('release/win-unpacked/TXT Docs.exe') } : {}), args: [...(packaged ? [] : [resolve('.')]), `--user-data-dir=${join(directory, 'profile')}`] });
try {
  await app.evaluate(({ app, dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 });
    globalThis.outputReports = [];
    app.on('web-contents-created', (_event, contents) => {
      const pdf = contents.printToPDF.bind(contents);
      contents.printToPDF = async (options) => {
        globalThis.outputReports.push({ kind: 'pdf', options, text: await contents.executeJavaScript('document.body.innerText') });
        return pdf(options);
      };
      contents.print = (options, callback) => { globalThis.outputReports.push({ kind: 'print', options }); callback(false, 'cancelled'); };
    });
  });
  const page = await app.firstWindow(); page.setDefaultTimeout(15_000);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('.document-editor').waitFor();
  await page.evaluate(() => {
    const editor = document.querySelector('.document-editor').editor;
    editor.commands.setContent('<h1>PDF and print review</h1><p><strong>Bold text</strong> and regular body text.</p><ol><li><p>First item</p></li><li><p>Second item</p></li></ol><table><tr><th>Item</th><th>Value</th></tr><tr><td>Example</td><td>42</td></tr></table><div data-page-break="true"></div><h2>Second page</h2><p>LAST_PAGE_MARKER</p>');
  });
  const before = await page.locator('.document-editor').evaluate((node) => JSON.stringify(node.editor.getJSON()));
  const pdfPath = join(directory, 'document.pdf');
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async (_owner, options) => { globalThis.pdfDialog = options; return { canceled: false, filePath: path }; }; }, pdfPath);
  await page.getByRole('button', { name: 'Save as PDF', exact: true }).click();
  await page.getByText(/Saved document.pdf/u).waitFor();
  const bytes = await readFile(pdfPath); assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.equal((bytes.toString('latin1').match(/\/Type\s*\/Page\b/gu) ?? []).length, 2, await page.locator('.document-editor').evaluate((node) => node.editor.getHTML()));
  const options = await app.evaluate(() => globalThis.pdfDialog);
  assert.match(options.defaultPath, /\.pdf$/u); assert.deepEqual(options.filters[0].extensions, ['pdf']);
  assert.equal(await page.locator('.document-editor').evaluate((node) => JSON.stringify(node.editor.getJSON())), before);
  assert.equal(await page.locator('.save-state').innerText(), 'Unsaved');
  assert.match(await page.evaluate(async () => { try { await window.documentsApi.installUpdate(null); return ''; } catch (error) { return error.message; } }), /Save all open documents/u);
  await page.getByRole('button', { name: 'Print document', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.save-state').textContent === 'Unsaved');
  const print = await app.evaluate(() => globalThis.outputReports.find((entry) => entry.kind === 'print'));
  assert.equal(print.options.silent, false); assert.equal(print.options.printBackground, true);
  assert.match((await app.evaluate(() => globalThis.outputReports.find((entry) => entry.kind === 'pdf'))).text, /LAST_PAGE_MARKER/u);
  await page.locator('.document-editor').click(); await page.keyboard.press('Control+p');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await app.evaluate(() => globalThis.outputReports.filter((entry) => entry.kind === 'print').length) >= 2) break;
    await page.waitForTimeout(50);
  }
  await page.waitForFunction(() => document.querySelector('.save-state').textContent === 'Unsaved');
  assert.equal(await app.evaluate(() => globalThis.outputReports.filter((entry) => entry.kind === 'print').length), 2);
  const columnsPath = join(directory, 'columns.pdf');
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, columnsPath);
  await page.evaluate(() => {
    const editor = document.querySelector('.document-editor').editor;
    return window.documentsApi.saveDocumentAs({ exportPdf: true, printHtml: editor.getHTML(), document: {
      schemaVersion: 1, title: 'Column print review', content: editor.getJSON(), comments: [], compatibilityIssues: [],
      page: { size: 'letter', orientation: 'portrait', columns: 2, columnGapIn: 0.5, marginsIn: { top: 1, right: 1, bottom: 1, left: 1 } },
    } });
  });
  assert.equal(((await readFile(columnsPath)).toString('latin1').match(/\/Type\s*\/Page\b/gu) ?? []).length, 2);
  await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
  await page.getByRole('button', { name: 'Save as PDF', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.save-state').textContent === 'Unsaved');
  assert.equal(await page.locator('.document-editor').evaluate((node) => JSON.stringify(node.editor.getJSON())), before);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(directory, 'editor.png') });
  console.log('Direct PDF export, rich text, explicit page breaks, native print cancellation, and unsaved-document preservation passed.');
  console.log(directory);
} finally { await app.close(); }
