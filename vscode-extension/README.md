# Markdown Writer Tools — VS Code Extension

Brings the [`mdwt`](../README.md) CLI engine into VS Code. Compose large Markdown
documents from snippets and run the same operations on the file in the active editor.

The extension reuses the engine in [`../src/mdwt`](../src/mdwt) directly (the engine
relies only on Node built-ins), so behaviour is identical to the CLI. It is bundled
with esbuild at package time, so the published `.vsix` is fully self-contained.

## Commands

Available from the Command Palette and the editor right-click menu (under
**Markdown Writer Tools**) when a Markdown file is active:

| Command | Description |
| --- | --- |
| **Export to Clipboard** | Render the document (resolve includes, variables, conditionals, lists) and copy the result to the clipboard. |
| **Build (resolve includes in place)** | Render the document and replace the editor contents with the result. Equivalent to `mdwt build`. |
| **Prebuild (expand includes, keep directives)** | Expand includes while keeping `{!var(...)!}` and list directives. Equivalent to `mdwt prebuild`. |
| **Export Lists as CSV** | Export every list in the document to CSV files next to the source. Equivalent to `mdwt export-list -f csv`. |
| **Export Lists as JSON** | Export every list in the document to JSON files. Equivalent to `mdwt export-list -f json`. |

`Build` and `Prebuild` apply the result as an editor edit (undoable with `Cmd/Ctrl+Z`)
rather than writing directly to disk. The active file is saved before rendering so the
on-disk content the engine reads matches what you see.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `mdwt.clipboard.img2b64` | `true` | Convert local images to base64 data URIs when copying to the clipboard. |
| `mdwt.clipboard.stripheaders` | `true` | Strip the leading front-matter (`---`) block when copying to the clipboard. |
| `mdwt.clipboard.stripcomments` | `false` | Remove HTML comments when copying to the clipboard. |
| `mdwt.build.img2b64` | `false` | Convert local images to base64 when running Build/Prebuild. |
| `mdwt.build.stripheaders` | `false` | Strip the front-matter block when running Build. |
| `mdwt.build.stripcomments` | `false` | Remove HTML comments when running Build. |

The clipboard defaults match the requested behaviour: `img2b64: true`,
`stripheaders: true`.

## Development

```bash
cd vscode-extension
npm install
npm run watch      # rebuild on change (esbuild)
```

Then press `F5` (Run Extension) to launch an Extension Development Host with the
extension loaded. Open a Markdown file and try the commands.

### Package a .vsix

```bash
npm install -g @vscode/vsce   # once
npm run package               # produces out/extension.js via esbuild
vsce package                  # produces mdwritertools-vscode-<version>.vsix
```
