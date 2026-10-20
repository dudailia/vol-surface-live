#!/usr/bin/env python3
"""Compare what is running on Fly with the allowed list in scripts/fly-allowed.json.

Prints one line per difference and exits 1 if there are any, 2 if Fly could not be read.
Needs flyctl and a token (FLY_API_TOKEN) that can read the org; a read-only one is enough.
Run weekly by .github/workflows/fly-audit.yml, which opens an issue on a difference.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

ALLOWED = json.loads((Path(__file__).parent / "fly-allowed.json").read_text())


def fly(*args: str) -> str:
    """Run flyctl, retrying twice: Fly's API sometimes answers 503 for a moment."""
    for attempt in range(3):
        r = subprocess.run(["flyctl", *args], capture_output=True, text=True, timeout=120)
        if r.returncode == 0:
            return r.stdout
        time.sleep(10 * (attempt + 1))
    print(f"could not run flyctl {' '.join(args)}: {r.stderr.strip()[:300]}")
    sys.exit(2)


def fly_json(*args: str) -> Any:
    return json.loads(fly(*args, "--json") or "[]")


def table_rows(text: str) -> int:
    """Data rows in a flyctl table (lines with a column separator, minus the header)."""
    rows = [ln for ln in text.splitlines() if "│" in ln or "|" in ln]
    return max(len(rows) - 1, 0)


def main() -> int:
    org = ALLOWED["org"]
    problems: list[str] = []

    apps = sorted(a["Name"] for a in fly_json("apps", "list", "--org", org))
    if apps != sorted(ALLOWED["apps"]):
        problems.append(f"apps: {apps}, allowed {ALLOWED['apps']}")

    for app in apps:
        machines = fly_json("machines", "list", "-a", app)
        if len(machines) != len(ALLOWED["machines"]):
            problems.append(f"{app}: {len(machines)} machines, allowed {len(ALLOWED['machines'])}")
        want = ALLOWED["machines"][0]
        for m in machines:
            g = m["config"].get("guest", {})
            got = {"region": m["region"], "cpu_kind": g.get("cpu_kind"), "cpus": g.get("cpus"),
                   "memory_mb": g.get("memory_mb")}
            if got != want:
                problems.append(f"{app}: machine {m['id']} is {got}, allowed {want}")

        volumes = fly_json("volumes", "list", "-a", app)
        sizes = sorted(v["size_gb"] for v in volumes)
        if sizes != sorted(v["size_gb"] for v in ALLOWED["volumes"]):
            allowed = [v["size_gb"] for v in ALLOWED["volumes"]]
            problems.append(f"{app}: volumes of {sizes} GB, allowed {allowed}")
        snap_bytes = 0
        for v in volumes:
            snaps = fly_json("volumes", "snapshots", "list", v["id"], "-a", app)
            snap_bytes += sum(s.get("size", 0) for s in snaps)
        if snap_bytes > ALLOWED["snapshot_gb_max"] * 1e9:
            problems.append(f"{app}: volume snapshots hold {snap_bytes / 1e9:.1f} GB, "
                            f"over the {ALLOWED['snapshot_gb_max']} GB Fly does not bill")

        ips = [i["Type"] for i in fly_json("ips", "list", "-a", app)]
        extra = [t for t in ips if t not in ALLOWED["ip_types"]]
        if extra:
            problems.append(f"{app}: IP addresses of type {extra} "
                            "(a dedicated IPv4 costs $2/month)")

        certs = fly_json("certs", "list", "-a", app)
        if len(certs) > ALLOWED["certificates"]:
            problems.append(f"{app}: {len(certs)} certificates, allowed {ALLOWED['certificates']}")

    if (n := table_rows(fly("redis", "list"))) > 0:
        problems.append(f"{n} Upstash Redis database(s)")
    if (n := table_rows(fly("storage", "list"))) > 0:
        problems.append(f"{n} Tigris bucket(s)")
    mpg = fly("mpg", "list", "--org", org)
    if "No managed postgres clusters found" not in mpg:
        problems.append("managed Postgres cluster(s):\n" + mpg.strip())

    for p in problems:
        print(p)
    if not problems:
        print("Fly matches the allowed list:", json.dumps(ALLOWED))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
