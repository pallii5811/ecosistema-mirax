#!/usr/bin/env python3
"""Probe staging env backups for Neo4j URI hostnames (no secrets printed)."""
from __future__ import annotations

import re
import socket
import subprocess
import sys

HOST = "root@116.203.137.39"
HOST_RE = re.compile(r"(?:@|//)([^:/@]+)")


def main() -> int:
    print("=== staging Neo4j URI hosts (no credentials) ===")
    remote = (
        "grep -h '^NEO4J_URI=' /home/worker/app/backend-staging/.env "
        "/home/worker/backups/staging-pre-*/.env 2>/dev/null | sort -u"
    )
    proc = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=12", HOST, remote],
        capture_output=True,
        text=True,
        timeout=30,
    )
    lines = [ln.strip() for ln in proc.stdout.splitlines() if ln.strip().startswith("NEO4J_URI=")]
    if not lines:
        print("(no NEO4J_URI lines found)")
    hosts: set[str] = set()
    for line in lines:
        m = HOST_RE.search(line)
        host = m.group(1) if m else "?"
        hosts.add(host)
        print(f"HOST={host}")

    print("\n=== DNS resolution ===")
    any_ok = False
    for h in sorted(hosts):
        if h in ("?", ""):
            continue
        try:
            socket.getaddrinfo(h, 7687)
            print(f"{h}: OK")
            any_ok = True
        except socket.gaierror as exc:
            print(f"{h}: NXDOMAIN ({exc})")

    if hosts and not any_ok:
        print(
            "\nNEO4J_EXTERNAL_ACTION_REQUIRED:\n"
            "current Aura hostname is NXDOMAIN; supply the current connection URI from\n"
            "the Neo4j Aura console or create/restore an Aura instance."
        )
        return 2
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
