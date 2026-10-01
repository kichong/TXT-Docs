import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { _electron as electron } from 'playwright';

await mkdir('output/pagination', { recursive: true });
const profile = await mkdtemp(resolve('output/pagination/profile-'));
const packaged = process.argv.includes('--packaged');
const selectedCases = process.argv.slice(2).filter((argument) => argument !== '--packaged');
const application = await electron.launch({
  ...(packaged ? { executablePath: resolve('release/win-unpacked/TXT Docs.exe') } : {}),
  args: [...(packaged ? [] : [resolve('.')]), `--user-data-dir=${profile}`],
});
application.process().stderr?.on('data', (data) => console.error(String(data)));
try {
  const page = await application.firstWindow();
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  const errors = [];
  page.on('pageerror', (error) => { errors.push(error.message); console.log('Renderer error:', error.message); });
  await page.locator('.document-editor').waitFor();
  await page.getByRole('button', { name: 'Customize toolbar', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Page layout', exact: true }).check();
  await page.getByRole('button', { name: 'Close toolbar customization', exact: true }).click();
  const text = 'A long paragraph remains editable across page boundaries. '.repeat(400);
  const paragraph = (value = text) => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });
  const cases = [
    ['long-paragraph', [paragraph()]],
    ['long-table', [{ type: 'table', content: Array.from({ length: 100 }, (_, row) => ({ type: 'tableRow', content: [0, 1].map((column) => ({ type: 'tableCell', content: [paragraph(`Row ${row}, column ${column}.`)] })) })) }]],
    ['tall-table-row', [{ type: 'table', content: [{ type: 'tableRow', content: [paragraph(), paragraph(text.slice(0, 3000))].map((content) => ({ type: 'tableCell', content: [content] })) }] }]],
    ['explicit-columns', [{ type: 'documentSection', attrs: { columns: 2, explicitColumns: true, columnWidthsIn: [3, 3], columnGapIn: 0.5 }, content: [0, 1].map(() => ({ type: 'documentColumn', content: [paragraph()] })) }]],
    ['flowing-columns', [{ type: 'documentSection', attrs: { columns: 2, columnGapIn: 0.5 }, content: [paragraph()] }]],
    ['page-columns', [paragraph()]],
    ['mixed-content', [paragraph(), { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'After the long paragraph' }] }, paragraph('Normal text follows.'), { type: 'documentSection', attrs: { columns: 2, columnGapIn: 0.5 }, content: [paragraph()] }, paragraph('After the columns.')]],
    ['blank-lines', Array.from({ length: 100 }, () => ({ type: 'paragraph' }))],
    ['blank-columns', Array.from({ length: 200 }, () => ({ type: 'paragraph' }))],
  ];
  for (const [name, content] of cases) {
    if (selectedCases.length && !selectedCases.includes(name)) continue;
    const columns = ['page-columns', 'blank-columns'].includes(name) ? 2 : 1;
    if (columns === 2 && await page.getByLabel('Page columns', { exact: true }).isDisabled()) {
      await page.evaluate(() => document.querySelector('.document-editor').editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }));
    }
    if (await page.getByLabel('Page columns', { exact: true }).isEnabled()) {
      await page.getByLabel('Page columns', { exact: true }).selectOption(String(columns));
      await page.waitForFunction((expected) => document.querySelector('.document-editor').editor.extensionManager.extensions.find((extension) => extension.name === 'screenPages').options.page().columns === expected, columns);
    }
    const before = await page.evaluate((content) => {
      const editor = document.querySelector('.document-editor').editor;
      editor.commands.setContent({ type: 'doc', content });
      return JSON.stringify(editor.getJSON());
    }, content);
    await page.waitForFunction(() => {
      const paper = document.querySelector('.paper');
      const editor = document.querySelector('.document-editor').editor;
      return paper.dataset.paginationPending === 'false' && Number(paper.dataset.paginationSize) === editor.state.doc.content.size && Number(paper.dataset.pageCount) > 1;
    }, null, { polling: 100 }).catch(async (error) => {
      console.log(await page.evaluate(() => {
        const root = document.querySelector('.document-editor');
        const paper = document.querySelector('.paper');
        return { count: paper.dataset.pageCount, height: paper.style.height, rootHeight: root.style.height, columns: getComputedStyle(root).columnCount, children: root.children.length, settings: root.editor.extensionManager.extensions.find((extension) => extension.name === 'screenPages').options.page(), nodes: root.editor.state.doc.content.childCount };
      }));
      await page.screenshot({ path: resolve(`output/pagination/${name}-error.png`) });
      throw error;
    });
    await page.waitForTimeout(500);
    assert.deepEqual(errors, [], `${name}: renderer must remain free of errors`);
    const report = await page.evaluate(() => {
      const root = document.querySelector('.document-editor');
      const paper = document.querySelector('.paper');
      const scale = paper.getBoundingClientRect().width / paper.offsetWidth;
      const origin = paper.getBoundingClientRect().top;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let violations = 0;
      const badLines = [];
      let measured = 0;
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (!text.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(text);
        for (const rect of range.getClientRects()) {
          const top = (rect.top - origin) / scale;
          const bottom = (rect.bottom - origin) / scale;
          const within = top % 1080;
          if (within < 94 || within + bottom - top > 962) { violations++; badLines.push({ top, bottom }); }
          measured++;
        }
      }
      return { violations, badLines, measured, pages: paper.dataset.pageCount, content: JSON.stringify(root.editor.getJSON()), html: root.editor.getHTML(), widgets: root.querySelectorAll('.screen-page-gap').length };
    });
    console.log(name, report.pages, 'pages;', report.widgets, 'line gaps;', report.violations, 'margin violations');
    if (report.violations) console.log(report.badLines.slice(0, 8));
    assert.equal(report.content, before, `${name}: pagination must not change document data`);
    assert.ok(!report.html.includes('screen-page-gap') && !report.html.includes('data-screen-pagination'), `${name}: export must omit screen pagination`);
    assert.equal(report.violations, 0, `${name}: text must stay inside page margins`);
    await page.getByText(new RegExp(`Page \\d+ of ${report.pages}$`)).waitFor();
    const pdfPath = resolve(`output/pagination/${name}.pdf`);
    await application.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, pdfPath);
    await page.evaluate(() => {
      const editor = document.querySelector('.document-editor').editor;
      return window.documentsApi.saveDocumentAs({ document: {
        schemaVersion: 1, title: 'Pagination fixture', content: editor.getJSON(),
        page: editor.extensionManager.extensions.find((extension) => extension.name === 'screenPages').options.page(), comments: [], compatibilityIssues: [],
      }, printHtml: editor.getHTML() });
    });
    const printedPages = (await readFile(pdfPath)).toString('latin1').match(/\/Type\s*\/Page\b/g)?.length;
    console.log(name, 'PDF:', printedPages, 'pages');
    assert.equal(Number(report.pages), printedPages, `${name}: editor and PDF page counts must agree`);
    await page.evaluate(() => { document.querySelector('.canvas-scroll').scrollTop = 900; });
    await page.screenshot({ path: resolve(`output/pagination/${name}.png`) });
    await page.evaluate(() => document.querySelector('.document-editor').editor.commands.focus('end'));
    await page.keyboard.insertText(' Editing across pages.');
    await page.keyboard.press('Control+z');
    await page.waitForFunction((expected) => JSON.stringify(document.querySelector('.document-editor').editor.getJSON()) === expected, before);
    if (report.widgets) {
      await page.evaluate(() => {
        const editor = document.querySelector('.document-editor').editor;
        const plugin = editor.state.plugins.find((plugin) => plugin.key.startsWith('screenPages'));
        const boundary = plugin.getState(editor.state).find().find((decoration) => decoration.spec.key?.startsWith('page:'));
        editor.commands.setTextSelection(boundary.from - 2);
        editor.commands.focus();
      });
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.insertText('Text entered at the page boundary. ');
      await page.waitForTimeout(100);
      await page.keyboard.press('Control+z');
      await page.waitForFunction((expected) => JSON.stringify(document.querySelector('.document-editor').editor.getJSON()) === expected, before);
    }
    assert.deepEqual(errors, [], `${name}: editing must remain free of renderer errors`);
  }
  await page.evaluate(() => document.querySelector('.document-editor').editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }));
  await page.waitForFunction(() => document.querySelector('.paper').dataset.pageCount === '1');
  await page.getByText('Page 1 of 1', { exact: true }).waitFor();
  console.log('PASS: paragraphs, tables, tall cells, columns, serialization, and undo.');
} finally { await application.evaluate(({ app }) => app.exit(0)).catch(() => {}); await application.close().catch(() => {}); }
