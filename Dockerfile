FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="ndx tool sandbox"
LABEL org.opencontainers.image.description="Workspace-bound sandbox for ndx shell and tool execution."

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates git patch python3 \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable \
    && mkdir -p /workspace \
    && printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' 'python3 - "$@" <<'"'"'PY'"'"'' 'import pathlib, subprocess, sys, tempfile' 'patch = sys.stdin.read()' 'with tempfile.NamedTemporaryFile("w", delete=False) as f:' '    f.write(patch)' '    path = f.name' 'result = subprocess.run(["patch", "-p0", "-i", path], text=True)' 'sys.exit(result.returncode)' 'PY' > /usr/local/bin/apply_patch \
    && chmod +x /usr/local/bin/apply_patch

WORKDIR /workspace

CMD ["sleep", "infinity"]
