const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

class MdWT {
  constructor() {
    this.includeRegex = /\{!include\(([\s\S]*?)\)!\}/g;
    this.varRegex = /\{!var\(([\s\S]*?)\)!\}/g;
    this.listTableRegex = /\{!list-table\(([\s\S]*?)\)!\}/g;
    this.ifStartRegex = /\{!if\s+([\s\S]*?)!\}/g;
    this.imageRegex =
      /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+(?:"([^"]+)"|'([^']+)'))?\s*\)/g;
    this.endIfToken = "{!endif!}";
    this.errors = [];
  }

  build(entryFilePath, options = {}) {
    const result = this.renderDocument(entryFilePath, options);
    this.outputResult(result, options.output);
    return result;
  }

  renderDocument(entryFilePath, options = {}) {
    if (!entryFilePath) {
      throw new Error("An entry markdown file must be provided.");
    }

    try {
      this.errors = [];
      const absoluteEntryPath = path.resolve(process.cwd(), entryFilePath);
      const rootVariables = this.collectVariables(absoluteEntryPath, [], {});
      const { content, frontMatterRaw } = this.processFile(
        absoluteEntryPath,
        [],
        {},
        options.img2b64,
        rootVariables
      );
      const result = this.composeDocument(
        content,
        frontMatterRaw,
        rootVariables,
        options
      );
      this.reportErrors();
      return result;
    } catch (error) {
      if (!error.recorded) {
        this.errors.push(error.message);
      }
      this.reportErrors();
      throw error;
    }
  }

  processFile(
    filePath,
    stack = [],
    parentVars = {},
    img2b64 = false,
    rootVars = null
  ) {
    if (stack.length === 0) {
      this.errors = [];
    }

    const resolvedPath = path.resolve(filePath);

    if (!fs.existsSync(resolvedPath)) {
      return this.raiseError(`File not found: ${resolvedPath}`);
    }

    const effectiveRootVars =
      rootVars || this.collectVariables(resolvedPath, stack, parentVars);
    const content = fs.readFileSync(resolvedPath, "utf8");
    const {
      body,
      vars: localVars,
      frontMatterRaw,
    } = this.extractFrontMatter(content);
    const mergedVars = this.mergeVariables(localVars, parentVars);
    const rootVariables = effectiveRootVars || mergedVars;
    const processedContent = this.processContent(
      body,
      path.dirname(resolvedPath),
      stack.concat(resolvedPath),
      mergedVars,
      img2b64,
      rootVariables,
      0
    );
    const finalContent =
      stack.length === 0
        ? this.processLists(processedContent, resolvedPath)
        : processedContent;

    return {
      content: finalContent,
      frontMatterRaw,
      variables: mergedVars,
      rootVariables,
    };
  }

  processContent(
    content,
    baseDir,
    stack,
    variables = {},
    img2b64 = false,
    rootVars = null,
    headingOffset = 0
  ) {
    const rootVariables = rootVars || variables;
    const prepared = this.processConditionalBlocks(
      content,
      rootVariables,
      stack
    );
    this.includeRegex.lastIndex = 0;

    let rendered = prepared.replace(this.includeRegex, (_, directive) => {
      const includeOptions = this.parseDirective(directive);
      return this.handleInclude(
        includeOptions,
        baseDir,
        stack,
        variables,
        img2b64,
        rootVariables,
        headingOffset
      );
    });

    rendered = this.replaceVariables(rendered, rootVariables, stack);
    if (img2b64) {
      rendered = this.inlineLocalImages(rendered, baseDir);
    }
    return rendered;
  }

  parseDirective(rawDirective) {
    const [filePath, sectionTitle, targetLevel] =
      this.splitDirective(rawDirective);

    if (!filePath) {
      this.raiseError(
        `Invalid include directive "${rawDirective}". A file path is required.`
      );
    }

    return {
      filePath,
      sectionTitle: sectionTitle || undefined,
      targetLevel: targetLevel || undefined,
    };
  }

  splitDirective(rawDirective) {
    const segments = [];
    let current = "";
    let separators = 0;

    for (const char of rawDirective) {
      if (char === "|" && separators < 2) {
        segments.push(current.trim());
        current = "";
        separators += 1;
      } else {
        current += char;
      }
    }

    segments.push(current.trim());

    while (segments.length < 3) {
      segments.push(undefined);
    }

    return segments.slice(0, 3);
  }

  handleInclude(
    { filePath, sectionTitle, targetLevel },
    baseDir,
    stack,
    parentVars = {},
    img2b64 = false,
    rootVars = null,
    headingOffset = 0
  ) {
    const currentFile =
      stack && stack.length ? stack[stack.length - 1] : "<unknown>";
    const { value: resolvedTemplate, placeholders } =
      this.resolveTemplateWithVariables(
        filePath,
        rootVars || parentVars,
        currentFile || baseDir
      );

    if (!resolvedTemplate) {
      return "";
    }

    const resolvedPath = path.resolve(baseDir, resolvedTemplate);

    if (stack.includes(resolvedPath)) {
      return this.raiseError(
        `Circular include detected: ${[...stack, resolvedPath].join(" -> ")}`
      );
    }

    if (!fs.existsSync(resolvedPath)) {
      const info = this.recordMissingInclude(
        resolvedPath,
        currentFile,
        placeholders
      );
      const fromSegment = info.from ? ` (from ${info.from})` : "";
      return `<!-- missing ${info.path}${fromSegment} -->`;
    }

    const rawContent = fs.readFileSync(resolvedPath, "utf8");
    const { body, vars: localVars } = this.extractFrontMatter(rawContent);
    const { content: snippetContent, level: referenceLevel } =
      this.extractReference(body, sectionTitle);
    const mergedVars = this.mergeVariables(localVars, parentVars);
    const shift = this.computeHeadingShift(
      targetLevel,
      referenceLevel,
      headingOffset
    );
    const childHeadingOffset = headingOffset + shift;
    const workingSnippet =
      shift && snippetContent
        ? this.shiftHeadingLevels(snippetContent, shift)
        : snippetContent;
    const processedSnippet = this.processContent(
      workingSnippet,
      path.dirname(resolvedPath),
      stack.concat(resolvedPath),
      mergedVars,
      img2b64,
      rootVars || parentVars,
      childHeadingOffset
    );

    if (!targetLevel && headingOffset) {
      return this.shiftHeadingLevels(processedSnippet, headingOffset);
    }

    return processedSnippet;
  }

  extractReference(snippet, sectionTitle) {
    if (sectionTitle) {
      const section = this.extractSection(snippet, sectionTitle);
      return { content: section.content, level: section.level };
    }

    return {
      content: snippet,
      level: this.detectLowestHeadingLevel(snippet),
    };
  }

  extractSection(content, sectionTitle) {
    const lines = content.split(/\r?\n/);
    const normalizedTitle = sectionTitle.trim();
    const startIndex = lines.findIndex(
      (line) => line.trim() === normalizedTitle
    );

    if (startIndex === -1) {
      throw new Error(`Section "${sectionTitle}" not found in included file.`);
    }

    const headingLevel = this.getHeadingLevel(lines[startIndex]);

    if (!headingLevel) {
      throw new Error(
        `Section "${sectionTitle}" is not a valid markdown heading.`
      );
    }

    let endIndex = lines.length;

    for (let i = startIndex + 1; i < lines.length; i += 1) {
      const level = this.getHeadingLevel(lines[i]);

      if (level && level <= headingLevel) {
        endIndex = i;
        break;
      }
    }

    return {
      content: lines.slice(startIndex, endIndex).join("\n"),
      level: headingLevel,
    };
  }

  computeHeadingShift(targetLevelSpec, referenceLevel, headingOffset) {
    if (!targetLevelSpec) {
      return 0;
    }

    const targetLevel = this.parseLevelSpec(targetLevelSpec);

    if (!targetLevel) {
      throw new Error(
        `Invalid level "${targetLevelSpec}" in include directive.`
      );
    }

    const effectiveReference = referenceLevel || headingOffset + 1;
    return targetLevel + headingOffset - effectiveReference;
  }

  adjustHeadingLevels(content, shift) {
    if (!shift) {
      return content;
    }

    return this.shiftHeadingLevels(content, shift);
  }

  recordMissingInclude(filePath, fromFile = null, placeholders = []) {
    const displayPath = path.relative(process.cwd(), filePath) || filePath;
    const fromDisplay =
      fromFile && fromFile !== "<unknown>"
        ? path.relative(process.cwd(), fromFile) || fromFile
        : null;
    const message = fromDisplay
      ? `Included file not found: ${displayPath} (included from ${fromDisplay})`
      : `Included file not found: ${displayPath}`;
    const variableHint =
      placeholders && placeholders.length
        ? ` please check the variable ${placeholders.join(", ")} value.`
        : "";
    this.errors.push(`${message}${variableHint}`);
    return { path: displayPath, from: fromDisplay };
  }

  raiseError(message) {
    this.errors.push(message);
    const error = new Error(message);
    error.recorded = true;
    throw error;
  }

  reportErrors() {
    if (!this.errors.length) {
      return;
    }

    const summary = [
      `Completed with ${this.errors.length} error(s):`,
      ...this.errors.map((message, index) => `${index + 1}. ${message}`),
    ].join("\n");
    console.error(summary);
  }

  composeDocument(content, frontMatterRaw, rootVariables = {}, options = {}) {
    const includeFrontMatter = !options.skipheaders;
    const frontMatter = includeFrontMatter
      ? this.renderFrontMatterBlock(rootVariables, frontMatterRaw)
      : "";
    const assembled = `${frontMatter || ""}${content || ""}`;
    return this.prettifyMarkdown(assembled);
  }

  outputResult(content, outputPath) {
    if (!outputPath || outputPath === "-") {
      process.stdout.write(content);

      if (!content.endsWith("\n")) {
        process.stdout.write("\n");
      }

      return;
    }

    const normalized = outputPath.toLowerCase();

    if (normalized === "clipboard" || normalized === "pbcopy") {
      const result = spawnSync("pbcopy", { input: content });

      if (result.error) {
        throw new Error(`Failed to copy to clipboard: ${result.error.message}`);
      }

      if (result.status !== 0) {
        const error = result.stderr
          ? result.stderr.toString().trim()
          : "unknown error";
        throw new Error(`Failed to copy to clipboard: ${error}`);
      }

      if (this.errors.length === 0) {
        console.log("Content copied to clipboard.");
      }

      return;
    }

    const absoluteOutputPath = path.resolve(process.cwd(), outputPath);
    fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
    fs.writeFileSync(absoluteOutputPath, content, "utf8");
  }
}

module.exports = MdWT;
