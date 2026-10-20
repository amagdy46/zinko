# Keep this tag in step with the `playwright` version in package.json: the image ships matching browsers.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

# uv installs the Scrapling engine's Python dependencies from scrapling/uv.lock.
COPY --from=ghcr.io/astral-sh/uv:0.9.21 /uv /usr/local/bin/uv
# tini reaps the Chromium processes the server kills: as PID 1, Node would leave them as zombies.
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# package-lock.json pins the whole dependency tree: `npm ci` fails instead of drifting when it
# disagrees with package.json. After changing a dependency, run `npm install --package-lock-only`.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Python lives outside /root so the unprivileged user can run the venv that links to it.
ENV UV_PYTHON_INSTALL_DIR=/opt/uv-python UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1
COPY scrapling/pyproject.toml scrapling/uv.lock scrapling/
# patchright's Chromium goes to the image's PLAYWRIGHT_BROWSERS_PATH, next to Playwright's.
RUN cd scrapling && uv sync --frozen --no-dev && .venv/bin/patchright install chromium

COPY src ./src
COPY scrapling/capture.py scrapling/
RUN chown -R pwuser:pwuser /app

# the image ships an unprivileged user; Chromium runs with --no-sandbox because containers can't nest sandboxes
USER pwuser
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--experimental-strip-types", "src/server.ts"]
