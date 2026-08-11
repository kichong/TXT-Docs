# TXT Docs

TXT Docs is a local-first Windows word processor for everyday DOCX, Markdown, and plain-text work. It provides a focused paper editor, familiar formatting controls, native Open/Save/Print flows, PDF output, crash recovery, and explicit compatibility notices when a Word file contains features outside the v1 editing model.

## V1 features

- Create, open, edit, and save `.docx`, `.txt`, and `.md`
- Open supported documents directly from Windows **Open with** and reuse the existing app window
- Save As `.docx`, `.pdf`, `.txt`, or `.md` from one native format picker
- Find text with `Ctrl+F`, match counts, next/previous navigation, and highlighted results
- Paste with source formatting (default), merged formatting, or text only
- Fonts, sizes, title and heading styles, basic color palettes, highlights, inline formatting, alignment, spacing, lists, and indentation
- Links, images, simple resizable tables, page breaks, and Word-compatible multi-section layouts with equal or unequal columns
- Native printing and clean, cursor-free Letter-size PDF output
- Resizable document outline and compact four-action file toolbar
- Recent documents and local crash recovery
- Visible app version, automatic update checks, download progress, and restart-to-update through GitHub Releases
- Optional legacy `.doc` import through an installed LibreOffice converter
- Complete light and dark themes, including the editor paper and form controls
- Theme-aware text and highlight previews that preserve saved colors while maintaining readable contrast
- Persistent toolbar customization with movable or hidden tool chunks, optional Paste/Page layout controls, collapse/reset actions, and adjustable heading defaults

Markdown and plain-text files use a deliberately unformatted editing mode so their source text stays literal and portable. Saving a rich document as `.txt` or `.md` flattens it to plain text.

Advanced Word structures such as comments, tracked changes, macros, content controls, equations, complex headers/footers, and floating objects are detected but are not losslessly round-tripped in v1. TXT Docs recommends **Save As** when those features are present.

## Development

This project uses Node.js, pnpm, Electron, React, TypeScript, Tiptap, and the `docx` OOXML generator.

```powershell
pnpm install
pnpm start
```

Run validation:

```powershell
pnpm check
pnpm build
```

Create Windows distributables:

```powershell
pnpm make
```

Installer output is written to `release/`.

## Releases and updates

TXT Docs uses GitHub Releases as its public update feed. A tagged release is built and validated on a clean Windows runner, then published with the NSIS installer and the update metadata consumed by `electron-updater`.

1. Update the version in `package.json` and commit it.
2. Tag that commit with the matching version, such as `v0.3.0`.
3. Push the tag. The **Release TXT Docs** GitHub Actions workflow runs the checks, builds the installer, uploads the release assets, and publishes the completed release.

Installed builds check for updates shortly after launch and every six hours while running. Downloads require user confirmation, and TXT Docs asks the user to save before restarting to install. The current Windows installer is not code-signed, so Windows SmartScreen may warn on the initial download.

## License

TXT Docs is available under the [Apache License 2.0](LICENSE).
