import postgres from "postgres";

export function createPostgresClient(databaseUrl: string) {
  return postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
  });
}
