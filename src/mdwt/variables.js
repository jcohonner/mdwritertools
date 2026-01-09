const fs = require("fs");
const path = require("path");

module.exports = {
  mergeVariables(localVars = {}, parentVars = {}) {
    const merged = { ...localVars };

    Object.keys(parentVars || {}).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(merged, key)) {
        merged[key] = parentVars[key];
        return;
      }

      const localValue = merged[key];
      const parentValue = parentVars[key];

      if (Array.isArray(localValue) || Array.isArray(parentValue)) {
        const localList = Array.isArray(localValue) ? localValue : [localValue];
        const parentList = Array.isArray(parentValue)
          ? parentValue
          : [parentValue];
        const combined = [...localList, ...parentList];
        const seen = new Set();
        merged[key] = combined.filter((item) => {
          const token = String(item);
          if (seen.has(token)) {
            return false;
          }
          seen.add(token);
          return true;
        });
        return;
      }

      merged[key] = parentValue;
    });

    return merged;
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
  },
};
