"""Exercise real dependency outages only in the explicitly named test Compose project.

Run under Linux/WSL from this workspace, with the isolated stack already running.
Every stopped dependency is restored in a finally block, including on assertion failure.
"""

import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = ["docker", "compose", "-p", "synqra-test", "-f", str(ROOT / "tests/compose.yml")]
BASE = "http://localhost:8010/api/v1"


def compose(*args):
    subprocess.run([*COMPOSE, *args], cwd=ROOT, check=True, timeout=45, capture_output=True)


def request(path):
    started = time.monotonic()
    try:
        response = urllib.request.urlopen(f"{BASE}/{path}", timeout=8)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, json.load(response), round(time.monotonic() - started, 3)


def wait_ready():
    for _ in range(30):
        try:
            if request("ready")[0] == 200:
                return
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(1)
    raise AssertionError("Dependencies did not recover")


def main():
    evidence = []
    # Check the running container's mode, rather than trusting host environment variables.
    compose("exec", "-T", "api", "python", "-c", "from app.core.config import settings; assert settings().test_mode")
    wait_ready()
    # This probes the API dependency contract, not worker failover. Pause the worker
    # gracefully so deliberate Redis loss cannot leave an orphaned scheduler lock.
    compose("stop", "worker")
    try:
        for services, expected in [
            (["redis"], {"database": True, "redis": False}),
            (["postgres"], {"database": False, "redis": True}),
            (["postgres", "redis"], {"database": False, "redis": False}),
        ]:
            try:
                compose("stop", *services)
                status, body, duration = request("ready")
                print(json.dumps({"stopped": services, "body": body, "seconds": duration}), flush=True)
                assert status == 503, body
                assert body["dependencies"] == expected, body
                assert duration < 5, duration
                assert request("health")[0] == 200
                evidence.append({"stopped": services, "status": status, "body": body, "seconds": duration})
            finally:
                compose("start", *services)
                wait_ready()
    finally:
        compose("up", "-d", "--no-build", "worker")
    evidence.append({"recovered": request("ready")[1]})
    path = ROOT / "test-reports/readiness-outages.json"
    path.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(path.read_text())


if __name__ == "__main__":
    main()
