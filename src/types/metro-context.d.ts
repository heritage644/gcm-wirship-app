declare namespace NodeJS {
  interface Require {
    context(
      directory: string,
      recursive?: boolean,
      filter?: RegExp,
      mode?: 'sync' | 'eager' | 'weak' | 'lazy' | 'lazy-once',
    ): {
      keys(): string[];
      (id: string): number | string | { uri: string };
    };
  }
}
