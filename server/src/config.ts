/**
 * Configuration module: reads and validates environment variables.
 * No SDK imports.
 */

export type Mode = "alexa" | "local" | "both";

export interface Config {
  readonly mode: Mode;
  readonly host: string;
  readonly port: number;
  readonly dataFile: string;
  readonly tz: string;
  readonly demoMode: boolean;
  readonly logLevel: "debug" | "info" | "warn" | "error";
  readonly maxCardsPerCall: number;
  readonly maxTextLength: number;
  readonly ollamaUrl: string;
  readonly ollamaModel: string;
  readonly sttUrl?: string;
  readonly ttsUrl?: string;
}

const VALID_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
type LogLevel = (typeof VALID_LOG_LEVELS)[number];
const VALID_MODES = ["alexa", "local", "both"] as const;

function requirePositiveInt(name: string, raw: string | undefined, defaultValue: number): number {
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: "${raw}" — must be a positive integer.`);
  }
  return parsed;
}

function requireLogLevel(raw: string | undefined, defaultValue: LogLevel): LogLevel {
  if (raw === undefined || raw === "") return defaultValue;
  const lower = raw.toLowerCase() as LogLevel;
  if (!VALID_LOG_LEVELS.includes(lower)) {
    throw new Error(
      `Invalid LOG_LEVEL: "${raw}" — must be one of: ${VALID_LOG_LEVELS.join(", ")}.`,
    );
  }
  return lower;
}

function validateTimezone(tz: string): string {
  try {
    Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    throw new Error(
      `Invalid TZ: "${tz}" — must be a valid IANA timezone (e.g. "America/New_York").`,
    );
  }
}

function requireMode(raw: string | undefined, defaultValue: Mode): Mode {
  if (raw === undefined || raw === "") return defaultValue;
  const lower = raw.toLowerCase() as Mode;
  if (!VALID_MODES.includes(lower)) {
    throw new Error(
      `Invalid MODE: "${raw}" — must be one of: ${VALID_MODES.join(", ")}.`,
    );
  }
  return lower;
}

export function loadConfig(): Config {
  const mode = requireMode(process.env.MODE, "alexa");
  const host = process.env.HOST || (mode === "local" ? "127.0.0.1" : "0.0.0.0");
  const port = requirePositiveInt("PORT", process.env.PORT, 3000);
  const dataFile = process.env.DATA_FILE || "./data/echodeck.json";
  const tz = validateTimezone(process.env.TZ || "UTC");
  const demoMode = process.env.DEMO_MODE === "true";
  const logLevel = requireLogLevel(process.env.LOG_LEVEL, "info");
  const maxCardsPerCall = requirePositiveInt("MAX_CARDS_PER_CALL", process.env.MAX_CARDS_PER_CALL, 50);
  const maxTextLength = requirePositiveInt("MAX_TEXT_LENGTH", process.env.MAX_TEXT_LENGTH, 500);
  const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  const ollamaModel = process.env.OLLAMA_MODEL || "llama3.2";
  const sttUrl = process.env.STT_URL || process.env.WHISPER_URL;
  const ttsUrl = process.env.TTS_URL || process.env.PIPER_URL;

  return {
    mode,
    host,
    port,
    dataFile,
    tz,
    demoMode,
    logLevel,
    maxCardsPerCall,
    maxTextLength,
    ollamaUrl,
    ollamaModel,
    sttUrl,
    ttsUrl,
  };
}
