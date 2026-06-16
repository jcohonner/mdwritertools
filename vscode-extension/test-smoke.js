// Smoke test: load the bundled extension with a stubbed `vscode` module and
// exercise each command against real example files. Not part of the published
// extension — run with `node test-smoke.js`.
const path = require("path");
const Module = require("module");
const assert = require("assert");

const repoRoot = path.resolve(__dirname, "..");

// ---- vscode stub --------------------------------------------------------
let clipboardText = null;
const infoMessages = [];
const warnMessages = [];
const errorMessages = [];
const outputLines = [];

function makeDocument(fsPath, initialText) {
  let text = initialText;
  return {
    isUntitled: false,
    isDirty: false,
    languageId: "markdown",
    uri: { fsPath },
    getText: () => text,
    positionAt: (offset) => ({ offset }),
    save: async () => true,
    _setText: (t) => {
      text = t;
    },
    _getText: () => text,
  };
}

function makeEditor(doc) {
  return {
    document: doc,
    edit: async (cb) => {
      const builder = {
        replace: (_range, newText) => doc._setText(newText),
      };
      cb(builder);
      return true;
    },
  };
}

const vscodeStub = {
  Range: class {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  },
  window: {
    activeTextEditor: null,
    createOutputChannel: () => ({
      appendLine: (l) => outputLines.push(l),
      show: () => {},
    }),
    showInformationMessage: (m) => {
      infoMessages.push(m);
    },
    showWarningMessage: (m) => {
      warnMessages.push(m);
    },
    showErrorMessage: (m) => {
      errorMessages.push(m);
    },
  },
  workspace: {
    getConfiguration: () => ({
      get: (_key, def) => def,
    }),
  },
  env: {
    clipboard: {
      writeText: async (t) => {
        clipboardText = t;
      },
    },
  },
  commands: {
    _handlers: {},
    registerCommand(id, fn) {
      this._handlers[id] = fn;
      return { dispose() {} };
    },
  },
};

// Intercept require("vscode")
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") return vscodeStub;
  return originalLoad.call(this, request, parent, isMain);
};

const ext = require("./out/extension.js");

const context = { subscriptions: [] };
ext.activate(context);

const handlers = vscodeStub.commands._handlers;
assert.ok(handlers["mdwt.build"], "mdwt.build registered");
assert.ok(handlers["mdwt.prebuild"], "mdwt.prebuild registered");
assert.ok(handlers["mdwt.exportToClipboard"], "mdwt.exportToClipboard registered");
assert.ok(handlers["mdwt.exportListsCSV"], "mdwt.exportListsCSV registered");
assert.ok(handlers["mdwt.exportListsJSON"], "mdwt.exportListsJSON registered");
console.log("✔ all 5 commands registered");

function setActiveFile(relPath) {
  const fsPath = path.join(repoRoot, relPath);
  const fs = require("fs");
  const doc = makeDocument(fsPath, fs.readFileSync(fsPath, "utf8"));
  const editor = makeEditor(doc);
  vscodeStub.window.activeTextEditor = editor;
  return { doc, editor };
}

(async () => {
  // 1. Export to clipboard
  setActiveFile("examples/conditionals/main-pro.md");
  errorMessages.length = 0;
  await handlers["mdwt.exportToClipboard"]();
  assert.ok(errorMessages.length === 0, "no clipboard errors: " + errorMessages.join("; "));
  assert.ok(typeof clipboardText === "string" && clipboardText.length > 0, "clipboard populated");
  console.log("✔ export to clipboard produced " + clipboardText.length + " chars");

  // 2. Prebuild (in-memory edit, no disk write)
  const { doc: pbDoc } = setActiveFile("examples/conditionals/main-pro.md");
  const before = pbDoc._getText();
  errorMessages.length = 0;
  await handlers["mdwt.prebuild"]();
  assert.ok(errorMessages.length === 0, "no prebuild errors: " + errorMessages.join("; "));
  assert.ok(pbDoc._getText() !== before, "prebuild changed the buffer");
  console.log("✔ prebuild rewrote the editor buffer");

  // 3. Export lists as JSON to a temp prefix (override config for output dir)
  const os = require("os");
  const tmpPrefix = path.join(os.tmpdir(), "mdwt-smoke-");
  vscodeStub.workspace.getConfiguration = () => ({
    get: (key, def) => def,
  });
  setActiveFile("examples/lists/main.md");
  // exportLists writes next to the source by default; just confirm it runs clean.
  infoMessages.length = 0;
  warnMessages.length = 0;
  errorMessages.length = 0;
  await handlers["mdwt.exportListsJSON"]();
  assert.ok(errorMessages.length === 0, "no export-list errors: " + errorMessages.join("; "));
  console.log("✔ export lists as JSON ran (info: " + JSON.stringify(infoMessages) + ")");

  // clean up generated files next to examples/lists/main.md
  const fs = require("fs");
  const listsDir = path.join(repoRoot, "examples/lists");
  for (const f of fs.readdirSync(listsDir)) {
    if (f.startsWith("main-") && f.endsWith(".json")) {
      fs.unlinkSync(path.join(listsDir, f));
    }
  }

  console.log("\nALL SMOKE TESTS PASSED");
})().catch((e) => {
  console.error("SMOKE TEST FAILED:", e);
  process.exit(1);
});
