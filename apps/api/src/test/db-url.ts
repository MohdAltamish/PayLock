/** Separate database so tests never touch development data. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://paylock:paylock@localhost:5432/paylock_test";
