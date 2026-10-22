/**
 * Configuration module: reads and validates environment variables.
 * No SDK imports.
 */

export interface Config {
  readonly port: number;
  readonly dataFile: string;
  readonly tz: string;
  readonly demoMode: boolean;
  readonly logLevel: "debug" | "info" | "warn" | "error";
  readonly maxCardsPerCall: number;
  readonly maxTextLength: number;
}

const VALID_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
type LogLevel = (typeof VALID_LOG_LEVELS)[number];

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

export function loadConfig(): Config {
  const port = requirePositiveInt("PORT", process.env.PORT, 3000);
  const dataFile = process.env.DATA_FILE || "./data/echodeck.json";
  const tz = validateTimezone(process.env.TZ || "UTC");
  const demoMode = process.env.DEMO_MODE === "true";
  const logLevel = requireLogLevel(process.env.LOG_LEVEL, "info");
  const maxCardsPerCall = requirePositiveInt("MAX_CARDS_PER_CALL", process.env.MAX_CARDS_PER_CALL, 50);
  const maxTextLength = requirePositiveInt("MAX_TEXT_LENGTH", process.env.MAX_TEXT_LENGTH, 500);

  return {
    port,
    dataFile,
    tz,
    demoMode,
    logLevel,
    maxCardsPerCall,
    maxTextLength,
  };
}
