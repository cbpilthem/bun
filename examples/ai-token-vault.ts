/**
 * AiTokenVault — single-file per-tenant AI provider key store (Bun/JS port).
 *
 * Storage: <tenantDir>/secrets.json — plaintext JSON, file mode 0o600.
 * Threat model (PoC): relies on filesystem perms + per-tenant path
 * isolation to keep one tenant's key from another. Does NOT protect
 * against local root/file-read access, backups, or a compromised
 * process. Encrypt-at-rest before storing real customer keys.
 *
 * Host hook (one line, e.g. in ai()):
 *   const key = AiTokenVault.resolve(uniqueId, provider);
 *
 * Portability: host may rename this class freely. If tenantDir() isn't
 * defined globally, call before first use:
 *   AiTokenVault.configure((uid) => `/path/to/accounts/${uid}`);
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export type TenantDirResolver = (uniqueId: string) => string;
export type Secrets = Record<string, string>;

/** Well-known provider ids → common env var names (checked in order). */
export const PROVIDER_ENV_KEYS: Record<string, readonly string[]> = {
  openrouter: ["OPENROUTER_API_KEY", "OR_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
  google: ["GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  together: ["TOGETHER_API_KEY", "TOGETHERAI_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  xai: ["XAI_API_KEY", "GROK_API_KEY"],
  perplexity: ["PERPLEXITY_API_KEY"],
  fireworks: ["FIREWORKS_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  cohere: ["COHERE_API_KEY"],
  ollama: ["OLLAMA_API_KEY"], // optional; local usually needs none
};

export class AiTokenVault {
  static #pathResolver: TenantDirResolver | null = null;
  static #activeTenant: string | null = null;

  /** Set tenant directory resolver: (uniqueId) => absolute path. */
  static configure(tenantDirResolver: TenantDirResolver): void {
    this.#pathResolver = tenantDirResolver;
  }

  /** Optional default tenant for resolve()/get() when uniqueId omitted. */
  static use(uniqueId: string | null): void {
    this.#activeTenant = uniqueId;
  }

  static get(uniqueId: string, provider = "openrouter"): string | null {
    const key = this.#load(uniqueId)[provider];
    return typeof key === "string" && key.length > 0 ? key : null;
  }

  static set(uniqueId: string, provider: string, key: string): void {
    const secrets = this.#load(uniqueId);
    secrets[provider] = key;
    this.#save(uniqueId, secrets);
  }

  static clear(uniqueId: string, provider = "openrouter"): void {
    const secrets = this.#load(uniqueId);
    delete secrets[provider];
    this.#save(uniqueId, secrets);
  }

  /** All stored provider → key pairs for a tenant (no env merge). */
  static list(uniqueId: string): Secrets {
    return { ...this.#load(uniqueId) };
  }

  /**
   * Resolve an API key: vault → process.env (known + PROVIDER_API_KEY).
   * Pass uniqueId or rely on AiTokenVault.use(id).
   */
  static resolve(provider: string, uniqueId?: string | null): string | null {
    const uid = uniqueId ?? this.#activeTenant;
    if (uid) {
      const fromVault = this.get(uid, provider);
      if (fromVault) return fromVault;
    }
    return this.envKey(provider);
  }

  /** Read provider key from environment only. */
  static envKey(provider: string): string | null {
    const names = PROVIDER_ENV_KEYS[provider] ?? [`${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`];
    for (const name of names) {
      const v = process.env[name]?.trim();
      if (v) return v;
    }
    return null;
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
