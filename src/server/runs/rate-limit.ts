import { setTimeout as sleep } from "node:timers/promises";
import type { HarnessResult } from "@/server/harness/adapter";

/**
 * Gemeinsames Warten bei Ratenlimit innerhalb eines Laufs. Meldet ein Aufruf ein Ratenlimit, wird er
 * Stellvertreter: alle anderen Aufrufe des Laufs starten erst wieder, wenn er im Takt `intervalMs`
 * erfolgreich nachgefragt hat (d. h. kein Ratenlimit mehr gemeldet wurde).
 */
export class RateLimitWait {
  private waiting: Promise<void> | null = null;

  constructor(
    private readonly options: {
      intervalMs: number;
      /** Bricht das Warten ab (Lauf abgebrochen). */
      signal: AbortSignal;
      /** Meldet den Zeitpunkt der nächsten Nachfrage bzw. `null`, wenn nicht mehr gewartet wird. */
      onChange: (until: Date | null) => Promise<void>;
    },
  ) {}

  /** Kehrt zurück, sobald gerade nicht gewartet wird (sofort, wenn kein Ratenlimit vorliegt). */
  async whenOpen(): Promise<void> {
    while (this.waiting) await this.waiting;
  }

  /**
   * Nach einem Ratenlimit: Wartet schon ein Stellvertreter, liefert `null` sofort (der Aufrufer wartet über
   * `whenOpen` und ruft dann erneut auf). Sonst wartet dieser Aufrufer im Takt und ruft `probe` erneut auf,
   * bis kein Ratenlimit mehr kommt, und liefert dieses Ergebnis; `null`, wenn das Warten abgebrochen wurde
   * (Signal oder `probe` liefert `null`).
   */
  async represent(probe: () => Promise<HarnessResult | null>): Promise<HarnessResult | null> {
    if (this.waiting) return null;
    const { intervalMs, signal, onChange } = this.options;
    let release = () => {};
    this.waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      for (;;) {
        await onChange(new Date(Date.now() + intervalMs));
        const slept = await sleep(intervalMs, true, { signal }).catch(() => false);
        if (!slept) return null;
        const result = await probe();
        if (result?.outcome.kind !== "rate_limit") return result;
      }
    } finally {
      await onChange(null);
      this.waiting = null;
      release();
    }
  }
}
