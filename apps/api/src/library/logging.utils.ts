const prefix = (level: string) =>
  `[${new Date().toISOString()}] [${level}]`;

export default class Logging {
  public static log = (message: unknown, ...additionalArgs: unknown[]) =>
    this.info(message, ...additionalArgs);

  public static info = (message: unknown, ...additionalArgs: unknown[]) => {
    console.info(prefix('INFO'), message, ...additionalArgs);
  };

  public static debug = (message: unknown, ...additionalArgs: unknown[]) => {
    console.debug(prefix('DEBUG'), message, ...additionalArgs);
  };

  public static warning = (message: unknown, ...additionalArgs: unknown[]) => {
    console.warn(prefix('WARN'), message, ...additionalArgs);
  };

  public static error = (message: unknown, ...additionalArgs: unknown[]) => {
    console.error(prefix('ERROR'), message, ...additionalArgs);
  };
}
