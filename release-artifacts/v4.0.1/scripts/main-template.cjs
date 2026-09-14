const { app, BrowserWindow, dialog } = require("electron");
const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const { URL, pathToFileURL } = require("node:url");

const RELEASE_VERSION = "4.0.1";
const EXTERNAL_API_BASE_URL = process.env.DAMASCUS_API_URL;
const WEB_ROOT = path.resolve(__dirname, "../app/web");
const API_ENTRY = path.resolve(__dirname, "../app/api/index.mjs");
const DESKTOP_SCHEMA_PATH = path.resolve(__dirname, "../app/schema/desktop-schema.sql");

let desktopWindow;
let localServer;
let apiBaseUrl;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function isApiPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function copyHeaders(headers) {
  const copied = {};
  for (const [name, value] of headers.entries()) {
    if (!["connection", "content-length", "transfer-encoding"].includes(name)) {
      copied[name] = value;
    }
  }
  return copied;
}

async function proxyApi(request, response) {
  try {
    if (!apiBaseUrl) {
      throw new Error("The desktop API server is not ready.");
    }

    const requestUrl = new URL(request.url, "http://127.0.0.1");
    const targetUrl = new URL(requestUrl.pathname + requestUrl.search, apiBaseUrl);
    const headers = { ...request.headers };
    delete headers.host;
    delete headers.connection;

    const method = request.method || "GET";
    const body =
      method === "GET" || method === "HEAD" ? undefined : await readRequestBody(request);
    const upstream = await fetch(targetUrl, {
      method,
      headers,
      body: body && body.length > 0 ? body : undefined,
    });

    response.writeHead(upstream.status, copyHeaders(upstream.headers));
    if (method === "HEAD") {
      response.end();
      return;
    }

    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error("API proxy error:", error);
    const payload = JSON.stringify({
      error: "The desktop app could not reach the API server.",
      details: error instanceof Error ? error.message : String(error),
    });
    response.writeHead(502, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(payload),
    });
    response.end(payload);
  }
}

function findAvailablePort() {
  // FIXED preferred port (41789) keeps the API origin stable. If busy,
  // fall back to an OS-assigned port.
  return new Promise((resolve, reject) => {
    const startRandom = () => {
      const probe = net.createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        if (!address || typeof address === "string") {
          probe.close();
          reject(new Error("Could not determine an available local port."));
          return;
        }
        const port = address.port;
        probe.close((error) => (error ? reject(error) : resolve(port)));
      });
    };
    const probe = net.createServer();
    probe.once("error", () => {
      probe.close();
      startRandom();
    });
    probe.listen(41789, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("Could not determine an available local port."));
        return;
      }
      const port = address.port;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForApi(baseUrl) {
  const healthUrl = new URL("/api/healthz", baseUrl);
  const deadline = Date.now() + 30_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
      lastError = new Error(`API health check returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(
    `The local API server did not become ready.${lastError ? ` ${lastError.message}` : ""}`,
  );
}

async function startEmbeddedApi() {
  if (EXTERNAL_API_BASE_URL) {
    apiBaseUrl = EXTERNAL_API_BASE_URL;
    return;
  }

  if (!fs.existsSync(API_ENTRY)) {
    throw new Error("The bundled API server is missing. Rebuild the desktop application.");
  }

  if (!fs.existsSync(DESKTOP_SCHEMA_PATH)) {
    throw new Error("The bundled desktop database schema is missing. Rebuild the desktop application.");
  }

  const port = await findAvailablePort();
  process.env.DAMASCUS_DESKTOP = "1";
  process.env.DAMASCUS_SCHEMA_PATH = DESKTOP_SCHEMA_PATH;
  process.env.DAMASCUS_DATA_DIR = path.join(app.getPath("userData"), "data");
  process.env.PORT = String(port);

  await import(pathToFileURL(API_ENTRY).href);
  apiBaseUrl = `http://127.0.0.1:${port}`;
  await waitForApi(apiBaseUrl);
}

function resolveStaticFile(pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relativePath = decodedPath.replace(/^\/+/, "");
  const candidate = path.resolve(WEB_ROOT, relativePath || "index.html");
  if (candidate !== WEB_ROOT && !candidate.startsWith(`${WEB_ROOT}${path.sep}`)) {
    return null;
  }

  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate;
  }

  if (!path.extname(candidate)) {
    return path.join(WEB_ROOT, "index.html");
  }

  return null;
}

function serveStatic(request, response) {
  const requestUrl = new URL(request.url, "http://127.0.0.1");
  const filePath = resolveStaticFile(requestUrl.pathname);
  if (!filePath) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = contentTypes[extension] || "application/octet-stream";
  const stat = fs.statSync(filePath);
  response.writeHead(200, {
    "content-type": contentType,
    "content-length": stat.size,
    "cache-control": extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  fs.createReadStream(filePath).pipe(response);
}

function startLocalServer() {
  return new Promise((resolve, reject) => {
    localServer = http.createServer((request, response) => {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (isApiPath(pathname)) {
        void proxyApi(request, response);
        return;
      }
      serveStatic(request, response);
    });

    localServer.once("error", (err) => {
      // fixed preferred port (41790) busy — fall back to an OS-assigned one
      startRandom();
    });
    const startRandom = () => {
      localServer.once("error", reject);
      localServer.listen(0, "0.0.0.0", () => {
        const address = localServer.address();
        if (!address || typeof address === "string") {
          reject(new Error("Could not determine the desktop server port."));
          return;
        }
        resolve(address.port);
      });
    };
    localServer.listen(41790, "0.0.0.0", () => {
      const address = localServer.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not determine the desktop server port."));
        return;
      }
      resolve(address.port);
    });
  });
}

async function createWindow() {
  if (!fs.existsSync(path.join(WEB_ROOT, "index.html"))) {
    throw new Error("The bundled web application is missing. Run `pnpm run prepare-web` first.");
  }

  await startEmbeddedApi();
  const port = await startLocalServer();
  const desktopPreload = path.join(__dirname, "preload.cjs");
  desktopWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#f8fafc",
    autoHideMenuBar: true,
        webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      ...(fs.existsSync(desktopPreload) ? { preload: desktopPreload } : {}),
    },
  });

  desktopWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error(`Desktop page failed to load (${errorCode}): ${errorDescription}`);
  });
  desktopWindow.on("closed", () => {
    desktopWindow = undefined;
  });
  await desktopWindow.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(async () => {
  try {
    await createWindow();
  } catch (error) {
    console.error(error);
    await dialog.showMessageBox({
      type: "error",
      title: "Damascus Emergency Inventory",
message: "تعذر تشغيل تطبيق سطح المكتب.",
      detail: error instanceof Error ? error.message : String(error),
    });
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  localServer?.close();
});

app.setAboutPanelOptions({
  applicationName: "Damascus Emergency Inventory",
  applicationVersion: RELEASE_VERSION,
  version: RELEASE_VERSION,
  copyright: "Damascus Emergency Inventory",
});
