/**
 * AiTokenVault — single-file per-tenant AI provider key store (Bun/JS port).
 *
 * Storage: <tenantDir>/secrets.json — plaintext JSON, file mode 0o600.
 * Threat model (PoC): relies on filesystem perms + per-tenant path
 * isolation to keep one tenant's key from another. Does NOT protect
 * against local root/file-read access, backups, or a compromised
 * process. Encrypt-at-rest before storing real customer keys.
 *
 * Host hook (one line, e.g. in aiComplete()):
 *   const key = AiTokenVault.get(uniqueId) ?? String(t.api_key ?? "").trim();
 *
 * Portability: host may rename this class freely. If tenantDir() isn't
 * defined globally, call before first use:
 *   AiTokenVault.configure((uid) => `/path/to/accounts/${uid}`);
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

type TenantDirResolver = (uniqueId: string) => string;
type Secrets = Record<string, string>;

export class AiTokenVault {
  static #pathResolver: TenantDirResolver | null = null;

  static configure(tenantDirResolver: TenantDirResolver): void {
    this.#pathResolver = tenantDirResolver;
  }

  static get(uniqueId: string, provider = "anthropic"): string | null {
    return this.#load(uniqueId)[provider] ?? null;
  }

  static set(uniqueId: string, provider: string, key: string): void {
    const secrets = this.#load(uniqueId);
    secrets[provider] = key;
    this.#save(uniqueId, secrets);
  }

  static clear(uniqueId: string, provider = "anthropic"): void {
    const secrets = this.#load(uniqueId);
    delete secrets[provider];
    this.#save(uniqueId, secrets);
  }

  // --- helpers ---

  static #dir(uniqueId: string): string {
    if (this.#pathResolver) return this.#pathResolver(uniqueId);
    const globalTenantDir = (globalThis as { tenantDir?: TenantDirResolver }).tenantDir;
    if (typeof globalTenantDir === "function") return globalTenantDir(uniqueId);
    throw new Error("AiTokenVault: no path resolver; call configure()");
  }

  static #file(uniqueId: string): string {
    return join(this.#dir(uniqueId), "secrets.json");
  }

  static #load(uniqueId: string): Secrets {
    const f = this.#file(uniqueId);
    if (!existsSync(f)) return {};
    try {
      const data = JSON.parse(readFileSync(f, "utf8"));
      return data && typeof data === "object" && !Array.isArray(data) ? (data as Secrets) : {};
    } catch {
      return {};
    }
  }

  static #save(uniqueId: string, secrets: Secrets): void {
    const f = this.#file(uniqueId);
    const dir = dirname(f);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });

    const tmp = `${f}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify(secrets, null, 2));
    chmodSync(tmp, 0o600);
    renameSync(tmp, f); // atomic swap on same filesystem
  }
}

export default AiTokenVault;
