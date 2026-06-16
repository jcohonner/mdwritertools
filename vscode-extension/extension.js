const vscode = require("vscode");

// The mdwt engine is dependency-free (Node built-ins only). esbuild inlines it
// into out/extension.js at package time, so the .vsix is fully self-contained.
const mdwt = require("../src/mdwt");

let outputChannel;

function getOutputChannel() {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Markdown Writer Tools");
  }
  return outputChannel;
}

/**
 * Resolve the active editor to a saved, on-disk Markdown file.
 * The engine reads from disk, so we save first to keep buffer and disk in sync.
 */
async function getActiveMarkdownTarget() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage(
      "Markdown Writer Tools: open a Markdown file first."
    );
    return null;
  }

  const doc = editor.document;
  if (doc.isUntitled) {
    vscode.window.showErrorMessage(
      "Markdown Writer Tools: save the file to disk before running this command."
    );
    return null;
  }

  if (doc.languageId !== "markdown" && !/\.mdx?$/i.test(doc.uri.fsPath)) {
    vscode.window.showErrorMessage(
      "Markdown Writer Tools: the active file is not a Markdown document."
    );
    return null;
  }

  if (doc.isDirty) {
    await doc.save();
  }

  return { editor, doc, fsPath: doc.uri.fsPath };
}

/**
 * Run a (synchronous) engine call while redirecting console output to our
 * output channel, so the engine's progress/error logging is visible to the user.
 * Returns { result, lines }.
 */
function captureConsole(fn) {
  const channel = getOutputChannel();
  const originalLog = console.log;
  const originalError = console.error;
  const lines = [];

  const sink = (...args) => {
    const text = args.map((a) => String(a)).join(" ");
    lines.push(text);
    channel.appendLine(text);
  };

  console.log = sink;
  console.error = sink;

  let result;
  try {
    result = fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return { result, lines };
}

/**
 * Surface engine errors collected on mdwt.errors after a run.
 * Returns true when the run was clean.
 */
function hadEngineErrors(actionLabel) {
  const errors = Array.isArray(mdwt.errors) ? mdwt.errors : [];
  if (errors.length) {
    getOutputChannel().show(true);
    vscode.window.showWarningMessage(
      `Markdown Writer Tools: ${actionLabel} completed with ${errors.length} issue(s). See the "Markdown Writer Tools" output for details.`
    );
    return true;
  }
  return false;
}

async function replaceDocumentText(editor, text) {
  const doc = editor.document;
  const fullRange = new vscode.Range(
    doc.positionAt(0),
    doc.positionAt(doc.getText().length)
  );
  await editor.edit((builder) => builder.replace(fullRange, text));
}

function clipboardOptions() {
  const cfg = vscode.workspace.getConfiguration("mdwt");
  return {
    img2b64: cfg.get("clipboard.img2b64", true),
    stripheaders: cfg.get("clipboard.stripheaders", true),
    stripcomments: cfg.get("clipboard.stripcomments", false),
  };
}

function buildOptions() {
  const cfg = vscode.workspace.getConfiguration("mdwt");
  return {
    img2b64: cfg.get("build.img2b64", false),
    stripheaders: cfg.get("build.stripheaders", false),
    stripcomments: cfg.get("build.stripcomments", false),
  };
}

async function runBuild() {
  const target = await getActiveMarkdownTarget();
  if (!target) return;

  try {
    const { result } = captureConsole(() =>
      mdwt.renderDocument(target.fsPath, buildOptions())
    );
    await replaceDocumentText(target.editor, result);
    if (!hadEngineErrors("Build")) {
      vscode.window.showInformationMessage(
        "Markdown Writer Tools: Build complete (includes resolved in place — review and save)."
      );
    }
  } catch (error) {
    getOutputChannel().show(true);
    vscode.window.showErrorMessage(
      `Markdown Writer Tools: Build failed — ${error.message}`
    );
  }
}

async function runPrebuild() {
  const target = await getActiveMarkdownTarget();
  if (!target) return;

  const cfg = vscode.workspace.getConfiguration("mdwt");
  const options = {
    img2b64: cfg.get("build.img2b64", false),
    stripheaders: cfg.get("build.stripheaders", false),
  };

  try {
    const { result } = captureConsole(() =>
      mdwt.renderPrebuildDocument(target.fsPath, options)
    );
    await replaceDocumentText(target.editor, result);
    if (!hadEngineErrors("Prebuild")) {
      vscode.window.showInformationMessage(
        "Markdown Writer Tools: Prebuild complete (includes expanded, directives kept — review and save)."
      );
    }
  } catch (error) {
    getOutputChannel().show(true);
    vscode.window.showErrorMessage(
      `Markdown Writer Tools: Prebuild failed — ${error.message}`
    );
  }
}

async function runExportToClipboard() {
  const target = await getActiveMarkdownTarget();
  if (!target) return;

  try {
    const { result } = captureConsole(() =>
      mdwt.renderDocument(target.fsPath, clipboardOptions())
    );
    await vscode.env.clipboard.writeText(result);
    if (!hadEngineErrors("Export to clipboard")) {
      vscode.window.showInformationMessage(
        "Markdown Writer Tools: rendered Markdown copied to clipboard."
      );
    }
  } catch (error) {
    getOutputChannel().show(true);
    vscode.window.showErrorMessage(
      `Markdown Writer Tools: Export to clipboard failed — ${error.message}`
    );
  }
}

async function runExportLists(format) {
  const target = await getActiveMarkdownTarget();
  if (!target) return;

  const label = `Export lists (${format.toUpperCase()})`;
  try {
    const { lines } = captureConsole(() =>
      mdwt.exportLists(target.fsPath, { format, all: true })
    );

    const exported = lines.filter((line) => line.startsWith("Exported"));
    getOutputChannel().show(true);

    if (hadEngineErrors(label)) {
      return;
    }

    if (!exported.length) {
      vscode.window.showWarningMessage(
        "Markdown Writer Tools: no lists found in this document."
      );
      return;
    }

    vscode.window.showInformationMessage(
      `Markdown Writer Tools: exported ${exported.length} list(s) as ${format.toUpperCase()}. See output for file paths.`
    );
  } catch (error) {
    getOutputChannel().show(true);
    vscode.window.showErrorMessage(
      `Markdown Writer Tools: ${label} failed — ${error.message}`
    );
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("mdwt.build", runBuild),
    vscode.commands.registerCommand("mdwt.prebuild", runPrebuild),
    vscode.commands.registerCommand("mdwt.exportToClipboard", runExportToClipboard),
    vscode.commands.registerCommand("mdwt.exportListsCSV", () =>
      runExportLists("csv")
    ),
    vscode.commands.registerCommand("mdwt.exportListsJSON", () =>
      runExportLists("json")
    )
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
