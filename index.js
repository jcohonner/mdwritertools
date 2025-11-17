#!/usr/bin/env node
const { program } = require("commander");

program
  .command("export <filepath>")
  .option("-o, --output <outputPath>", "specify output path")
  .option("--skipheaders", "skip leading --- front matter block")
  .description("build the final version from source file")
  .action((filepath, options) => {
    const mkdoc = require("./src/mdwt");
    mkdoc.build(filepath, options);
  });

program
  .command("build <filepath>")
  .description("replace include directives directly in the source file")
  .option("--skipheaders", "skip leading --- front matter block")
  .action((filepath, options) => {
    const mkdoc = require("./src/mdwt");
    options.output = filepath;
    mkdoc.build(filepath, options);
  });

program.parse(process.argv);
