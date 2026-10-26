import { describe, expect, it } from "vitest";
import { assertE2eDatabaseUrl, assertNotAppDatabase, databaseUrl, e2eDatabaseUrl, sameDatabase } from "./url";

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

  it.each([
    [
      "postgres:// gegen postgresql://",
      "postgresql://u:p@127.0.0.1:5432/mein_e2e",
      "postgres://u:p@127.0.0.1:5432/mein_e2e",
    ],
    [
      "localhost gegen 127.0.0.1",
      "postgres://u:p@127.0.0.1:5432/mein_e2e",
      "postgres://u:p@localhost:5432/mein_e2e",
    ],
    ["ohne gegen mit Port", "postgres://u:p@127.0.0.1/mein_e2e", "postgres://u:p@127.0.0.1:5432/mein_e2e"],
    [
      "mit ?sslmode",
      "postgres://u:p@127.0.0.1:5432/mein_e2e?sslmode=disable",
      "postgres://u:p@127.0.0.1:5432/mein_e2e",
    ],
  ])("bricht bei gleichwertiger URL der App-Datenbank ab (%s)", (_, app, e2e) => {
    expect(() => e2eDatabaseUrl({ DATABASE_URL: app, E2E_DATABASE_URL: e2e })).toThrow(/Datenbank der App/);
  });

  it("bricht ab, wenn die Standard-Test-Datenbank die per DATABASE_URL gesetzte App-Datenbank ist", () => {
    expect(() =>
      e2eDatabaseUrl({ DB_PORT: "55451", DATABASE_URL: "postgresql://x:y@localhost:55451/benchmark_e2e" }),
    ).toThrow(/Datenbank der App/);
  });
});

describe("sameDatabase", () => {
  const app = "postgresql://benchmark:benchmark@127.0.0.1:5432/benchmark_e2e";
  it.each([
    ["anderes Schema", "postgres://benchmark:benchmark@127.0.0.1:5432/benchmark_e2e"],
    ["localhost statt 127.0.0.1", "postgresql://benchmark:benchmark@localhost:5432/benchmark_e2e"],
    ["::1 statt 127.0.0.1", "postgresql://benchmark:benchmark@[::1]:5432/benchmark_e2e"],
    ["ohne Port (Standard 5432)", "postgresql://benchmark:benchmark@127.0.0.1/benchmark_e2e"],
    ["mit Query-Optionen", "postgresql://benchmark:benchmark@127.0.0.1:5432/benchmark_e2e?sslmode=disable"],
    ["andere Zugangsdaten", "postgres://andere:geheim@LOCALHOST/benchmark_e2e?application_name=x"],
  ])("erkennt dieselbe Datenbank trotz %s", (_, other) => {
    expect(sameDatabase(app, other)).toBe(true);
    expect(sameDatabase(other, app)).toBe(true);
  });

  it.each([
    ["anderer Datenbankname", "postgresql://benchmark:benchmark@127.0.0.1:5432/benchmark"],
    ["anderer Port", "postgresql://benchmark:benchmark@127.0.0.1:55451/benchmark_e2e"],
    ["anderer Host", "postgresql://benchmark:benchmark@db.example:5432/benchmark_e2e"],
  ])("unterscheidet Datenbanken mit %s", (_, other) => {
    expect(sameDatabase(app, other)).toBe(false);
  });
});

describe("Verbindungsziel wie pg (Query-Parameter überschreiben die Adresse)", () => {
  it("erkennt dieselbe Datenbank, wenn ?host= und ?port= die Adresse überschreiben", () => {
    expect(
      sameDatabase(
        "postgres://u:p@127.0.0.1:5432/benchmark_e2e",
        "postgres://u:p@anderer-host:6543/benchmark_e2e?host=127.0.0.1&port=5432",
      ),
    ).toBe(true);
    expect(
      sameDatabase(
        "postgres://benchmark:benchmark@127.0.0.1:5432/benchmark_e2e",
        "postgres://benchmark:benchmark@127.0.0.1:55451/benchmark_e2e?port=5432",
      ),
    ).toBe(true);
  });

  it.each([
    [
      "?host= und ?port= (Befund Logik)",
      "postgres://u:p@127.0.0.1:5432/benchmark_e2e",
      "postgres://u:p@anderer-host:6543/benchmark_e2e?host=127.0.0.1&port=5432",
    ],
    [
      "?port= (Befund Konformität)",
      "postgres://benchmark:benchmark@127.0.0.1:5432/benchmark_e2e",
      "postgres://benchmark:benchmark@127.0.0.1:55451/benchmark_e2e?port=5432",
    ],
  ])("e2eDatabaseUrl lehnt die App-Datenbank hinter %s ab", (_, app, e2e) => {
    expect(() => e2eDatabaseUrl({ DATABASE_URL: app, E2E_DATABASE_URL: e2e })).toThrow();
  });

  it.each([
    ["host", "postgres://u:p@127.0.0.1:55451/benchmark_e2e?host=localhost"],
    ["hostaddr", "postgres://u:p@127.0.0.1:55451/benchmark_e2e?hostaddr=127.0.0.1"],
    ["port", "postgres://u:p@127.0.0.1:55451/benchmark_e2e?port=5432"],
    ["database", "postgres://u:p@127.0.0.1:55451/benchmark_e2e?database=benchmark"],
    ["dbname", "postgres://u:p@127.0.0.1:55451/benchmark_e2e?dbname=benchmark"],
    ["user", "postgres://u:p@127.0.0.1:55451/benchmark_e2e?user=benchmark"],
    ["Großschreibung", "postgres://u:p@127.0.0.1:55451/benchmark_e2e?sslmode=disable&PORT=5432"],
  ])("die Test-Datenbank darf ihr Ziel nicht über Query-Parameter ändern (%s)", (_, url) => {
    expect(() => assertE2eDatabaseUrl(url)).toThrow(/Query-Parameter/);
  });

  it("Optionen ohne Einfluss auf das Ziel bleiben erlaubt", () => {
    expect(() =>
      assertE2eDatabaseUrl(
        "postgres://u:p@127.0.0.1:55451/benchmark_e2e?sslmode=disable&application_name=e2e",
      ),
    ).not.toThrow();
  });

  it("assertNotAppDatabase lehnt die über ?port= erreichte App-Datenbank ab", () => {
    expect(() =>
      assertNotAppDatabase(
        "postgres://benchmark:benchmark@127.0.0.1:55451/benchmark_e2e?port=5432",
        "postgres://benchmark:benchmark@127.0.0.1:5432/benchmark_e2e",
      ),
    ).toThrow(/Datenbank der App/);
  });
});

describe("assertNotAppDatabase (vor dem Löschen der Test-Datenbank)", () => {
  it("bricht bei gleichwertiger URL der App-Datenbank ab", () => {
    expect(() =>
      assertNotAppDatabase(
        "postgres://benchmark:benchmark@localhost/benchmark_e2e?sslmode=disable",
        "postgresql://benchmark:benchmark@127.0.0.1:5432/benchmark_e2e",
      ),
    ).toThrow(/Datenbank der App/);
  });

  it("bricht ab, wenn die Datenbank der App unbekannt ist", () => {
    expect(() => assertNotAppDatabase("postgres://u:p@127.0.0.1:5432/benchmark_e2e", undefined)).toThrow(
      /Datenbank der App/,
    );
  });

  it("lässt eine andere Datenbank zu", () => {
    expect(() =>
      assertNotAppDatabase(
        "postgres://u:p@127.0.0.1:5432/benchmark_e2e",
        "postgres://u:p@127.0.0.1:5432/benchmark",
      ),
    ).not.toThrow();
  });
});

describe("assertE2eDatabaseUrl", () => {
  it("lässt nur Datenbanknamen mit der Endung _e2e zu", () => {
    expect(() => assertE2eDatabaseUrl("postgres://u:p@127.0.0.1:5432/benchmark_e2e")).not.toThrow();
    expect(() => assertE2eDatabaseUrl("postgres://u:p@127.0.0.1:5432/benchmark")).toThrow(/Test-Datenbank/);
    expect(() => assertE2eDatabaseUrl(undefined)).toThrow(/Test-Datenbank/);
  });
});
