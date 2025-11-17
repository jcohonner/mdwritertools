const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

class MdWT {
  constructor() {
    this.includeRegex = /\{!include\(([\s\S]*?)\)!\}/g;
    this.varRegex = /\{!var\(([\s\S]*?)\)!\}/g;
  }

  build(entryFilePath, options = {}) {
    if (!entryFilePath) {
      throw new Error("An entry markdown file must be provided.");
    }

    const absoluteEntryPath = path.resolve(process.cwd(), entryFilePath);
    const { content, frontMatterRaw } = this.processFile(absoluteEntryPath, []);
    let result = content;

    if (!options.skipheaders && frontMatterRaw) {
      result = frontMatterRaw + result;
    }

    this.outputResult(result, options.output);
    return result;
  }

  processFile(filePath, stack, parentVars = {}) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, "utf8");
    const {
      body,
      vars: localVars,
      frontMatterRaw,
    } = this.extractFrontMatter(content);
    const mergedVars = this.mergeVariables(localVars, parentVars);
    const processedContent = this.processContent(
      body,
      path.dirname(filePath),
      stack.concat(filePath),
      mergedVars
    );

    return {
      content: processedContent,
      frontMatterRaw,
      variables: mergedVars,
    };
  }

  processContent(content, baseDir, stack, variables = {}) {
    this.includeRegex.lastIndex = 0;

    let rendered = content.replace(this.includeRegex, (_, directive) => {
      const includeOptions = this.parseDirective(directive);
      return this.handleInclude(includeOptions, baseDir, stack, variables);
    });

    rendered = this.replaceVariables(rendered, variables, stack);
    return rendered;
  }

  parseDirective(rawDirective) {
    const [filePath, sectionTitle, targetLevel] =
      this.splitDirective(rawDirective);

    if (!filePath) {
      throw new Error(
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
    parentVars = {}
  ) {
    const resolvedPath = path.resolve(baseDir, filePath);

    if (stack.includes(resolvedPath)) {
      throw new Error(
        `Circular include detected: ${[...stack, resolvedPath].join(" -> ")}`
      );
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Included file not found: ${resolvedPath}`);
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
      mergedVars
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
        throw new Error(`Invalid variable name in ${currentFile}`);
      }

      if (!Object.prototype.hasOwnProperty.call(variables, name)) {
        throw new Error(
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

      return;
    }

    const absoluteOutputPath = path.resolve(process.cwd(), outputPath);
    fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
    fs.writeFileSync(absoluteOutputPath, content, "utf8");
  }
}

module.exports = new MdWT();
