module.exports = {
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
  },

  // Parse the front matter body into ordered top-level entries while
  // preserving structure. Each entry is one of:
  //   { key, type: "scalar", rawValue, value }
  //   { key, type: "sequence", indent, items }
  //   { key, type: "block", childLines }   (nested mapping kept verbatim)
  //   { type: "raw", raw }                 (anything we don't recognize)
  parseFrontMatterEntries(block) {
    const entries = [];
    const lines = (block || "").split(/\r?\n/);
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (!line || !line.trim()) {
        i += 1;
        continue;
      }

      const indent = line.length - line.replace(/^\s*/, "").length;

      if (indent > 0) {
        // A stray indented line at the top level we couldn't attach to a
        // parent. Keep it verbatim so nothing is lost.
        entries.push({ type: "raw", raw: line });
        i += 1;
        continue;
      }

      const separatorIndex = line.indexOf(":");

      if (separatorIndex === -1) {
        entries.push({ type: "raw", raw: line });
        i += 1;
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();

      if (!key) {
        entries.push({ type: "raw", raw: line });
        i += 1;
        continue;
      }

      if (rawValue) {
        entries.push({
          key,
          type: "scalar",
          rawValue,
          value: this.normalizeFrontMatterValue(rawValue),
        });
        i += 1;
        continue;
      }

      // Empty value: collect the indented block that belongs to this key.
      const childLines = [];
      let j = i + 1;

      while (j < lines.length) {
        const childLine = lines[j];

        if (childLine && childLine.trim()) {
          const childIndent =
            childLine.length - childLine.replace(/^\s*/, "").length;

          if (childIndent === 0) {
            break;
          }
        }

        childLines.push(childLine);
        j += 1;
      }

      // Drop trailing blank lines that belong to no child.
      while (childLines.length && !childLines[childLines.length - 1].trim()) {
        childLines.pop();
      }

      const nonBlank = childLines.filter((child) => child && child.trim());

      if (nonBlank.length && nonBlank.every((child) => /^\s*-\s+/.test(child))) {
        const indentMatch = nonBlank[0].match(/^(\s*)-/);
        const itemIndent = indentMatch ? indentMatch[1] : "  ";
        const items = nonBlank.map((child) =>
          this.normalizeFrontMatterValue(child.replace(/^\s*-\s+/, ""))
        );
        entries.push({ key, type: "sequence", indent: itemIndent, items });
        i = j;
        continue;
      }

      if (nonBlank.length) {
        entries.push({ key, type: "block", childLines });
        i = j;
        continue;
      }

      entries.push({ key, type: "scalar", rawValue: "", value: "" });
      i += 1;
    }

    return entries;
  },

  parseFrontMatterVars(block) {
    const vars = {};

    this.parseFrontMatterEntries(block).forEach((entry) => {
      if (entry.type === "scalar") {
        vars[entry.key] = entry.value;
        return;
      }

      if (entry.type === "sequence") {
        vars[entry.key] = entry.items.slice();
      }

      // "block" (nested mapping) and "raw" entries are intentionally not
      // exposed as variables — they are preserved structurally on render.
    });

    return vars;
  },

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
  },

  renderFrontMatterBlock(rootVariables = {}, frontMatterRaw = null) {
    const variables = rootVariables || {};
    const entries = this.parseFrontMatterEntries(
      this.stripFrontMatterFences(frontMatterRaw)
    );
    const variableKeys = Object.keys(variables);

    if (!entries.length && !variableKeys.length) {
      return frontMatterRaw || "";
    }

    const newline = this.detectNewline(frontMatterRaw);
    const bom =
      frontMatterRaw && frontMatterRaw.startsWith("\uFEFF") ? "\uFEFF" : "";
    const lines = [];
    const renderedKeys = new Set();

    // 1. Render the entries from the root file in their original order,
    //    merging in any updated values collected from includes.
    entries.forEach((entry) => {
      if (entry.type === "raw") {
        lines.push(entry.raw);
        return;
      }

      renderedKeys.add(entry.key);
      const value = variables[entry.key];

      if (entry.type === "sequence") {
        const items = Array.isArray(value) ? value : entry.items;
        lines.push(`${entry.key}:`);
        items.forEach((item) => {
          lines.push(`${entry.indent}- ${item}`);
        });
        return;
      }

      if (entry.type === "block") {
        lines.push(`${entry.key}:`);
        entry.childLines.forEach((child) => lines.push(child));
        return;
      }

      // scalar — preserve the original raw text unless the collected value
      // is an array (a sequence introduced/extended by an include).
      if (Array.isArray(value)) {
        lines.push(`${entry.key}:`);
        value.forEach((item) => {
          lines.push(`  - ${item}`);
        });
        return;
      }

      lines.push(`${entry.key}: ${entry.rawValue}`);
    });

    // 2. Append variables introduced by includes that the root file did not
    //    declare, in the order they were collected.
    variableKeys.forEach((key) => {
      if (renderedKeys.has(key)) {
        return;
      }

      const value = variables[key];

      if (Array.isArray(value)) {
        lines.push(`${key}:`);
        value.forEach((item) => {
          lines.push(`  - ${item}`);
        });
        return;
      }

      lines.push(`${key}: ${value}`);
    });

    if (!lines.length) {
      return "";
    }

    return `${bom}---${newline}${lines.join(newline)}${newline}---${newline}${newline}`;
  },

  // Remove the BOM and the surrounding --- fences so only the inner content
  // is parsed back into entries.
  stripFrontMatterFences(frontMatterRaw) {
    if (!frontMatterRaw) {
      return "";
    }

    const match = frontMatterRaw.match(/---\r?\n([\s\S]*?)\r?\n---/);
    return match ? match[1] : "";
  },

  detectNewline(sample) {
    if (!sample) {
      return "\n";
    }

    return sample.includes("\r\n") ? "\r\n" : "\n";
  },
};
