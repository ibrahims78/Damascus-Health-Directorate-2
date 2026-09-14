#!/usr/bin/env node
/**
 * Cross-platform Windows package reassembler.
 *
 * It reuses the signed Electron runtime from the current release and replaces
 * only the application archive with the current web/API build. The executable
 * itself still needs to be smoke-tested on Windows before distribution.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const version = "4.0.1";
const releaseDir = path.join(root, "release-artifacts", `v${version}`);
const windowsDir = path.join(releaseDir, "windows");

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true });
}

function extractWindowsZip(archivePath, destination) {
  const extractor = String.raw`
import pathlib
import sys
import zipfile

archive = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2]).resolve()
with zipfile.ZipFile(archive) as bundle:
    for entry in bundle.infolist():
        relative = entry.filename.replace("\\", "/")
        target = (destination / relative).resolve()
        if target != destination and destination not in target.parents:
            raise RuntimeError("unsafe archive path: " + entry.filename)
        if entry.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(entry) as source, target.open("wb") as output:
                output.write(source.read())
`;
  execFileSync("python3", ["-c", extractor, archivePath, destination], { stdio: "inherit" });
}

function buildVariant(variant, webSource, apiSource) {
  const archiveName = `Damascus-Emergency-Inventory-v${version}-Windows-${variant}.zip`;
  const archivePath = path.join(windowsDir, archiveName);
  if (!fs.existsSync(archivePath)) {
    throw new Error(`missing base archive: ${archivePath}`);
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), `dme-${variant.toLowerCase()}-`));
  const extracted = path.join(work, "extract");
  const stage = path.join(work, "asar-stage");
  const asarPath = path.join(work, "app.asar");
  const appName = `Damascus-Emergency-Inventory-${version}`;
  const appDir = path.join(extracted, appName);

  try {
    fs.mkdirSync(extracted, { recursive: true });
    extractWindowsZip(archivePath, extracted);
    const extractedEntries = fs
      .readdirSync(extracted, { withFileTypes: true })
      .filter((entry) => entry.isDirectory());
    if (extractedEntries.length !== 1) {
      throw new Error(`expected one application directory in ${archiveName}`);
    }
    const oldAppDir = path.join(extracted, extractedEntries[0].name);
    fs.renameSync(oldAppDir, appDir);

    fs.mkdirSync(path.join(stage, "electron"), { recursive: true });
    fs.copyFileSync(
      path.join(releaseDir, "scripts", "main-template.cjs"),
      path.join(stage, "electron", "main.cjs"),
    );
    const preload = path.join(root, "release-artifacts", "v3", "electron", "preload.cjs");
    if (fs.existsSync(preload)) {
      fs.copyFileSync(preload, path.join(stage, "electron", "preload.cjs"));
    }
    fs.writeFileSync(
      path.join(stage, "package.json"),
      JSON.stringify({
        name: "damascus-emergency-inventory-desktop",
        productName: "Damascus Emergency Inventory",
        version,
        main: "electron/main.cjs",
      }),
    );

    const appStage = path.join(stage, "app");
    copyDirectory(webSource, path.join(appStage, "web"));
    copyDirectory(apiSource, path.join(appStage, "api"));
    fs.mkdirSync(path.join(appStage, "schema"), { recursive: true });
    fs.copyFileSync(
      path.join(root, "lib", "db", "desktop-schema.sql"),
      path.join(appStage, "schema", "desktop-schema.sql"),
    );
    fs.copyFileSync(
      path.join(releaseDir, "license-public-keys", "windows.b64"),
      path.join(appStage, "license-public-key.b64"),
    );

    run("pnpm", [
      "dlx",
      "@electron/asar@3.2.17",
      "pack",
      stage,
      asarPath,
    ]);
    fs.mkdirSync(path.join(appDir, "resources"), { recursive: true });
    fs.copyFileSync(asarPath, path.join(appDir, "resources", "app.asar"));

    fs.rmSync(archivePath, { force: true });
    run("zip", ["-qr", archivePath, appName], extracted);
    console.log(`rebuilt ${archiveName}: ${fs.statSync(archivePath).size} bytes`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

buildVariant(
  "Offline",
  path.join(root, "artifacts", "web", "dist", "public"),
  path.join(root, "artifacts", "api-server", "dist"),
);
buildVariant(
  "Protected",
  path.join(root, "artifacts", "web", "dist", "protected-windows", "public"),
  path.join(root, "artifacts", "api-server", "dist", "protected"),
);

const checksumLines = fs
  .readdirSync(windowsDir)
  .filter((name) => name.endsWith(".zip"))
  .sort()
  .map((name) => {
    const filePath = path.join(windowsDir, name);
    const hash = execFileSync("sha256sum", [filePath], { encoding: "utf8" }).split(/\s+/)[0];
    return `${hash}  ${name}`;
  });
fs.writeFileSync(path.join(windowsDir, "SHA256SUMS"), `${checksumLines.join("\n")}\n`);