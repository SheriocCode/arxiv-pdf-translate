import path from "node:path";
import fs from "node:fs";
import { app } from "electron";

export function engineDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "engine")
    : path.join(app.getAppPath(), "engine");
}

export function pythonExe(): string {
  const runtime = path.join(engineDir(), "runtime");
  return path.join(runtime, process.platform === "win32" ? "python.exe" : "python");
}

export function runScript(): string {
  return path.join(engineDir(), "run.py");
}

export function engineVersion(): string {
  try {
    return fs.readFileSync(path.join(engineDir(), "VERSION"), "utf8").trim();
  } catch {
    return "";
  }
}

export function userDataDir(): string {
  return app.getPath("userData");
}

export function configPath(): string {
  return path.join(userDataDir(), "config.json");
}

export function storageDir(): string {
  return path.join(userDataDir(), "storage");
}

export function tmpJobsDir(): string {
  return path.join(userDataDir(), "tmp_jobs");
}

export function iconPath(): string {
  const ico = app.isPackaged
    ? path.join(process.resourcesPath, "icon.ico")
    : path.join(app.getAppPath(), "resources", "icon.ico");
  return fs.existsSync(ico) ? ico : "";
}
