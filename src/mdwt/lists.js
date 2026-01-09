module.exports = {
  processLists(content, currentFile = "<unknown>") {
    if (!content) {
      return content;
    }

    const { contentWithoutItems, lists } = this.collectListItems(
      content,
      currentFile
    );

    return this.renderListTables(contentWithoutItems, lists, currentFile);
  },

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
  },

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
  },

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
  },

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
    const bodyRows = items.map(
      (item) =>
        `| ${columns
          .map((column) =>
            this.escapeTableCell(this.formatTableValue(column.field, item))
          )
          .join(" | ")} |`
    );

    return [headerRow, separatorRow, ...bodyRows].join("\n");
  },

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
  },

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
  },

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
  },

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
  },

  escapeTableCell(value) {
    return String(value || "")
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, "<br>");
  },

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
  },
};
