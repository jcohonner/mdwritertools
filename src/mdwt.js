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
    const { value: resolvedTemplate, placeholders } = this.resolveTemplateWithVariables(
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

  getHeadingLevel(line) {
    const match = line.trim().match(/^(#{1,6})\s+/);
    return match ? match[1].length : null;
  }

  detectLowestHeadingLevel(content) {
    const lines = content.split(/\r?\n/);
    let minLevel = null;

    for (const line of lines) {
      const level = this.getHeadingLevel(line);

      if (level && (minLevel === null || level < minLevel)) {
        minLevel = level;
      }
    }

    return minLevel;
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

  parseLevelSpec(spec) {
    if (!spec) return null;
    const trimmed = spec.trim();

    if (!/^#{1,6}$/.test(trimmed)) {
      return null;
    }

    return trimmed.length;
  }

  shiftHeadingLevels(content, shift) {
    const lines = content.split(/\r?\n/);
    let inFence = false;
    let fenceChar = null;
    let fenceLength = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();

      if (inFence) {
        if (this.startsWithFence(trimmed, fenceChar, fenceLength)) {
          inFence = false;
          fenceChar = null;
          fenceLength = 0;
        }

        continue;
      }

      const fenceInfo = this.getFenceInfo(trimmed);

      if (fenceInfo) {
        inFence = true;
        fenceChar = fenceInfo.char;
        fenceLength = fenceInfo.length;
        continue;
      }

      const match = line.match(/^(\s{0,3})(#{1,6})(\s+)(.*)$/);

      if (!match) {
        continue;
      }

      const [, indent, hashes, space, rest] = match;
      const currentLevel = hashes.length;
      let nextLevel = currentLevel + shift;

      nextLevel = Math.max(1, Math.min(6, nextLevel));
      lines[i] = `${indent}${"#".repeat(nextLevel)}${space}${rest}`;
    }

    return lines.join("\n");
  }

  getFenceInfo(trimmedLine) {
    const match = trimmedLine.match(/^(```+|~~~+)/);
    if (!match) {
      return null;
    }

    return {
      char: match[0][0],
      length: match[0].length,
    };
  }

  startsWithFence(trimmedLine, fenceChar, fenceLength) {
    if (!fenceChar || fenceLength <= 0) {
      return false;
    }

    return trimmedLine.startsWith(fenceChar.repeat(fenceLength));
  }

  extractFrontMatter(content) {
    let working = content;
    let bom = "";

    if (working.startsWith("\uFEFF")) {
      bom = "\uFEFF";
      working = working.slice(1);
    }

    if (!working.startsWith("---\n") && !working.startsWith("---\r\n")) {
      return { body: content, vars: {}, frontMatterRaw: null };
    }

    const match = working.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

    if (!match) {
      return { body: content, vars: {}, frontMatterRaw: null };
    }

    const frontMatterBlock = match[0];
    const frontMatterContent = match[1] || "";
    const rest = working.slice(frontMatterBlock.length);
    let removedNewline = "";

    if (rest.startsWith("\r\n")) {
      removedNewline = "\r\n";
    } else if (rest.startsWith("\n")) {
      removedNewline = "\n";
    }

    const body = rest.slice(removedNewline.length);
    const frontMatterRaw = bom + frontMatterBlock + removedNewline;
    const vars = this.parseFrontMatterVars(frontMatterContent);

    return {
      body,
      vars,
      frontMatterRaw,
    };
  }

  parseFrontMatterVars(block) {
    const vars = {};
    const lines = block.split(/\r?\n/);

    for (const line of lines) {
      if (!line || !line.trim()) {
        continue;
      }

      const separatorIndex = line.indexOf(":");

      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();

      if (!key) {
        continue;
      }

      vars[key] = this.normalizeFrontMatterValue(rawValue);
    }

    return vars;
  }

  normalizeFrontMatterValue(value) {
    if (!value) {
      return "";
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }

    return value;
  }

  mergeVariables(localVars = {}, parentVars = {}) {
    return { ...localVars, ...parentVars };
  }

  applyVariablePlaceholders(rawValue, variables = {}, currentFile = "<unknown>") {
    const { value } = this.resolveTemplateWithVariables(
      rawValue,
      variables,
      currentFile
    );
    return value;
  }

  collectVariables(filePath, stack = [], parentVars = {}) {
    const resolvedPath = path.resolve(filePath);

    if (stack.includes(resolvedPath)) {
      return this.raiseError(
        `Circular include detected: ${[...stack, resolvedPath].join(" -> ")}`
      );
    }

    if (!fs.existsSync(resolvedPath)) {
      return this.raiseError(`File not found: ${resolvedPath}`);
    }

    const content = fs.readFileSync(resolvedPath, "utf8");
    const { body, vars: localVars } = this.extractFrontMatter(content);
    let accumulated = this.mergeVariables(localVars, parentVars);
    const includeRegex = new RegExp(this.includeRegex);
    const nextStack = stack.concat(resolvedPath);
    let match = includeRegex.exec(body);

    while (match) {
      const includeOptions = this.parseDirective(match[1]);
      const { value: includePath, placeholders } = this.resolveTemplateWithVariables(
        includeOptions.filePath,
        accumulated,
        resolvedPath
      );

      if (!includePath) {
        match = includeRegex.exec(body);
        continue;
      }

      const resolvedInclude = path.resolve(path.dirname(resolvedPath), includePath);

      if (!fs.existsSync(resolvedInclude)) {
        this.recordMissingInclude(resolvedInclude, resolvedPath, placeholders);
        match = includeRegex.exec(body);
        continue;
      }

      const childVars = this.collectVariables(
        resolvedInclude,
        nextStack,
        accumulated
      );
      accumulated = this.mergeVariables(childVars, accumulated);
      match = includeRegex.exec(body);
    }

    return accumulated;
  }

  processConditionalBlocks(content, rootVars = {}, stack = []) {
    if (!content) {
      return content;
    }

    const currentFile =
      stack && stack.length ? stack[stack.length - 1] : "<unknown>";

    const walk = (segment) => {
      const startRegex = new RegExp(this.ifStartRegex);
      let cursor = 0;
      let result = "";
      let match = startRegex.exec(segment);

      while (match) {
        const conditionRaw = match[1] || "";
        result += segment.slice(cursor, match.index);

        const blockStart = startRegex.lastIndex;
        const { branches, endIndex } = this.extractConditionalBranches(
          segment,
          blockStart,
          conditionRaw,
          currentFile
        );
        const branchToKeep = branches.find((branch) =>
          this.shouldKeepBranch(branch.condition, rootVars, currentFile)
        );

        if (branchToKeep) {
          result += walk(branchToKeep.body);
        }

        cursor = endIndex + this.endIfToken.length;
        startRegex.lastIndex = cursor;
        match = startRegex.exec(segment);
      }

      result += segment.slice(cursor);

      if (result.includes(this.endIfToken)) {
        throw new Error(
          `Unexpected ${this.endIfToken} without opening {!if...!} in ${currentFile}.`
        );
      }

      return result;
    };

    return walk(content);
  }

  extractConditionalBranches(
    content,
    searchFrom,
    firstCondition,
    currentFile = "<unknown>"
  ) {
    const tokenRegex =
      /\{!if\s+[\s\S]*?!\}|\{!elseif\s+[\s\S]*?!\}|\{!else!\}|\{!endif!\}/g;
    tokenRegex.lastIndex = searchFrom;
    let depth = 0;
    let cursor = searchFrom;
    let match = tokenRegex.exec(content);
    const branches = [];
    let currentCondition = firstCondition;

    while (match) {
      const token = match[0];
      const tokenIndex = match.index;

      if (token.startsWith("{!if")) {
        depth += 1;
        match = tokenRegex.exec(content);
        continue;
      }

      if (token === this.endIfToken) {
        if (depth === 0) {
          const body = content.slice(cursor, tokenIndex);
          branches.push({ condition: currentCondition, body });
          return { branches, endIndex: tokenIndex };
        }

        depth -= 1;
        match = tokenRegex.exec(content);
        continue;
      }

      if (depth === 0 && token.startsWith("{!elseif")) {
        const body = content.slice(cursor, tokenIndex);
        branches.push({ condition: currentCondition, body });
        const conditionMatch = token.match(/\{!elseif\s+([\s\S]*?)!\}/);
        currentCondition = conditionMatch ? conditionMatch[1] || "" : "";
        cursor = tokenRegex.lastIndex;
        match = tokenRegex.exec(content);
        continue;
      }

      if (depth === 0 && token === "{!else!}") {
        const body = content.slice(cursor, tokenIndex);
        branches.push({ condition: currentCondition, body });
        currentCondition = null; // else branch
        cursor = tokenRegex.lastIndex;
        match = tokenRegex.exec(content);
        continue;
      }

      match = tokenRegex.exec(content);
    }

    throw new Error(
      `Missing ${this.endIfToken} for conditional in ${currentFile}.`
    );
  }

  shouldKeepBlock(rawCondition, rootVars, currentFile) {
    const { name, expectedValue } = this.parseConditionalExpression(
      rawCondition,
      currentFile
    );

    if (!Object.prototype.hasOwnProperty.call(rootVars, name)) {
      return this.raiseError(
        `Variable "${name}" is not defined in the entry document (referenced in ${currentFile}).`
      );
    }

    return String(rootVars[name]) === expectedValue;
  }

  shouldKeepBranch(rawCondition, rootVars, currentFile) {
    if (rawCondition === null) {
      return true;
    }

    return this.shouldKeepBlock(rawCondition, rootVars, currentFile);
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
    const variableHint = placeholders && placeholders.length
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

  parseConditionalExpression(rawCondition, currentFile) {
    const trimmed = rawCondition.trim();
    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      return this.raiseError(
        `Invalid conditional expression "${rawCondition}" in ${currentFile}. Expected "{!if name=value!}".`
      );
    }

    const name = trimmed.slice(0, separatorIndex).trim();
    const expectedValue = trimmed.slice(separatorIndex + 1).trim();

    if (!name) {
      return this.raiseError(
        `Conditional block is missing a variable name in ${currentFile}.`
      );
    }

    return { name, expectedValue };
  }

  replaceVariables(content, variables, stack) {
    if (!content) {
      return content;
    }

    this.varRegex.lastIndex = 0;
    const currentFile =
      stack && stack.length ? stack[stack.length - 1] : "<unknown>";

    return content.replace(this.varRegex, (_, rawName) => {
      const name = rawName.trim();

      if (!name) {
        return this.raiseError(`Invalid variable name in ${currentFile}`);
      }

      if (
        !Object.prototype.hasOwnProperty.call(variables, name) ||
        variables[name] === undefined ||
        variables[name] === null
      ) {
        return this.raiseError(
          `Variable "${name}" is used but not declared or null (referenced in ${currentFile}).`
        );
      }

      return variables[name];
    });
  }

  resolveTemplateWithVariables(
    rawValue,
    variables = {},
    currentFile = "<unknown>"
  ) {
    if (!rawValue) {
      return { value: rawValue, placeholders: [] };
    }

    const placeholders = [];
    const value = rawValue.replace(/<([^>]+)>/g, (match, rawName) => {
      const name = rawName.trim();

      if (!name) {
        this.raiseError(
          `Invalid variable name in include path (${currentFile}).`
        );
      }

      if (
        !Object.prototype.hasOwnProperty.call(variables, name) ||
        variables[name] === undefined ||
        variables[name] === null
      ) {
        this.raiseError(
          `Variable "${name}" is used but not declared or null (referenced in ${currentFile}).`
        );
      }

      placeholders.push(name);
      return variables[name];
    });

    return { value, placeholders };
  }

  composeDocument(content, frontMatterRaw, rootVariables = {}, options = {}) {
    const includeFrontMatter = !options.skipheaders;
    const frontMatter = includeFrontMatter
      ? this.renderFrontMatterBlock(rootVariables, frontMatterRaw)
      : "";
    const assembled = `${frontMatter || ""}${content || ""}`;
    return this.prettifyMarkdown(assembled);
  }

  renderFrontMatterBlock(rootVariables = {}, frontMatterRaw = null) {
    const keys = Object.keys(rootVariables || {});

    if (!keys.length) {
      return frontMatterRaw || "";
    }

    const newline = this.detectNewline(frontMatterRaw);
    const bom = frontMatterRaw && frontMatterRaw.startsWith("\uFEFF") ? "\uFEFF" : "";
    const lines = keys
      .sort()
      .map((key) => `${key}: ${rootVariables[key]}`);
    return `${bom}---${newline}${lines.join(newline)}${newline}---${newline}${newline}`;
  }

  detectNewline(sample) {
    if (!sample) {
      return "\n";
    }

    return sample.includes("\r\n") ? "\r\n" : "\n";
  }

  prettifyMarkdown(content) {
    if (!content) {
      return "";
    }

    const normalized = content.replace(/\r\n/g, "\n");
    const trimmedTrailingSpaces = normalized
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n");
    const collapsed = this.collapseBlankLines(trimmedTrailingSpaces);
    const withoutTrailingBlankLines = collapsed.replace(/\n+$/g, "\n");

    if (withoutTrailingBlankLines.endsWith("\n")) {
      return withoutTrailingBlankLines;
    }

    return `${withoutTrailingBlankLines}\n`;
  }

  collapseBlankLines(content) {
    const lines = content.split("\n");
    const result = [];
    let inFence = false;
    let fenceChar = null;
    let fenceLength = 0;
    let previousBlank = false;

    lines.forEach((line) => {
      const trimmed = line.trim();

      if (inFence) {
        if (this.startsWithFence(trimmed, fenceChar, fenceLength)) {
          inFence = false;
          fenceChar = null;
          fenceLength = 0;
        }

        result.push(line);
        previousBlank = false;
        return;
      }

      const fenceInfo = this.getFenceInfo(trimmed);

      if (fenceInfo) {
        inFence = true;
        fenceChar = fenceInfo.char;
        fenceLength = fenceInfo.length;
        result.push(line);
        previousBlank = false;
        return;
      }

      const isBlank = trimmed === "";

      if (isBlank && previousBlank) {
        return;
      }

      result.push(line);
      previousBlank = isBlank;
    });

    return result.join("\n");
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

  inlineLocalImages(content, baseDir) {
    if (!content) {
      return content;
    }

    this.imageRegex.lastIndex = 0;
    return content.replace(
      this.imageRegex,
      (match, alt, rawTarget, titleDouble, titleSingle) => {
        const linkTarget = this.normalizeLinkTarget(rawTarget);

        if (!linkTarget || this.isExternalResource(linkTarget)) {
          return match;
        }

        const resolvedPath = path.isAbsolute(linkTarget)
          ? linkTarget
          : path.resolve(baseDir, linkTarget);

        if (!fs.existsSync(resolvedPath)) {
          return match;
        }

        let stats;

        try {
          stats = fs.statSync(resolvedPath);
        } catch (error) {
          return match;
        }

        if (!stats.isFile()) {
          return match;
        }

        let dataUri;

        try {
          const buffer = fs.readFileSync(resolvedPath);
          const mimeType = this.getMimeType(resolvedPath);
          dataUri = `data:${mimeType};base64,${buffer.toString("base64")}`;
        } catch (error) {
          return match;
        }

        const title = titleDouble || titleSingle;
        const titleSegment = title ? ` "${title}"` : "";
        return `![${alt}](${dataUri}${titleSegment})`;
      }
    );
  }

  normalizeLinkTarget(target) {
    if (!target) {
      return "";
    }

    let trimmed = target.trim();

    if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
      trimmed = trimmed.slice(1, -1).trim();
    }

    return trimmed;
  }

  isExternalResource(target) {
    if (!target) {
      return true;
    }

    const lower = target.toLowerCase();

    return (
      lower.startsWith("http://") ||
      lower.startsWith("https://") ||
      lower.startsWith("data:") ||
      lower.startsWith("mailto:") ||
      lower.startsWith("ftp://") ||
      lower.startsWith("//")
    );
  }

  getMimeType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const catalog = {
      ".apng": "image/apng",
      ".avif": "image/avif",
      ".bmp": "image/bmp",
      ".gif": "image/gif",
      ".ico": "image/x-icon",
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".tif": "image/tiff",
      ".tiff": "image/tiff",
      ".webp": "image/webp",
    };

    return catalog[extension] || "application/octet-stream";
  }

  processLists(content, currentFile = "<unknown>") {
    if (!content) {
      return content;
    }

    const { contentWithoutItems, lists } = this.collectListItems(
      content,
      currentFile
    );

    return this.renderListTables(contentWithoutItems, lists, currentFile);
  }

  collectListItems(content, currentFile = "<unknown>") {
    const lines = content.split(/\r?\n/);
    const result = [];
    const headingStack = [];
    const slugCounts = {};
    const lists = {};
    let inFence = false;
    let fenceChar = null;
    let fenceLength = 0;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (inFence) {
        if (this.startsWithFence(trimmed, fenceChar, fenceLength)) {
          inFence = false;
          fenceChar = null;
          fenceLength = 0;
        }

        result.push(line);
        i += 1;
        continue;
      }

      const fenceInfo = this.getFenceInfo(trimmed);

      if (fenceInfo) {
        inFence = true;
        fenceChar = fenceInfo.char;
        fenceLength = fenceInfo.length;
        result.push(line);
        i += 1;
        continue;
      }

      const headingLevel = this.getHeadingLevel(line);

      if (headingLevel) {
        const headingText = line
          .replace(/^(\s{0,3}#{1,6})\s+/, "")
          .trim();
        const anchor = this.slugifyHeading(headingText, slugCounts);

        while (
          headingStack.length &&
          headingStack[headingStack.length - 1].level >= headingLevel
        ) {
          headingStack.pop();
        }

        headingStack.push({ level: headingLevel, text: headingText, anchor });
      }

      const addMatch = line.match(/^\s*\{!list-add(?:\s+([^\s}]+))?\s*$/);

      if (addMatch) {
        const listName = (addMatch[1] && addMatch[1].trim()) || "items";
        const blockLines = [];
        let j = i + 1;
        let closed = false;

        while (j < lines.length) {
          if (/^\s*!}\s*$/.test(lines[j])) {
            closed = true;
            break;
          }

          blockLines.push(lines[j]);
          j += 1;
        }

        if (!closed) {
          this.raiseError(
            `Missing "!}" for list-add starting at line ${i + 1} in ${currentFile}.`
          );
        }

        const attributes = this.parseListAttributes(
          blockLines,
          currentFile,
          i + 2
        );
        const pathText = headingStack.map((item) => item.text).join(" / ");
        const anchor = headingStack.length
          ? headingStack[headingStack.length - 1].anchor
          : "";

        if (!lists[listName]) {
          lists[listName] = [];
        }

        lists[listName].push({ attributes, pathText, anchor });
        i = j + 1;
        continue;
      }

      result.push(line);
      i += 1;
    }

    return {
      contentWithoutItems: result.join("\n"),
      lists,
    };
  }

  parseListAttributes(lines, currentFile, startingLine) {
    const attributes = {};

    lines.forEach((rawLine, index) => {
      if (!rawLine || !rawLine.trim()) {
        return;
      }

      const separatorIndex = rawLine.indexOf(":");

      if (separatorIndex === -1) {
        this.raiseError(
          `Invalid attribute line "${rawLine.trim()}" in ${currentFile} (line ${startingLine + index}). Expected "key: value".`
        );
      }

      const key = rawLine.slice(0, separatorIndex).trim();
      const value = rawLine.slice(separatorIndex + 1).trim();

      if (!key) {
        this.raiseError(
          `Empty attribute name in ${currentFile} (line ${startingLine + index}).`
        );
      }

      attributes[key] = value;
    });

    return attributes;
  }

  renderListTables(content, lists, currentFile = "<unknown>") {
    const lines = content.split(/\r?\n/);
    const result = [];
    let inFence = false;
    let fenceChar = null;
    let fenceLength = 0;

    lines.forEach((line) => {
      const trimmed = line.trim();

      if (inFence) {
        if (this.startsWithFence(trimmed, fenceChar, fenceLength)) {
          inFence = false;
          fenceChar = null;
          fenceLength = 0;
        }

        result.push(line);
        return;
      }

      const fenceInfo = this.getFenceInfo(trimmed);

      if (fenceInfo) {
        inFence = true;
        fenceChar = fenceInfo.char;
        fenceLength = fenceInfo.length;
        result.push(line);
        return;
      }

      this.listTableRegex.lastIndex = 0;
      const replaced = line.replace(this.listTableRegex, (_, rawOptions) =>
        this.renderListTable(rawOptions, lists, currentFile)
      );
      result.push(replaced);
    });

    return result.join("\n");
  }

  renderListTable(rawOptions, lists, currentFile = "<unknown>") {
    const options = this.parseListTableOptions(rawOptions, currentFile);
    const listName = options.list || "items";
    const items = lists[listName] || [];
    const columns =
      options.columns && options.columns.length
        ? options.columns
        : this.deriveColumnsFromItems(items);

    if (!columns.length) {
      return "";
    }

    if (!items.length) {
      return `_No items in list "${listName}"._`;
    }

    const headerRow = `| ${columns
      .map((column) => this.escapeTableCell(column.label))
      .join(" | ")} |`;
    const separatorRow = `| ${columns.map(() => "---").join(" | ")} |`;
    const bodyRows = items.map((item) =>
      `| ${columns
        .map((column) =>
          this.escapeTableCell(this.formatTableValue(column.field, item))
        )
        .join(" | ")} |`
    );

    return [headerRow, separatorRow, ...bodyRows].join("\n");
  }

  parseListTableOptions(rawOptions, currentFile = "<unknown>") {
    const options = {};
    const parts = rawOptions
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean);

    parts.forEach((part) => {
      const separatorIndex = part.indexOf("=");

      if (separatorIndex === -1) {
        this.raiseError(
          `Invalid list-table option "${part}" in ${currentFile}. Expected "key=value".`
        );
      }

      const key = part.slice(0, separatorIndex).trim().toLowerCase();
      const value = part.slice(separatorIndex + 1).trim();

      if (!key) {
        this.raiseError(
          `Missing option name in list-table directive (${currentFile}).`
        );
      }

      if (key === "columns") {
        options.columns = this.parseColumnSpec(value, currentFile);
      } else {
        options[key] = value;
      }
    });

    return options;
  }

  parseColumnSpec(rawValue, currentFile = "<unknown>") {
    if (!rawValue) {
      this.raiseError(
        `Empty columns specification in list-table directive (${currentFile}).`
      );
    }

    return rawValue
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((entry) => {
        const separatorIndex = entry.indexOf(":");

        if (separatorIndex === -1) {
          return { field: entry, label: entry };
        }

        const field = entry.slice(0, separatorIndex).trim();
        const label = entry.slice(separatorIndex + 1).trim() || field;

        if (!field) {
          this.raiseError(
            `Invalid column definition "${entry}" in ${currentFile}.`
          );
        }

        return { field, label };
      });
  }

  deriveColumnsFromItems(items) {
    const seen = new Set();
    const columns = [];

    items.forEach((item) => {
      Object.keys(item.attributes).forEach((key) => {
        if (seen.has(key)) {
          return;
        }

        seen.add(key);
        columns.push({ field: key, label: key });
      });
    });

    return columns;
  }

  formatTableValue(field, item) {
    if (field === "path") {
      if (!item.pathText) {
        return "";
      }

      if (item.anchor) {
        return `[${item.pathText}](#${item.anchor})`;
      }

      return item.pathText;
    }

    if (!Object.prototype.hasOwnProperty.call(item.attributes, field)) {
      return "";
    }

    return item.attributes[field];
  }

  escapeTableCell(value) {
    return String(value || "")
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, "<br>");
  }

  slugifyHeading(text, slugCounts = {}) {
    const base = text
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
    const key = base || "section";
    const count = slugCounts[key] || 0;
    slugCounts[key] = count + 1;
    return count ? `${key}-${count}` : key;
  }
}

module.exports = new MdWT();
