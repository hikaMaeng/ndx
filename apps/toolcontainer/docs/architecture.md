# Architecture

The Dockerfile installs Node 22, shell utilities, Python, ripgrep, Playwright
Chromium, and the sandbox `apply_patch` helper. The root compose file builds
this directory as the `ndx-sandbox` image context.

