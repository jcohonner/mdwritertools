const assert = require("assert");
const fs = require("fs");
const path = require("path");

const mdwt = require("../src/mdwt");

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
];

function render(entry) {
  const absoluteEntry = path.resolve(__dirname, "..", entry);
  const { content } = mdwt.processFile(absoluteEntry, [], {}, false, null);
  return content.trim();
}

function loadExpected(expectedPath) {
  const absolute = path.resolve(__dirname, "..", expectedPath);
  return fs.readFileSync(absolute, "utf8").trim();
}

function run() {
  cases.forEach(({ name, entry, expected }) => {
    const output = render(entry);
    const expectedContent = loadExpected(expected);
    assert.strictEqual(
      output,
      expectedContent,
      `${name} did not match expected output`
    );
    process.stdout.write(`✔ ${name}\n`);
  });

  process.stdout.write("All tests passed.\n");
}

run();
