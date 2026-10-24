const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ts = require("typescript");
const postcss = require("postcss");
const roots = ["apps/web/src", "apps/api/app"];
function files(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    if (entry.name.startsWith("__") && entry.isDirectory()) return [];
    return entry.isDirectory()
      ? files(file)
      : /\.(tsx?|py|css)$/.test(file)
        ? [file]
        : [];
  });
}
const sources = roots.flatMap(files);
const windows = new Map();
const cssDuplicates = [];
const windowSize = 12;
for (const file of sources) {
  const text = fs.readFileSync(file, "utf8");
  if (file.endsWith(".css")) {
    function inspect(parent, scope) {
      const selectors = new Map();
      for (const node of parent.nodes || []) {
        if (node.type === "rule") {
          if (selectors.has(node.selector))
            cssDuplicates.push({
              file,
              scope,
              selector: node.selector,
              lines: [selectors.get(node.selector), node.source.start.line],
            });
          selectors.set(node.selector, node.source.start.line);
        }
        if (node.type === "atrule")
          inspect(node, `${scope}/${node.name} ${node.params}`);
      }
    }
    inspect(postcss.parse(text), "root");
    continue;
  }
  const ignored = new Set();
  if (/\.tsx?$/.test(file)) {
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const start = ast.getLineAndCharacterOfPosition(
        statement.getStart(),
      ).line;
      const end = ast.getLineAndCharacterOfPosition(statement.end).line;
      for (let line = start; line <= end; line++) ignored.add(line);
    }
  }
  const lines = text
    .split(/\r?\n/)
    .map((content, index) => ({
      text: content.trim().replace(/\s+/g, " "),
      line: index + 1,
    }))
    .filter(
      (line, index) =>
        !ignored.has(index) &&
        /[a-zA-Z]/.test(line.text) &&
        !/^(?:import |from |#|\/\/|\*|"use client")/.test(line.text),
    );
  for (let index = 0; index <= lines.length - windowSize; index++) {
    const block = lines.slice(index, index + windowSize);
    const hash = crypto
      .createHash("sha256")
      .update(block.map((line) => line.text).join("\n"))
      .digest("hex");
    const locations = windows.get(hash) || [];
    locations.push({ file, start: block[0].line, end: block.at(-1).line });
    windows.set(hash, locations);
  }
}
const covered = [];
const clones = [];
for (const locations of windows.values()) {
  if (locations.length < 2) continue;
  if (
    locations.every((location) =>
      covered.some(
        (previous) =>
          previous.file === location.file &&
          previous.start <= location.start &&
          previous.end >= location.end,
      ),
    )
  )
    continue;
  clones.push({ locations });
  covered.push(...locations);
}
const report = {
  method:
    "Exact windows of 12 significant normalized source lines, excluding TypeScript imports and comments; candidates require human review and are not semantic clone detection. CSS checks identical selector text within the same block.",
  files: sources.length,
  sourceLines: sources.reduce(
    (count, file) =>
      count + fs.readFileSync(file, "utf8").split(/\r?\n/).length,
    0,
  ),
  cloneCandidates: clones,
  repeatedCssSelectors: cssDuplicates,
};
fs.mkdirSync("test-reports", { recursive: true });
fs.writeFileSync(
  "test-reports/code-quality.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    files: report.files,
    sourceLines: report.sourceLines,
    cloneCandidates: clones.length,
    repeatedCssSelectors: cssDuplicates.length,
  }),
);
