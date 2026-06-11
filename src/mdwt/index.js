const MdWT = require("./core");
const conditionals = require("./conditionals");
const exportMethods = require("./export");
const frontMatter = require("./front-matter");
const headings = require("./headings");
const images = require("./images");
const lists = require("./lists");
const markdown = require("./markdown");
const variables = require("./variables");

Object.assign(
  MdWT.prototype,
  conditionals,
  exportMethods,
  frontMatter,
  headings,
  images,
  lists,
  markdown,
  variables
);

module.exports = new MdWT();
