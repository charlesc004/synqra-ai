const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const excluded = new Set([
  "node_modules", ".venv", ".git", ".next", ".next-dev", "__pycache__",
  ".mypy_cache", ".ruff_cache", ".pytest_cache", ".tmp",
  "playwright-report", "test-results", "test-reports",
]);
const textFile = /\.(?:[cm]?[jt]sx?|py|css|html?|svg|md|txt|jsonl?|ya?ml|toml|ini|sql|lock|example)$/i;
const specialFiles = new Set(["Dockerfile", ".gitignore", ".dockerignore"]);
const forbidden = /[\p{Script=Arabic}\u0660-\u0669\u06f0-\u06f9]/u;
const findings = [];
let scannedFiles = 0;

function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const file = path.join(directory, entry.name);
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (forbidden.test(entry.name)) findings.push({ file: relative, reason: "Non-English filename" });
    if (entry.isDirectory()) {
      scan(file);
    } else if (entry.isFile() && (textFile.test(entry.name) || specialFiles.has(entry.name))) {
      scannedFiles++;
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (forbidden.test(line)) findings.push({ file: relative, line: index + 1, reason: "Arabic-script content or digits" });
      });
    }
  }
}

scan(root);
const report = {
  scope: "First-party text files and filenames; excludes dependencies, build output, caches and generated test artifacts. Detects Arabic-script characters and Arabic/Persian digits; not a general natural-language classifier.",
  scannedFiles,
  findings,
};
fs.mkdirSync(path.join(root, "test-reports"), { recursive: true });
fs.writeFileSync(path.join(root, "test-reports/english-content.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ scannedFiles, findings: findings.length }));
for (const finding of findings) console.error(`${finding.file}:${finding.line || 1}: ${finding.reason}`);
process.exitCode = findings.length ? 1 : 0;
