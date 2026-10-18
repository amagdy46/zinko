# Keep this tag in step with the `playwright` version in package.json: the image ships matching browsers.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /app
# package-lock.json pins the whole dependency tree: `npm ci` fails instead of drifting when it
# disagrees with package.json. After changing a dependency, run `npm install --package-lock-only`.
COPY --chown=pwuser:pwuser package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && chown -R pwuser:pwuser /app
COPY --chown=pwuser:pwuser src ./src

# the image ships an unprivileged user; Chromium runs with --no-sandbox because containers can't nest sandboxes
USER pwuser
ENV PORT=8080
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "src/server.ts"]
