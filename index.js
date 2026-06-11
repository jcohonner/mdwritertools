#!/usr/bin/env node
const { program } = require("commander");

program
  .command("export <filepath>")
  .option("-o, --output <outputPath>", "specify output path")
  .option("--stripheaders", "strip leading --- front matter block")
  .option("--skipheaders", "skip leading --- front matter block")
  .option("--stripcomments", "remove HTML comments from output")
  .option("--img2b64", "convert local images to base64")
  .description(
    "export the final version from source file to another file or clipboard",
  )
  .action((filepath, options) => {
    const mkdoc = require("./src/mdwt");
    mkdoc.build(filepath, options);
  });

program
  .command("build <filepath>")
  .description("replace include directives directly in the source file")
  .option("--stripheaders", "strip leading --- front matter block")
  .option("--skipheaders", "skip leading --- front matter block")
  .option("--stripcomments", "remove HTML comments from output")
  .option("--img2b64", "convert local images to base64")
  .action((filepath, options) => {
    const mkdoc = require("./src/mdwt");
    options.output = filepath;
    mkdoc.build(filepath, options);
  });

program
  .command("prebuild <filepath>")
  .description(
    "replace include directives in source while keeping variable and list directives",
  )
  .option("--stripheaders", "strip leading --- front matter block")
  .option("--img2b64", "convert local images to base64")
  .action((filepath, options) => {
    const mkdoc = require("./src/mdwt");
    options.output = filepath;
    mkdoc.prebuild(filepath, options);
  });

program
  .command("export-list <filepath>")
  .description("export lists from document to CSV or JSON files")
  .option("--all", "export all lists (default when -l is not specified)")
  .option("-l, --list <name>", "export a specific list by name")
  .option(
    "-o, --output <prefix>",
    "output path prefix — filename will be prefix+listname.format (default: input file path without extension)"
  )
  .option("-f, --format <format>", "output format: csv (default) or json")
  .action((filepath, options) => {
    const mkdoc = require("./src/mdwt");
    mkdoc.exportLists(filepath, options);
  });

program.parse(process.argv);
