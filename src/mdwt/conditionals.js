module.exports = {
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
  },

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
        currentCondition = null;
        cursor = tokenRegex.lastIndex;
        match = tokenRegex.exec(content);
        continue;
      }

      match = tokenRegex.exec(content);
    }

    throw new Error(
      `Missing ${this.endIfToken} for conditional in ${currentFile}.`
    );
  },

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

    const value = rootVars[name];

    if (Array.isArray(value)) {
      return value.map(String).includes(expectedValue);
    }

    return String(value) === expectedValue;
  },

  shouldKeepBranch(rawCondition, rootVars, currentFile) {
    if (rawCondition === null) {
      return true;
    }

    return this.shouldKeepBlock(rawCondition, rootVars, currentFile);
  },

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
  },
};
