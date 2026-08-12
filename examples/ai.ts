/**
 * Flexible multi-provider AI helper for Bun.
 *
 * Safe default — free via OpenRouter:
 *   const text = await ai("Summarize bun install");
 *
 * Ways to pick a model / provider:
 *   await ai(prompt, "free")
 *   await ai(prompt, "openrouter/free")
 *   await ai(prompt, "claude")                       // alias → anthropic via openrouter
 *   await ai(prompt, "anthropic/claude-sonnet-4")
 *   await ai(prompt, { model: "gpt-4o-mini" })
 *   await ai(prompt, { provider: "openai", model: "gpt-4o" })
 *   await ai(prompt, { provider: "ollama", model: "llama3.2" })
 *   await ai.with({ model: "groq/llama-3.3-70b-versatile" })(prompt)
 *   await ai.model("deepseek/deepseek-chat")(prompt)
 *   await ai.provider("anthropic")(prompt, { model: "claude-sonnet-4-20250514" })
 *
 * Keys: AiTokenVault (per-tenant) → env (OPENROUTER_API_KEY, …).
 */

import { AiTokenVault } from "./ai-token-vault";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Role = "system" | "user" | "assistant" | "tool";

export type AiMessage = {
  role: Role;
  content: string;
  name?: string;
};

export type AiProviderId =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "google"
  | "groq"
  | "together"
  | "deepseek"
  | "mistral"
  | "xai"
  | "perplexity"
  | "fireworks"
  | "cerebras"
  | "cohere"
  | "ollama"
  | (string & {});

export type AiOptions = {
  /** Model id or alias. Default: openrouter/free */
  model?: string;
  /** Provider id. Inferred from model when omitted. */
  provider?: AiProviderId;
  /** System prompt (prepended when input is a string). */
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** Tenant id for AiTokenVault key lookup. */
  uniqueId?: string;
  /** Explicit API key (overrides vault/env). */
  apiKey?: string;
  /** Override base URL for this call. */
  baseURL?: string;
  /** Extra JSON fields merged into the request body. */
  extra?: Record<string, unknown>;
  /** AbortSignal / timeout ms. */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Return full provider JSON instead of assistant text. */
  raw?: boolean;
};

export type AiConfig = {
  /** Default model when none specified. */
  defaultModel: string;
  /** Default provider when none can be inferred. */
  defaultProvider: AiProviderId;
  /** Default tenant for vault lookups. */
  uniqueId?: string;
  /** Global defaults merged into every call. */
  defaults?: Omit<AiOptions, "model" | "provider" | "raw">;
};

export type ResolvedTarget = {
  provider: AiProviderId;
  model: string;
  baseURL: string;
  api: "openai" | "anthropic" | "google";
  apiKey: string | null;
  allowEmptyKey: boolean;
};

export type AiResult = string | Record<string, unknown>;

// ---------------------------------------------------------------------------
// Provider registry (OpenAI-compatible unless noted)
// ---------------------------------------------------------------------------

type ProviderDef = {
  baseURL: string;
  api: "openai" | "anthropic" | "google";
  /** Model id prefixes that map to this provider (e.g. "openai/", "gpt-"). */
  prefixes?: string[];
  /** Exact model ids owned by this provider. */
  models?: string[];
  allowEmptyKey?: boolean;
};

export const PROVIDERS: Record<string, ProviderDef> = {
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    api: "openai",
    prefixes: ["openrouter/", "meta-llama/", "qwen/", "mistralai/", "google/", "nousresearch/", "undi95/", "cognitivecomputations/", "huggingface/"],
  },
  openai: {
    baseURL: "https://api.openai.com/v1",
    api: "openai",
    prefixes: ["openai/", "gpt-", "o1", "o3", "o4", "chatgpt-"],
  },
  anthropic: {
    baseURL: "https://api.anthropic.com/v1",
    api: "anthropic",
    prefixes: ["anthropic/", "claude-"],
  },
  google: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    api: "openai",
    prefixes: ["gemini-", "models/gemini"],
  },
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    api: "openai",
    prefixes: ["groq/"],
  },
  together: {
    baseURL: "https://api.together.xyz/v1",
    api: "openai",
    prefixes: ["together/"],
  },
  deepseek: {
    baseURL: "https://api.deepseek.com",
    api: "openai",
    prefixes: ["deepseek/", "deepseek-"],
  },
  mistral: {
    baseURL: "https://api.mistral.ai/v1",
    api: "openai",
    prefixes: ["mistral/"],
  },
  xai: {
    baseURL: "https://api.x.ai/v1",
    api: "openai",
    prefixes: ["xai/", "grok-"],
  },
  perplexity: {
    baseURL: "https://api.perplexity.ai",
    api: "openai",
    prefixes: ["perplexity/", "sonar"],
  },
  fireworks: {
    baseURL: "https://api.fireworks.ai/inference/v1",
    api: "openai",
    prefixes: ["fireworks/", "accounts/fireworks/"],
  },
  cerebras: {
    baseURL: "https://api.cerebras.ai/v1",
    api: "openai",
    prefixes: ["cerebras/"],
  },
  cohere: {
    baseURL: "https://api.cohere.ai/compatibility/v1",
    api: "openai",
    prefixes: ["cohere/", "command-"],
  },
  ollama: {
    baseURL: "http://127.0.0.1:11434/v1",
    api: "openai",
    prefixes: ["ollama/"],
    allowEmptyKey: true,
  },
};

/**
 * Short aliases → concrete model ids.
 * Unprefixed aliases route through OpenRouter (including free).
 */
export const MODEL_ALIASES: Record<string, string> = {
  // safe / free defaults
  free: "openrouter/free",
  "or-free": "openrouter/free",
  openrouter: "openrouter/free",

  // popular OpenRouter-routed shortcuts
  auto: "openrouter/auto",
  claude: "anthropic/claude-sonnet-4",
  "claude-sonnet": "anthropic/claude-sonnet-4",
  "claude-haiku": "anthropic/claude-3.5-haiku",
  "claude-opus": "anthropic/claude-opus-4",
  gpt: "openai/gpt-4o-mini",
  "gpt-4o": "openai/gpt-4o",
  "gpt-4o-mini": "openai/gpt-4o-mini",
  "gpt-mini": "openai/gpt-4o-mini",
  gemini: "google/gemini-2.0-flash-001",
  "gemini-flash": "google/gemini-2.0-flash-001",
  "gemini-pro": "google/gemini-2.5-pro-preview",
  llama: "meta-llama/llama-3.3-70b-instruct",
  deepseek: "deepseek/deepseek-chat",
  mistral: "mistralai/mistral-small-3.1-24b-instruct",
  grok: "x-ai/grok-3-mini-beta",

  // direct-provider aliases (force native provider, not OpenRouter)
  "openai:gpt": "openai:gpt-4o-mini",
  "anthropic:claude": "anthropic:claude-sonnet-4-20250514",
  "groq:llama": "groq:llama-3.3-70b-versatile",
  "ollama:llama": "ollama:llama3.2",
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const config: AiConfig = {
  defaultModel: "openrouter/free",
  defaultProvider: "openrouter",
  defaults: {
    temperature: 0.2,
    maxTokens: 2048,
  },
};

export function configureAi(partial: Partial<AiConfig>): void {
  if (partial.defaultModel !== undefined) config.defaultModel = partial.defaultModel;
  if (partial.defaultProvider !== undefined) config.defaultProvider = partial.defaultProvider;
  if (partial.uniqueId !== undefined) {
    config.uniqueId = partial.uniqueId;
    AiTokenVault.use(partial.uniqueId ?? null);
  }
  if (partial.defaults) config.defaults = { ...config.defaults, ...partial.defaults };
}

export function getAiConfig(): Readonly<AiConfig> {
  return {
    ...config,
    defaults: { ...config.defaults },
  };
}

/** Register or override a provider endpoint. */
export function registerProvider(id: string, def: ProviderDef): void {
  PROVIDERS[id] = def;
}

/** Register or override a model alias. */
export function registerAlias(alias: string, model: string): void {
  MODEL_ALIASES[alias] = model;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function stripProviderPrefix(model: string, provider: string): string {
  const p = `${provider}/`;
  return model.startsWith(p) ? model.slice(p.length) : model;
}

/**
 * Parse flexible model specs:
 *   "free" | "openrouter/free" | "anthropic:claude-…" | "provider/model" | alias
 */
export function resolveModelSpec(
  spec: string | undefined,
  explicitProvider?: AiProviderId,
): { provider: AiProviderId; model: string; viaOpenRouter: boolean } {
  let raw = (spec ?? config.defaultModel).trim();
  if (!raw) raw = config.defaultModel;

  // alias expansion (may yield "provider:model" or "vendor/model")
  if (MODEL_ALIASES[raw]) raw = MODEL_ALIASES[raw];
  if (MODEL_ALIASES[raw.toLowerCase()]) raw = MODEL_ALIASES[raw.toLowerCase()];

  // explicit "provider:model" forces that provider (native), not OpenRouter
  const colon = raw.match(/^([a-z0-9_-]+):(.+)$/i);
  if (colon && PROVIDERS[colon[1]!.toLowerCase()]) {
    const provider = colon[1]!.toLowerCase() as AiProviderId;
    return { provider, model: colon[2]!, viaOpenRouter: false };
  }

  if (explicitProvider) {
    return {
      provider: explicitProvider,
      model: stripProviderPrefix(raw, explicitProvider),
      viaOpenRouter: explicitProvider === "openrouter",
    };
  }

  // openrouter/* and *:free always go through OpenRouter
  if (raw.startsWith("openrouter/") || raw.endsWith(":free")) {
    return { provider: "openrouter", model: raw, viaOpenRouter: true };
  }

  // vendor/model — if vendor is a known provider, prefer native when key exists,
  // otherwise keep OpenRouter slug (openrouter hosts anthropic/openai/google/…)
  const slash = raw.match(/^([a-z0-9_-]+)\/(.+)$/i);
  if (slash) {
    const vendor = slash[1]!.toLowerCase();
    if (vendor === "openrouter") {
      return { provider: "openrouter", model: raw, viaOpenRouter: true };
    }
    if (PROVIDERS[vendor]) {
      // Route vendor/model through OpenRouter by default (one key, all models).
      // Use "vendor:model" or { provider: "vendor" } for native.
      return { provider: "openrouter", model: raw, viaOpenRouter: true };
    }
  }

  // Infer from prefixes for bare ids like "gpt-4o-mini", "claude-…"
  for (const [id, def] of Object.entries(PROVIDERS)) {
    if (id === "openrouter") continue;
    for (const prefix of def.prefixes ?? []) {
      if (raw.startsWith(prefix) || raw === prefix.replace(/\/$/, "")) {
        // Bare openai/anthropic/etc. model ids → OpenRouter slug when possible
        if (id === "openai" || id === "anthropic" || id === "google" || id === "xai") {
          const slug =
            raw.includes("/") ? raw : `${id === "xai" ? "x-ai" : id}/${stripProviderPrefix(raw, id)}`;
          return { provider: "openrouter", model: slug, viaOpenRouter: true };
        }
        return { provider: id, model: stripProviderPrefix(raw, id), viaOpenRouter: false };
      }
    }
  }

  // Fallback: default provider (openrouter) with given model string
  return {
    provider: config.defaultProvider,
    model: raw,
    viaOpenRouter: config.defaultProvider === "openrouter",
  };
}

export function resolveTarget(options: AiOptions = {}): ResolvedTarget {
  const { provider, model } = resolveModelSpec(options.model, options.provider);
  const def = PROVIDERS[provider] ?? PROVIDERS.openrouter!;
  const uniqueId = options.uniqueId ?? config.uniqueId;
  const apiKey =
    options.apiKey?.trim() ||
    AiTokenVault.resolve(provider, uniqueId) ||
    // When routing vendor models via OpenRouter, need the openrouter key
    (provider === "openrouter" ? AiTokenVault.resolve("openrouter", uniqueId) : null);

  return {
    provider,
    model: provider === "openrouter" ? model : stripProviderPrefix(model, provider),
    baseURL: options.baseURL ?? def.baseURL,
    api: def.api,
    apiKey,
    allowEmptyKey: !!def.allowEmptyKey,
  };
}

// ---------------------------------------------------------------------------
// HTTP adapters
// ---------------------------------------------------------------------------

function normalizeMessages(input: string | AiMessage[], system?: string): AiMessage[] {
  const messages: AiMessage[] = Array.isArray(input)
    ? input.map((m) => ({ ...m }))
    : [{ role: "user", content: input }];

  if (system && !messages.some((m) => m.role === "system")) {
    messages.unshift({ role: "system", content: system });
  }
  return messages;
}

function extractOpenAIText(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === "string" ? p : p?.text ?? "")).join("");
  }
  return "";
}

function extractAnthropicText(data: any): string {
  const parts = data?.content;
  if (!Array.isArray(parts)) return "";
  return parts.map((p) => (p?.type === "text" ? p.text ?? "" : "")).join("");
}

async function callOpenAI(
  target: ResolvedTarget,
  messages: AiMessage[],
  opts: AiOptions,
): Promise<Record<string, unknown>> {
  if (!target.apiKey && !target.allowEmptyKey) {
    throw new Error(
      `ai(): missing API key for provider "${target.provider}". Set via AiTokenVault or ${target.provider.toUpperCase()}_API_KEY.`,
    );
  }

  const body: Record<string, unknown> = {
    model: target.model,
    messages,
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
    ...opts.extra,
  };

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (target.apiKey) headers.authorization = `Bearer ${target.apiKey}`;

  // OpenRouter ranking headers (harmless extras)
  if (target.provider === "openrouter") {
    headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL ?? "https://github.com/oven-sh/bun";
    headers["X-Title"] = process.env.OPENROUTER_APP_NAME ?? "bun-ai";
  }

  const res = await fetch(`${target.baseURL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: opts.signal ?? (opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof data.error === "object" && data.error && "message" in (data.error as object)
      ? String((data.error as { message: unknown }).message)
      : JSON.stringify(data);
    throw new Error(`ai(): ${target.provider} ${res.status}: ${msg}`);
  }
  return data;
}

async function callAnthropic(
  target: ResolvedTarget,
  messages: AiMessage[],
  opts: AiOptions,
): Promise<Record<string, unknown>> {
  if (!target.apiKey) {
    throw new Error(`ai(): missing API key for provider "anthropic". Set ANTHROPIC_API_KEY or vault.`);
  }

  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const converted = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));

  const body: Record<string, unknown> = {
    model: target.model,
    max_tokens: opts.maxTokens ?? 2048,
    messages: converted,
    ...(system ? { system } : {}),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...opts.extra,
  };

  const res = await fetch(`${target.baseURL.replace(/\/$/, "")}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": target.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: opts.signal ?? (opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof data.error === "object" && data.error && "message" in (data.error as object)
      ? String((data.error as { message: unknown }).message)
      : JSON.stringify(data);
    throw new Error(`ai(): anthropic ${res.status}: ${msg}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Public ai()
// ---------------------------------------------------------------------------

function mergeOptions(over?: string | AiOptions): AiOptions {
  if (typeof over === "string") return { ...config.defaults, model: over };
  return { ...config.defaults, ...over };
}

async function complete(input: string | AiMessage[], options: AiOptions = {}): Promise<AiResult> {
  const target = resolveTarget(options);
  const messages = normalizeMessages(input, options.system);

  const data =
    target.api === "anthropic"
      ? await callAnthropic(target, messages, options)
      : await callOpenAI(target, messages, options);

  if (options.raw) return data;

  const text = target.api === "anthropic" ? extractAnthropicText(data) : extractOpenAIText(data);
  return text.trimEnd();
}

type AiCallable = {
  (prompt: string, modelOrOptions?: string | AiOptions): Promise<AiResult>;
  (messages: AiMessage[], options?: AiOptions): Promise<AiResult>;
  /** Bind default options; returns a new ai-like function. */
  with(options: AiOptions): (input: string | AiMessage[], over?: string | AiOptions) => Promise<AiResult>;
  /** Bind a model (alias or id). */
  model(model: string): (input: string | AiMessage[], over?: AiOptions) => Promise<AiResult>;
  /** Bind a provider (native). */
  provider(provider: AiProviderId): (input: string | AiMessage[], over?: string | AiOptions) => Promise<AiResult>;
  /** Inspect resolution without calling the network. */
  resolve(modelOrOptions?: string | AiOptions): ResolvedTarget;
  configure: typeof configureAi;
  config: typeof getAiConfig;
  aliases: typeof MODEL_ALIASES;
  providers: typeof PROVIDERS;
};

export const ai: AiCallable = Object.assign(
  async (input: string | AiMessage[], modelOrOptions?: string | AiOptions) => {
    return complete(input, mergeOptions(modelOrOptions));
  },
  {
    with(options: AiOptions) {
      return (input: string | AiMessage[], over?: string | AiOptions) => {
        const second = typeof over === "string" ? { model: over } : over;
        return complete(input, { ...config.defaults, ...options, ...second });
      };
    },
    model(model: string) {
      return (input: string | AiMessage[], over?: AiOptions) =>
        complete(input, { ...config.defaults, ...over, model: over?.model ?? model });
    },
    provider(provider: AiProviderId) {
      return (input: string | AiMessage[], over?: string | AiOptions) => {
        const second = typeof over === "string" ? { model: over } : over;
        return complete(input, { ...config.defaults, ...second, provider });
      };
    },
    resolve(modelOrOptions?: string | AiOptions) {
      return resolveTarget(mergeOptions(modelOrOptions));
    },
    configure: configureAi,
    config: getAiConfig,
    aliases: MODEL_ALIASES,
    providers: PROVIDERS,
  },
);

export default ai;
