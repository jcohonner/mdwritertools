# Markdown Writer Tools

Markdown Writer Tools helps you compose large Markdown documents from smaller snippets.  
It understands custom directives so you can include files, reuse sections, and substitute variables before exporting the final result or rewriting the source in place.

## Features

- `{!include(...)!}` directives with optional section filtering and heading level adjustment.
- Variables defined in YAML front‑matter and referenced with `{!var(name)!}` inside included files.
- CLI commands to export to a new file or run a destructive build that replaces the source.
- Optional `--skipheaders` flag to remove the leading front‑matter like block from the final output.

## Installation

- Local development: `npm link`
- Global install: `npm install -g @jcohonner/mdwritertools`

Once linked or installed, the CLI is available as `mdwt`.

## Usage

### Export

```
mdwt export path/to/doc.md -o dist/output.md [--skipheaders]
```

Reads the entry Markdown file, resolves includes and variables, and writes the result to the specified output (stdout if omitted).

### Export to clipboard

```
mdwt export path/to/doc.md -o clipboard [--skipheaders]
```

Reads the entry Markdown file, resolves includes and variables, and copies the result to the system clipboard.

### Build (in-place)

```
mdwt build path/to/doc.md [--skipheaders]
```

Resolves directives and writes the rendered content back to the same file. Useful when you need the source file without include directives.

## Directive Reference

### Include

```
{!include(relative/or/absolute/path.md|# Section Heading|###)}
```

- Only the path is required.
- Provide a `Section Heading` that matches a Markdown heading to include just that section.
- Optionally set a target heading level (e.g., `###`) to rebase heading levels in the snippet.

### Variables

Define variables in YAML front-matter like block:

```yaml
---
product: MDWriterTools
---
```

Use in content with `{!var(product)!}`. Variables cascade through includes, so definitions in a parent file are available in children.

## Development

1. Clone the repo and run `npm install`.
2. Link the CLI locally with `npm link`.
3. Run `mdwt export ...` or `mdwt build ...` while editing your docs.

Feel free to adapt the CLI to add new directives or automation that fits your documentation workflow.
