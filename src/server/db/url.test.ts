import { describe, expect, it } from "vitest";
import { assertE2eDatabaseUrl, databaseUrl, e2eDatabaseUrl } from "./url";

describe("databaseUrl", () => {
  it("verbindet nur über die Loopback-Adresse mit dem Container", () => {
    expect(databaseUrl({ DB_PORT: "55451" })).toBe(
      "postgres://benchmark:benchmark@127.0.0.1:55451/benchmark",
    );
  });
});

describe("e2eDatabaseUrl", () => {
  it("nutzt eine eigene Datenbank auf dem Server der App", () => {
    expect(e2eDatabaseUrl({ DB_PORT: "55451" })).toBe(
      "postgres://benchmark:benchmark@127.0.0.1:55451/benchmark_e2e",
    );
  });

  it("nimmt einen eigenen Port für die Test-Datenbank", () => {
    expect(e2eDatabaseUrl({ DB_PORT: "55451", E2E_DB_PORT: "55452" })).toBe(
      "postgres://benchmark:benchmark@127.0.0.1:55452/benchmark_e2e",
    );
  });

  it("bricht ab, wenn die angegebene Test-Datenbank keine Test-Datenbank ist", () => {
    expect(() => e2eDatabaseUrl({ E2E_DATABASE_URL: "postgres://u:p@127.0.0.1:5432/benchmark" })).toThrow(
      /Test-Datenbank/,
    );
  });

  it("bricht ab, wenn die Test-Datenbank die Datenbank der App ist", () => {
    const url = "postgres://u:p@127.0.0.1:5432/mein_e2e";
    expect(() => e2eDatabaseUrl({ DATABASE_URL: url, E2E_DATABASE_URL: url })).toThrow(/Datenbank der App/);
  });
});

describe("assertE2eDatabaseUrl", () => {
  it("lässt nur Datenbanknamen mit der Endung _e2e zu", () => {
    expect(() => assertE2eDatabaseUrl("postgres://u:p@127.0.0.1:5432/benchmark_e2e")).not.toThrow();
    expect(() => assertE2eDatabaseUrl("postgres://u:p@127.0.0.1:5432/benchmark")).toThrow(/Test-Datenbank/);
    expect(() => assertE2eDatabaseUrl(undefined)).toThrow(/Test-Datenbank/);
  });
});
