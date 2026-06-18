const assert = require("assert");
const fs = require("fs");
const path = require("path");

const mdwt = require("../src/mdwt");

function renderBody(entry) {
  const absoluteEntry = path.resolve(__dirname, "..", entry);
  const { content } = mdwt.processFile(absoluteEntry, [], {}, false, null);
  return content.trim();
}

function renderDocument(entry) {
  const absoluteEntry = path.resolve(__dirname, "..", entry);
  return mdwt.renderDocument(absoluteEntry).trim();
}

function renderDocumentWithOptions(options) {
  return (entry) => {
    const absoluteEntry = path.resolve(__dirname, "..", entry);
    return mdwt.renderDocument(absoluteEntry, options).trim();
  };
}

function renderPrebuildDocument(entry) {
  const absoluteEntry = path.resolve(__dirname, "..", entry);
  return mdwt.renderPrebuildDocument(absoluteEntry).trim();
}

function serializeList(entry, listName, format) {
  const absoluteEntry = path.resolve(__dirname, "..", entry);
  const { lists, listsConfig } = mdwt.collectListsFromDocument(absoluteEntry);
  const config = listsConfig[listName] || {};
  const items = lists[listName] || [];
  const columns = mdwt.resolveExportColumns(items, config.columns);
  return format === "json"
    ? mdwt.serializeListJSON(items, columns).trim()
    : mdwt.serializeListCSV(items, columns).trim();
}

const cases = [
  {
    name: "keeps Pro sections and ignores lower-level overrides",
    entry: "examples/conditionals/main-pro.md",
    expected: "tests/expected/conditionals/main-pro.md",
  },
  {
    name: "keeps Community sections when entry file requests it",
    entry: "examples/conditionals/main-community.md",
    expected: "tests/expected/conditionals/main-community.md",
  },
  {
    name: "uses default branches when edition is unknown",
    entry: "examples/conditionals/main-unknown.md",
    expected: "tests/expected/conditionals/main-unknown.md",
  },
  {
    name: "collects list items and renders backlog table with path links",
    entry: "examples/lists/main.md",
    expected: "tests/expected/lists/main.md",
  },
  {
    name: "continues when include is missing and adds marker",
    entry: "examples/includes/missing.md",
    expected: "tests/expected/includes/missing.md",
  },
  {
    name: "cascades heading shifts through nested includes",
    entry: "examples/includes/cascade-a.md",
    expected: "tests/expected/includes/cascade.md",
  },
  {
    name: "applies target shift when intermediate include has no heading",
    entry: "examples/includes/offset-none-a.md",
    expected: "tests/expected/includes/offset-none.md",
  },
  {
    name: "updates entry front matter with collected variables",
    entry: "examples/conditionals/main-pro.md",
    expected: "tests/expected/conditionals/main-pro-document.md",
    renderer: renderDocument,
  },
  {
    name: "merges list variables across includes and matches list conditionals",
    entry: "examples/variables/list-merge.md",
    expected: "tests/expected/variables/list-merge.md",
  },
  {
    name: "renders merged list variables in entry front matter",
    entry: "examples/variables/list-merge.md",
    expected: "tests/expected/variables/list-merge-document.md",
    renderer: renderDocument,
  },
  {
    name: "preserves front matter key order, nested mappings and list order while appending new variables",
    entry: "tests/fixtures/front-matter-order.md",
    expected: "tests/expected/front-matter-order.md",
    renderer: renderDocument,
  },
  {
    name: "resolves nested front matter via dotted notation in var() and conditionals",
    entry: "tests/fixtures/dotted-vars.md",
    expected: "tests/expected/dotted-vars.md",
    renderer: renderDocument,
  },
  {
    name: "deep-merges nested mappings split across entry and includes for dotted lookup",
    entry: "tests/fixtures/dotted-merge.md",
    expected: "tests/expected/dotted-merge.md",
    renderer: renderDocument,
  },
  {
    name: "strips HTML comments outside fenced code blocks",
    entry: "tests/fixtures/comments.md",
    expected: "tests/expected/comments.md",
    renderer: renderDocumentWithOptions({ stripcomments: true }),
  },
  {
    name: "prebuild expands includes while preserving vars, comments and list directives",
    entry: "tests/fixtures/prebuild.md",
    expected: "tests/expected/prebuild.md",
    renderer: renderPrebuildDocument,
  },
  {
    name: "export-list: serializes list as CSV with column config and name override",
    entry: "tests/fixtures/export-list.md",
    expected: "tests/expected/export-list-backlog.csv",
    renderer: (entry) => serializeList(entry, "backlog", "csv"),
  },
  {
    name: "export-list: serializes list as JSON with column config",
    entry: "tests/fixtures/export-list.md",
    expected: "tests/expected/export-list-backlog.json",
    renderer: (entry) => serializeList(entry, "backlog", "json"),
  },
  {
    name: "export-list: serializes list as CSV with column config but no name override",
    entry: "tests/fixtures/export-list.md",
    expected: "tests/expected/export-list-notes.csv",
    renderer: (entry) => serializeList(entry, "notes", "csv"),
  },
  {
    name: "export-list: serializes list as CSV with auto-derived columns when no config",
    entry: "tests/fixtures/export-list.md",
    expected: "tests/expected/export-list-misc.csv",
    renderer: (entry) => serializeList(entry, "misc", "csv"),
  },
  {
    name: "build: renders inline list items as paragraphs from front matter template",
    entry: "tests/fixtures/inline-list.md",
    expected: "tests/expected/inline-list.md",
    renderer: renderDocumentWithOptions({ stripheaders: true }),
  },
];

function loadExpected(expectedPath) {
  const absolute = path.resolve(__dirname, "..", expectedPath);
  return fs.readFileSync(absolute, "utf8").trim();
}

function captureConsoleError(fn) {
  const originalError = console.error;
  let output = "";

  console.error = (...args) => {
    output += `${args.join(" ")}\n`;
  };

  try {
    fn();
  } finally {
    console.error = originalError;
  }

  return output;
}

function run() {
  cases.forEach(({ name, entry, expected, renderer }) => {
    const render = renderer || renderBody;
    const output = render(entry);
    const expectedContent = loadExpected(expected);
    assert.strictEqual(
      output,
      expectedContent,
      `${name} did not match expected output`
    );
    process.stdout.write(`✔ ${name}\n`);
  });

  runErrorCases();

  process.stdout.write("All tests passed.\n");
}

function runErrorCases() {
  const base = path.resolve(__dirname, "..");
  const undefinedVarEntry = path.join(base, "tests/fixtures/undefined-variable.md");
  assert.throws(
    () => mdwt.renderDocument(undefinedVarEntry),
    (error) =>
      error.message.includes(
        'Variable "missingVar" is used but not declared or null'
      )
  );
  process.stdout.write(
    "✔ throws when variable is displayed but missing or null\n"
  );

  const missingIncludeEntry = path.join(
    base,
    "tests/fixtures/missing-include-variable.md"
  );
  const errorOutput = captureConsoleError(() =>
    mdwt.renderDocument(missingIncludeEntry)
  );
  assert.ok(
    errorOutput.includes("please check the variable includeFile value"),
    "Missing include should mention variable name"
  );
  process.stdout.write(
    "✔ warns with variable hint when include path uses a missing variable value\n"
  );
}

run();
