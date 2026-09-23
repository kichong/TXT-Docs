# Repository workflow

- When asked to fix an open GitHub issue, complete the delivery flow unless the user says otherwise: implement and test the fix, update the patch version, commit with a GitHub closing keyword, push the default branch, publish the normal release artifacts, and verify that the issue closed.
- Keep compatibility reports privacy-safe. Never include filenames, paths, document text, comments, authors, document metadata, or other user content in issue URLs or reports.

## Start here

- This repository is **TXT Docs**. The sibling `TXT-sheets` checkout is a separate app; check the working directory before editing or releasing.
- Read `README.md` for supported formats and user behavior, then inspect the owner files below. Use `rg` to locate a feature before opening the large renderer or import/export files.
- Keep this component map current: whenever a file or folder is added, moved, renamed, or given a new responsibility, update the relevant route here in the same change. Remove stale routes.

## Component map and edit routes

| Task | Start here | Also inspect |
| --- | --- | --- |
| Editor UI, toolbar, page layout, save/close flow | `src/renderer/App.tsx`, `src/renderer/styles.css` | `src/renderer/extensions.ts`, `src/renderer/toolbar-preferences.ts`, `src/renderer/color-contrast.ts` |
| Rich text behavior, find, Tiptap schema | `src/renderer/extensions.ts`, `src/renderer/search-extension.ts` | `src/shared/types.ts`, relevant `tests/` |
| DOCX fidelity and comments | `src/main/docx/importer.ts`, `src/main/docx/exporter.ts` | `src/shared/types.ts`, `tests/docx-roundtrip.test.ts` |
| Plain text, Markdown, legacy `.doc` | `src/shared/plain-text.ts`, `src/main/legacy-converter.ts` | `src/main.ts`, `tests/plain-text.test.ts` |
| File lifecycle, recent files, recovery, launch files | `src/main.ts`, `src/main/storage.ts`, `src/main/launch-files.ts` | `src/preload.ts`, `src/shared/schemas.ts`, `tests/storage.test.ts` |
| Electron API / IPC contract | `src/main.ts`, `src/preload.ts`, `src/shared/types.ts`, `src/shared/schemas.ts` | `src/global.d.ts` |
| Updates and releases | `src/main/updater.ts`, `src/shared/updates.ts`, `package.json` | `.github/workflows/release.yml`, `tests/updates.test.ts` |
| Compatibility reporting | `src/shared/compatibility-report.ts` | `src/main.ts`, `tests/compatibility-report.test.ts` |

`src/renderer.tsx` mounts the React app. `vite.main.config.ts`, `vite.preload.config.ts`, and `vite.renderer.config.ts` build its three processes. `tests/` holds focused checks; `scripts/` holds build helpers. Treat `dist/`, `release/`, and `node_modules/` as generated output.

## Change workflow

1. Trace the full path of the requested behavior through renderer, preload, main process, shared types, persistence, and file conversion as applicable. Preserve existing local files, format compatibility, undo, recovery, and user-visible behavior.
2. When fixing, updating, or optimizing a feature, inspect its related and adjacent functions for the same defect, duplicated logic, or a safe improvement that would make the app work better. Make small, clearly connected improvements when they can be validated in the same change; report larger ideas separately. Do not expand into unrelated redesigns.
3. Add focused tests at the relevant boundary, especially for import/export and persisted data. Test existing documents and round trips before changing serialization. Keep runtime-only UI state out of document data.
4. Run `pnpm check` and `pnpm build`; for interaction changes, exercise the actual Electron UI and keyboard/focus flow. For releases, validate the packaged app and published installer/update assets as well.
5. Before a release, check `package.json`, `.github/workflows/release.yml`, and the current Git state. Follow the issue delivery rule above when it applies. Do not claim a release is complete from a local build alone.
