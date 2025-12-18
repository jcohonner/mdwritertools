const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

class MdWT {
  constructor() {
    this.includeRegex = /\{!include\(([\s\S]*?)\)!\}/g;
    this.varRegex = /\{!var\(([\s\S]*?)\)!\}/g;
    this.ifStartRegex = /\{!if\s+([\s\S]*?)!\}/g;
    this.imageRegex =
      /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+(?:"([^"]+)"|'([^']+)'))?\s*\)/g;
    this.endIfToken = "{!endif!}";
    this.errors = [];
  }

  build(entryFilePath, options = {}) {
    if (!entryFilePath) {
      throw new Error("An entry markdown file must be provided.");
    }

    this.errors = [];
    const absoluteEntryPath = path.resolve(process.cwd(), entryFilePath);
    const rootVariables = this.collectVariables(absoluteEntryPath, [], {});
    let result;

    try {
      const { content, frontMatterRaw } = this.processFile(
        absoluteEntryPath,
        [],
        {},
        options.img2b64,
        rootVariables
      );
      result = content;

      if (!options.skipheaders && frontMatterRaw) {
        result = frontMatterRaw + result;
      }

      this.outputResult(result, options.output);
    } catch (error) {
      if (!error.recorded) {
        this.errors.push(error.message);
      }
      this.reportErrors();
      throw error;
    }

    this.reportErrors();
    return result;
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
      rootVariables
    );

    return {
      content: processedContent,
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
    rootVars = null
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
        rootVariables
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
    rootVars = null
  ) {
    const resolvedTemplate = this.applyVariablePlaceholders(
      filePath,
      rootVars || parentVars,
      stack && stack.length ? stack[stack.length - 1] : baseDir
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
      return this.raiseError(`Included file not found: ${resolvedPath}`);
    }

    const rawContent = fs.readFileSync(resolvedPath, "utf8");
    const { body, vars: localVars } = this.extractFrontMatter(rawContent);
    let snippet = body;
    let referenceLevel = null;

    if (sectionTitle) {
      const section = this.extractSection(snippet, sectionTitle);
      snippet = section.content;
      referenceLevel = section.level;
    } else {
      referenceLevel = this.detectLowestHeadingLevel(snippet);
    }

    const mergedVars = this.mergeVariables(localVars, parentVars);
    const processedSnippet = this.processContent(
      snippet,
      path.dirname(resolvedPath),
      stack.concat(resolvedPath),
      mergedVars,
      img2b64,
      rootVars || parentVars
    );

    if (!targetLevel) {
      return processedSnippet;
    }

    return this.adjustToTargetLevel(
      processedSnippet,
      targetLevel,
      referenceLevel
    );
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

  adjustToTargetLevel(content, targetLevelSpec, referenceLevel) {
    const targetLevel = this.parseLevelSpec(targetLevelSpec);

    if (!targetLevel) {
      throw new Error(
        `Invalid level "${targetLevelSpec}" in include directive.`
      );
    }

    if (!referenceLevel) {
      return content;
    }

    const shift = targetLevel - referenceLevel;

    if (shift === 0) {
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
    if (!rawValue) {
      return rawValue;
    }

    return rawValue.replace(/<([^>]+)>/g, (match, rawName) => {
      const name = rawName.trim();

      if (!name) {
        this.raiseError(`Invalid variable name in include path (${currentFile}).`);
      }

      if (!Object.prototype.hasOwnProperty.call(variables, name)) {
        this.raiseError(
          `Variable "${name}" is not defined (referenced in ${currentFile}).`
        );
      }

      return variables[name];
    });
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
      const includePath = this.applyVariablePlaceholders(
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
        this.raiseError(`Included file not found: ${resolvedInclude}`);
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

      if (!Object.prototype.hasOwnProperty.call(variables, name)) {
        return this.raiseError(
          `Variable "${name}" is not defined (referenced in ${currentFile}).`
        );
      }

      return variables[name];
    });
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
}

module.exports = new MdWT();
