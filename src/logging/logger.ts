export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export interface CreateLoggerOptions {
  level: LogLevel;
  context?: LogFields;
  now?: () => Date;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

class StructuredLogger implements Logger {
  readonly #level: LogLevel;
  readonly #context: LogFields;
  readonly #now: () => Date;
  readonly #stdout: (message: string) => void;
  readonly #stderr: (message: string) => void;

  constructor(options: Required<CreateLoggerOptions>) {
    this.#level = options.level;
    this.#context = options.context;
    this.#now = options.now;
    this.#stdout = options.stdout;
    this.#stderr = options.stderr;
  }

  debug(message: string, fields: LogFields = {}): void {
    this.#log("debug", message, fields);
  }

  info(message: string, fields: LogFields = {}): void {
    this.#log("info", message, fields);
  }

  warn(message: string, fields: LogFields = {}): void {
    this.#log("warn", message, fields);
  }

  error(message: string, fields: LogFields = {}): void {
    this.#log("error", message, fields);
  }

  child(fields: LogFields): Logger {
    return new StructuredLogger({
      level: this.#level,
      context: {
        ...this.#context,
        ...fields,
      },
      now: this.#now,
      stdout: this.#stdout,
      stderr: this.#stderr,
    });
  }

  #log(level: LogLevel, message: string, fields: LogFields): void {
    if (levelPriority[level] < levelPriority[this.#level]) {
      return;
    }

    const payload = JSON.stringify({
      timestamp: this.#now().toISOString(),
      level,
      message,
      ...this.#context,
      ...fields,
    });

    if (level === "error") {
      this.#stderr(`${payload}\n`);
      return;
    }

    this.#stdout(`${payload}\n`);
  }
}

export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return this;
  },
};

export function createLogger(options: CreateLoggerOptions): Logger {
  return new StructuredLogger({
    level: options.level,
    context: options.context ?? {},
    now: options.now ?? (() => new Date()),
    stdout: options.stdout ?? ((message) => process.stdout.write(message)),
    stderr: options.stderr ?? ((message) => process.stderr.write(message)),
  });
}
