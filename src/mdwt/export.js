const fs = require("fs");
const path = require("path");

module.exports = {
  exportLists(entryFilePath, options = {}) {
    const absoluteEntryPath = path.resolve(process.cwd(), entryFilePath);
    const { lists, listsConfig } = this.collectListsFromDocument(absoluteEntryPath);

    const listNames = options.list
      ? [options.list]
      : Object.keys(lists);

    if (!listNames.length) {
      console.error("No lists found in document.");
      return;
    }

    const prefix = this.resolveExportPrefix(absoluteEntryPath, options.output);
    const format = (options.format || "csv").toLowerCase();

    for (const listName of listNames) {
      if (!lists[listName]) {
        console.error(`List "${listName}" not found in document.`);
        continue;
      }

      const config = listsConfig[listName] || {};
      const exportKey = config.name || listName;
      const outputPath = `${prefix}${exportKey}.${format}`;
      const items = lists[listName];
      const columns = this.resolveExportColumns(items, config.columns);
      const content =
        format === "json"
          ? this.serializeListJSON(items, columns)
          : this.serializeListCSV(items, columns);

      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, content, "utf8");
      console.log(`Exported ${items.length} item(s) to ${outputPath}`);
    }
  },

  collectListsFromDocument(absoluteEntryPath) {
    this.errors = [];
    const rootVariables = this.collectVariables(absoluteEntryPath, [], {});
    const { content, frontMatterRaw } = this.processFile(
      absoluteEntryPath,
      [],
      {},
      false,
      rootVariables,
      { replaceVariables: true, processListsAtRoot: false, processConditionals: true }
    );
    const { lists } = this.collectListItems(content, absoluteEntryPath);
    const listsConfig = this.parseListsConfig(frontMatterRaw || "");
    this.reportErrors();
    return { lists, listsConfig };
  },

  parseListsConfig(frontMatterRaw) {
    if (!frontMatterRaw) return {};

    const match = frontMatterRaw.match(/---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};

    const lines = match[1].split(/\r?\n/);
    const result = {};

    let state = "root";
    let listsIndent = -1;
    let listEntryIndent = -1;
    let columnsIndent = -1;
    let currentList = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      const indent = (line.match(/^(\s*)/) || ["", ""])[1].length;
      const trimmed = line.trim();

      if (state === "root") {
        if (trimmed === "lists:") {
          state = "lists";
          listsIndent = indent;
          listEntryIndent = -1;
        }
        continue;
      }

      if (state === "lists") {
        if (indent <= listsIndent) {
          state = "root";
          i--;
          continue;
        }
        if (listEntryIndent === -1) listEntryIndent = indent;
        if (indent === listEntryIndent) {
          const m = trimmed.match(/^([\w-]+):\s*$/);
          if (m) {
            currentList = m[1];
            result[currentList] = { columns: {} };
            state = "list-entry";
          }
        }
        continue;
      }

      if (state === "list-entry") {
        if (indent <= listsIndent) {
          state = "root";
          i--;
          continue;
        }
        if (indent === listEntryIndent) {
          const m = trimmed.match(/^([\w-]+):\s*$/);
          if (m) {
            currentList = m[1];
            result[currentList] = { columns: {} };
          }
          continue;
        }
        if (trimmed === "columns:") {
          columnsIndent = indent;
          state = "columns";
          continue;
        }
        const sep = trimmed.indexOf(":");
        if (sep !== -1 && currentList) {
          const key = trimmed.slice(0, sep).trim();
          const val = trimmed.slice(sep + 1).trim();
          result[currentList][key] = val;
        }
        continue;
      }

      if (state === "columns") {
        if (indent <= columnsIndent) {
          state = "list-entry";
          i--;
          continue;
        }
        if (currentList) {
          const sep = trimmed.indexOf(":");
          if (sep !== -1) {
            const field = trimmed.slice(0, sep).trim();
            const label = trimmed.slice(sep + 1).trim() || field;
            result[currentList].columns[field] = label;
          }
        }
        continue;
      }
    }

    return result;
  },

  resolveExportPrefix(absoluteEntryPath, outputOption) {
    if (outputOption) return outputOption;
    const dir = path.dirname(absoluteEntryPath);
    const base = path.basename(absoluteEntryPath, path.extname(absoluteEntryPath));
    return path.join(dir, base) + "-";
  },

  resolveExportColumns(items, columnsConfig) {
    if (!columnsConfig || !Object.keys(columnsConfig).length) {
      return this.deriveColumnsFromItems(items);
    }
    return Object.entries(columnsConfig).map(([field, label]) => ({
      field,
      label: label || field,
    }));
  },

  serializeListCSV(items, columns) {
    const header = columns.map((col) => this.escapeCsvField(col.label)).join(",");
    const rows = items.map((item) =>
      columns
        .map((col) => this.escapeCsvField(this.getExportItemValue(col.field, item)))
        .join(",")
    );
    return [header, ...rows].join("\n") + "\n";
  },

  serializeListJSON(items, columns) {
    const objects = items.map((item) => {
      const obj = {};
      columns.forEach((col) => {
        obj[col.label] = this.getExportItemValue(col.field, item);
      });
      return obj;
    });
    return JSON.stringify(objects, null, 2) + "\n";
  },

  getExportItemValue(field, item) {
    if (field === "path") return item.pathText || "";
    return Object.prototype.hasOwnProperty.call(item.attributes, field)
      ? item.attributes[field]
      : "";
  },

  escapeCsvField(value) {
    const str = String(value || "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  },
};
