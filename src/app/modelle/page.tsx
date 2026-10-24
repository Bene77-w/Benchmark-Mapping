import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDatabase } from "@/server/db/client";
import { HARNESS_LABELS, HARNESSES } from "@/server/harness/adapter";
import { formatPrice } from "@/server/pricing/format";
import type { ModelView } from "@/server/pricing/model";
import { listModels, listWebSearchPrices } from "@/server/pricing/store";
import { type ModelPriceDefaults, ModelPriceForm, WebSearchPriceForm } from "./price-forms";

export const metadata = { title: "Modelle und Preise – Benchmark-Mapping" };

export default function ModelsPage({ searchParams }: PageProps<"/modelle">) {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Modelle und Preise</h1>
      <p className="max-w-3xl text-muted-foreground">
        Preistabelle für die geschätzten Kosten zum API-Listenpreis (Tokens × Preis + Websuchen × Preis pro
        Suche), unabhängig davon, ob ein Lauf über Abo oder API abgerechnet wurde. Je Lauf gilt der Preis mit
        dem jüngsten Gültig-ab-Datum bis zum Anlegen des Laufs (UTC). Erstbefüllung aus einem datierten
        models.dev-Auszug (Grundtarif, ohne Kontextstufen). Läufe mit unbekanntem Modell legen hier einen
        Eintrag ohne Preis an; ihre Kosten bleiben „unbekannt“, bis ein Preis gepflegt ist. Änderungen wirken
        sofort auf die Anzeige aller betroffenen Läufe.
      </p>
      <Suspense fallback={<p className="text-muted-foreground">Lade Preistabelle …</p>}>
        <PriceTableContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function PriceTableContent({ searchParams }: Pick<PageProps<"/modelle">, "searchParams">) {
  const params = await searchParams;
  const db = getDatabase();
  const [models, webSearchPrices] = await Promise.all([listModels(db), listWebSearchPrices(db)]);
  const defaults = priceDefaults(models, params.modell, params.ab);
  const withoutPrice = models.filter((model) => model.prices.length === 0);
  const withPrice = models.filter((model) => model.prices.length > 0);

  return (
    <>
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Preis anlegen oder ändern</h2>
        <ModelPriceForm
          key={`${defaults.modelId}|${defaults.validFrom}`}
          defaults={defaults}
          modelIds={models.map((model) => model.id)}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Websuche</h2>
        <p className="text-sm text-muted-foreground">
          Preis pro Websuche je Harness. Fehlt er, sind die Kosten von Units mit Websuchen „unbekannt“.
        </p>
        {webSearchPrices.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Websuchpreise.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Harness</TableHead>
                <TableHead>Gültig ab</TableHead>
                <TableHead className="text-right">USD pro Suche</TableHead>
                <TableHead>Herkunft</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {webSearchPrices.map((price) => (
                <TableRow key={`${price.harness}|${price.validFrom}`} data-testid="web-search-price-row">
                  <TableCell>{HARNESS_LABELS[price.harness]}</TableCell>
                  <TableCell>{price.validFrom}</TableCell>
                  <TableCell className="text-right">{formatPrice(price.perSearch)}</TableCell>
                  <TableCell className="text-muted-foreground">{price.source}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <WebSearchPriceForm
          harnesses={HARNESSES.map((harness) => ({ value: harness, label: HARNESS_LABELS[harness] }))}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Modelle ohne Preis</h2>
        {withoutPrice.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine.</p>
        ) : (
          <ul className="flex flex-wrap gap-2" data-testid="models-without-price">
            {withoutPrice.map((model) => (
              <li key={model.id} data-model-id={model.id}>
                <Link href={editHref(model.id)} className="hover:underline">
                  <Badge variant="outline">
                    {model.id} · {model.source}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Preise je Modell</h2>
        <p className="text-sm text-muted-foreground">USD pro Million Tokens; neuester Preis zuerst.</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Modell-ID</TableHead>
              <TableHead>Gültig ab</TableHead>
              <TableHead className="text-right">Input</TableHead>
              <TableHead className="text-right">Cache-Read</TableHead>
              <TableHead className="text-right">Cache-Write</TableHead>
              <TableHead className="text-right">Output</TableHead>
              <TableHead>Herkunft</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {withPrice.flatMap((model) =>
              model.prices.map((price, index) => (
                <TableRow
                  key={`${model.id}|${price.validFrom}`}
                  data-model-id={model.id}
                  data-testid="price-row"
                >
                  <TableCell className="font-mono text-xs">{index === 0 ? model.id : ""}</TableCell>
                  <TableCell>{price.validFrom}</TableCell>
                  <TableCell className="text-right">{formatPrice(price.input)}</TableCell>
                  <TableCell className="text-right">{formatPrice(price.cacheRead)}</TableCell>
                  <TableCell className="text-right">{formatPrice(price.cacheWrite)}</TableCell>
                  <TableCell className="text-right">{formatPrice(price.output)}</TableCell>
                  <TableCell className="text-muted-foreground">{price.source}</TableCell>
                  <TableCell>
                    <Link href={editHref(model.id, price.validFrom)} className="text-sm hover:underline">
                      Bearbeiten
                    </Link>
                  </TableCell>
                </TableRow>
              )),
            )}
          </TableBody>
        </Table>
      </section>
    </>
  );
}

function editHref(modelId: string, validFrom?: string): string {
  const query = new URLSearchParams({ modell: modelId, ...(validFrom ? { ab: validFrom } : {}) });
  return `/modelle?${query}`;
}

/** Formularwerte: ausgewählter Preis (`?modell=…&ab=…`), sonst leer mit heutigem Datum. */
function priceDefaults(
  models: ModelView[],
  modelId: string | string[] | undefined,
  validFrom: string | string[] | undefined,
): ModelPriceDefaults {
  const today = new Date().toISOString().slice(0, 10);
  const id = typeof modelId === "string" ? modelId : "";
  const date = typeof validFrom === "string" ? validFrom : today;
  const price = models.find((model) => model.id === id)?.prices.find((entry) => entry.validFrom === date);
  return {
    modelId: id,
    validFrom: date,
    input: price?.input ?? null,
    cacheRead: price?.cacheRead ?? null,
    cacheWrite: price?.cacheWrite ?? null,
    output: price?.output ?? null,
  };
}
