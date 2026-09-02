/**
 * cPanel UAPI client.
 *
 * This is the ONLY file that talks to cPanel directly. Every other part of
 * the backend goes through the functions exported here. That keeps cPanel
 * fully hidden behind our own "Application" / "File" abstractions.
 *
 * Docs: https://api.docs.cpanel.net/openapi/cpanel/operation/
 */
import FormData from "form-data";
import fetch from "node-fetch";
import https from "node:https";

const CPANEL_HOSTNAME = process.env.CPANEL_HOSTNAME!; // e.g. https://yourdomain.com:2083
const CPANEL_USERNAME = process.env.CPANEL_USERNAME!;
const CPANEL_API_TOKEN = process.env.CPANEL_API_TOKEN!;
const CPANEL_BASE_DOMAIN = process.env.CPANEL_BASE_DOMAIN!;

if (!CPANEL_HOSTNAME || !CPANEL_USERNAME || !CPANEL_API_TOKEN) {
  console.warn(
    "[cpanel] Missing CPANEL_HOSTNAME / CPANEL_USERNAME / CPANEL_API_TOKEN env vars — cPanel calls will fail until configured."
  );
}

// Many cPanel servers reached by bare IP (no domain pointed at them yet) use
// a self-signed cert, since CAs won't issue a trusted cert for a raw IP.
// Node's fetch rejects that by default, which is the safe/correct default —
// it also means someone on the network path could impersonate the server.
// Set CPANEL_ALLOW_SELF_SIGNED=true to accept it anyway during development.
// Fix this properly for production by pointing CPANEL_HOSTNAME at a real
// domain with a valid AutoSSL/Let's Encrypt cert instead of an IP.
const allowSelfSigned = process.env.CPANEL_ALLOW_SELF_SIGNED === "true";
if (allowSelfSigned) {
  console.warn(
    "[cpanel] CPANEL_ALLOW_SELF_SIGNED=true — TLS certificate verification is DISABLED for cPanel API calls. Do not use this in production."
  );
}
const cpanelAgent = allowSelfSigned
  ? new https.Agent({ rejectUnauthorized: false })
  : undefined;

function authHeader(): string {
  return `cpanel ${CPANEL_USERNAME}:${CPANEL_API_TOKEN}`;
}

type UapiResponse<T = unknown> = {
  status: 1 | 0;
  errors: string[] | null;
  messages: string[] | null;
  data: T;
};

/**
 * Parse a UAPI response body. cPanel returns JSON on success, but on auth
 * failure (bad username/token) it often returns its HTML login page with a
 * 200 status instead of a clean error — that used to surface as an opaque
 * "Unexpected token '<'" JSON-parse error. This gives a diagnosable message
 * instead.
 */
async function parseUapiResponse<T>(res: import("node-fetch").Response): Promise<T> {
  const rawBody = await res.text();
  let json: UapiResponse<T>;
  try {
    json = JSON.parse(rawBody) as UapiResponse<T>;
  } catch {
    const looksLikeLogin = /login|<!DOCTYPE/i.test(rawBody);
    throw new Error(
      `cPanel returned a non-JSON response (HTTP ${res.status})${
        looksLikeLogin
          ? " that looks like its login page — check that CPANEL_USERNAME and CPANEL_API_TOKEN are correct and that the token has API access"
          : ""
      }. First 200 chars: ${rawBody.slice(0, 200)}`
    );
  }
  if (json.status !== 1) {
    throw new Error(`cPanel API error: ${json.errors?.join("; ") ?? "unknown error"}`);
  }
  return json.data;
}

// If the cPanel server (or a firewall in between) silently drops packets
// instead of actively refusing the connection, fetch can hang for minutes.
// That hang eventually gets killed by Render's own edge proxy, which then
// returns its generic HTML 502 page instead of anything from our app. This
// timeout makes us fail first, with a clear message about what happened.
const CPANEL_TIMEOUT_MS = 15_000;

async function uapiCall<T = unknown>(
  module: string,
  func: string,
  params: Record<string, string | number> = {}
): Promise<T> {
  const query = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
  );
  const url = `${CPANEL_HOSTNAME}/execute/${module}/${func}?${query.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CPANEL_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: authHeader() },
      agent: cpanelAgent,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(
        `cPanel API request to ${CPANEL_HOSTNAME} timed out after ${CPANEL_TIMEOUT_MS}ms. The server may be unreachable, or a firewall may be silently dropping the connection from this host's IP — check that Render's outbound traffic is allowed through on the cPanel server's firewall (e.g. CSF/ConfigServer).`
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`cPanel API HTTP error ${res.status}: ${await res.text()}`);
  }

  return parseUapiResponse<T>(res);
}

async function uapiUpload<T = unknown>(
  module: string,
  func: string,
  params: Record<string, string | number>,
  fileField: string,
  fileBuffer: Buffer,
  fileName: string
): Promise<T> {
  const query = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
  );
  const url = `${CPANEL_HOSTNAME}/execute/${module}/${func}?${query.toString()}`;

  const form = new FormData();
  form.append(fileField, fileBuffer, fileName);

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: authHeader(), ...form.getHeaders() },
    body: form as unknown as import("node-fetch").BodyInit,
    agent: cpanelAgent,
  });

  if (!res.ok) {
    throw new Error(`cPanel API HTTP error ${res.status}: ${await res.text()}`);
  }

  return parseUapiResponse<T>(res);
}

/** Sanitize a user-supplied app name into a safe subdomain label. */
export function slugifyAppName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Absolute path (relative to cPanel home) where an app's files live. */
export function appDocRoot(slug: string): string {
  return `public_html/apps/${slug}`;
}

export function appUrl(slug: string): string {
  return `https://${slug}.${CPANEL_BASE_DOMAIN}`;
}

/**
 * Create the hosting for a new app: a subdomain pointed at a dedicated
 * document root under public_html/apps/<slug>.
 */
export async function createAppHosting(slug: string): Promise<{ url: string }> {
  await uapiCall("SubDomain", "addsubdomain", {
    domain: slug,
    rootdomain: CPANEL_BASE_DOMAIN,
    dir: appDocRoot(slug),
  });
  return { url: appUrl(slug) };
}

/** Remove an app's subdomain (files are left on disk unless deleteFiles=true). */
export async function deleteAppHosting(slug: string, deleteFiles = false): Promise<void> {
  await uapiCall("SubDomain", "delsubdomain", {
    domain: `${slug}.${CPANEL_BASE_DOMAIN}`,
  });
  if (deleteFiles) {
    await uapiCall("Fileman", "fileop", {
      op: "remove",
      sourcefiles: appDocRoot(slug),
    });
  }
}

export type CpanelFileEntry = {
  file: string;
  fullpath: string;
  size: number;
  mtime: number;
  type: "file" | "dir";
};

/** List files inside an app's document root (optionally a subfolder). */
export async function listAppFiles(
  slug: string,
  subPath = ""
): Promise<CpanelFileEntry[]> {
  const dir = subPath ? `${appDocRoot(slug)}/${subPath}` : appDocRoot(slug);
  const data = await uapiCall<{ files: any[] }>("Fileman", "list_files", {
    dir,
    types: "file,dir",
  });
  return (data.files ?? []).map((f) => ({
    file: f.file,
    fullpath: f.fullpath,
    size: Number(f.size ?? 0),
    mtime: Number(f.mtime ?? 0),
    type: f.type === "dir" ? "dir" : "file",
  }));
}

/** Upload one file into an app's document root (optionally a subfolder). */
export async function uploadAppFile(
  slug: string,
  fileBuffer: Buffer,
  fileName: string,
  subPath = ""
): Promise<void> {
  const dir = subPath ? `${appDocRoot(slug)}/${subPath}` : appDocRoot(slug);
  await uapiUpload(
    "Fileman",
    "upload_files",
    { dir, "overwrite-files": 1 },
    "file-1",
    fileBuffer,
    fileName
  );
}

/** Delete a file or folder inside an app's document root. */
export async function deleteAppFile(slug: string, relativePath: string): Promise<void> {
  await uapiCall("Fileman", "fileop", {
    op: "remove",
    sourcefiles: `${appDocRoot(slug)}/${relativePath}`,
  });
}

/** Get total account disk usage (used to enforce the shared storage quota). */
export async function getAccountDiskUsageMb(): Promise<number> {
  const data = await uapiCall<{ _percent_used?: string; _used?: string }>(
    "Quota",
    "get_quota_info",
    {}
  );
  const usedBytes = Number((data as any)._used ?? 0);
  return Math.round(usedBytes / (1024 * 1024));
}