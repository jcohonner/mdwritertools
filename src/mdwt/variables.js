const fs = require("fs");
const path = require("path");

module.exports = {
  mergeVariables(localVars = {}, parentVars = {}) {
    const merged = {};

    // Preserve the parent (root/ancestor) ordering first so the rendered
    // front matter keeps the same key order as the parent file.
    Object.keys(parentVars || {}).forEach((key) => {
      const parentValue = parentVars[key];

      if (!Object.prototype.hasOwnProperty.call(localVars, key)) {
        merged[key] = parentValue;
        return;
      }

      const localValue = localVars[key];

      if (Array.isArray(localValue) || Array.isArray(parentValue)) {
        merged[key] = this.mergeListValues(parentValue, localValue);
        return;
      }

      // Nested mappings cascade like the document itself: combine sub-keys
      // from both sides (parent/root wins on leaf conflicts) instead of
      // replacing the whole mapping, so dotted paths survive splits across
      // the entry document and its includes.
      if (this.isPlainObject(localValue) && this.isPlainObject(parentValue)) {
        merged[key] = this.mergeVariables(localValue, parentValue);
        return;
      }

      // Scalar conflict: the parent (root/ancestor) value wins.
      merged[key] = parentValue;
    });

    // Append keys introduced locally that the parent did not declare, in
    // their original order, so new variables land at the bottom.
    Object.keys(localVars || {}).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(merged, key)) {
        merged[key] = localVars[key];
      }
    });

    return merged;
  },

  isPlainObject(value) {
    return (
      value !== null && typeof value === "object" && !Array.isArray(value)
    );
  },

  mergeListValues(parentValue, localValue) {
    const parentList = Array.isArray(parentValue)
      ? parentValue
      : [parentValue];
    const localList = Array.isArray(localValue) ? localValue : [localValue];
    const combined = [...parentList, ...localList];
    const seen = new Set();

    return combined.filter((item) => {
      const token = String(item);
      if (seen.has(token)) {
        return false;
      }
      seen.add(token);
      return true;
    });
  },

  applyVariablePlaceholders(rawValue, variables = {}, currentFile = "<unknown>") {
    const { value } = this.resolveTemplateWithVariables(
      rawValue,
      variables,
      currentFile
    );
    return value;
  },

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
      const { value: includePath, placeholders } =
        this.resolveTemplateWithVariables(
          includeOptions.filePath,
          accumulated,
          resolvedPath
        );

      if (!includePath) {
        match = includeRegex.exec(body);
        continue;
      }

      const resolvedInclude = path.resolve(
        path.dirname(resolvedPath),
        includePath
      );

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
  },

  // Resolve a variable name against the collected variables. Supports dotted
  // notation to reach into nested mappings, e.g. "lists.checklist.drive-file".
  // A direct (own) property match wins first, so flat names are unaffected.
  resolveVariablePath(variables, name) {
    if (!variables || typeof variables !== "object") {
      return undefined;
    }

    if (Object.prototype.hasOwnProperty.call(variables, name)) {
      return variables[name];
    }

    if (name.indexOf(".") === -1) {
      return undefined;
    }

    let current = variables;
    for (const part of name.split(".")) {
      if (
        current === null ||
        typeof current !== "object" ||
        Array.isArray(current) ||
        !Object.prototype.hasOwnProperty.call(current, part)
      ) {
        return undefined;
      }
      current = current[part];
    }

    return current;
  },

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

      const value = this.resolveVariablePath(variables, name);

      if (value === undefined || value === null) {
        return this.raiseError(
          `Variable "${name}" is used but not declared or null (referenced in ${currentFile}).`
        );
      }

      if (typeof value === "object" && !Array.isArray(value)) {
        return this.raiseError(
          `Variable "${name}" refers to a nested mapping, not a value (referenced in ${currentFile}). Use a dotted path to a leaf value.`
        );
      }

      return value;
    });
  },

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

      const resolved = this.resolveVariablePath(variables, name);

      if (resolved === undefined || resolved === null) {
        this.raiseError(
          `Variable "${name}" is used but not declared or null (referenced in ${currentFile}).`
        );
      }

      if (typeof resolved === "object" && !Array.isArray(resolved)) {
        this.raiseError(
          `Variable "${name}" refers to a nested mapping, not a value (referenced in ${currentFile}). Use a dotted path to a leaf value.`
        );
      }

      placeholders.push(name);
      return resolved;
    });

    return { value, placeholders };
  },
};
