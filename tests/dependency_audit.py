"""Read-only OSV audit of the deployed Python inventory; no packages are installed."""

import json
import sys
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path


def main() -> int:
    packages = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
    body = {
        "queries": [
            {
                "package": {"name": item["name"], "ecosystem": "PyPI"},
                "version": item["version"],
            }
            for item in packages
            if item["name"] != "synqra-api"
        ]
    }
    report = {
        "source": "https://api.osv.dev/v1/querybatch",
        "checked_at": datetime.now(UTC).isoformat(),
        "packages": len(body["queries"]),
    }
    try:
        request = urllib.request.Request(
            report["source"],
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=25) as response:
            results = json.load(response)["results"]
        report["findings"] = [
            {
                "package": query["package"]["name"],
                "version": query["version"],
                "advisories": result["vulns"],
            }
            for query, result in zip(body["queries"], results, strict=True)
            if result.get("vulns")
        ]
        report["status"] = "completed"
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as error:
        report["status"] = "unavailable"
        report["error"] = str(error)
    Path("test-reports/python-audit.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    print(json.dumps(report))
    return 0 if report["status"] == "completed" and not report["findings"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
