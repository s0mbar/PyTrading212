import { useId, useState } from "react";

import { Button, Field } from "../../ui/controls";
import { TICKER_PATTERN } from "./botConfig";

type TickerChipsProps = {
  tickers: string[];
  onChange: (tickers: string[]) => void;
  suggestions: { ticker: string; name: string }[];
  error?: string;
  max?: number;
};

/** Add/remove tickers as chips; held positions are offered as one-tap suggestions. */
function TickerChips({ tickers, onChange, suggestions, error, max = 12 }: TickerChipsProps) {
  const id = useId();
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState("");

  const add = (raw: string) => {
    // Trading 212 tickers are case-sensitive (e.g. "SIGTl_EQ"): never change their case.
    const candidates = raw.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
    const invalid = candidates.filter((item) => !TICKER_PATTERN.test(item));
    const next = [...tickers];
    for (const item of candidates) {
      if (TICKER_PATTERN.test(item) && !next.includes(item) && next.length < max) {
        next.push(item);
      }
    }
    setInputError(invalid.length ? `Ignoré (format invalide) : ${invalid.join(", ")}` : next.length >= max ? `Maximum ${max} titres.` : "");
    onChange(next);
    setInput("");
  };

  const remaining = suggestions.filter((item) => !tickers.includes(item.ticker));

  return (
    <Field
      label={`Titres surveillés (${tickers.length}/${max})`}
      htmlFor={id}
      error={inputError || error}
      hint="Ticker Trading 212, ex. AAPL_US_EQ. Entrée ou virgule pour ajouter."
    >
      {tickers.length > 0 && (
        <ul className="chips">
          {tickers.map((ticker) => (
            <li key={ticker} className="chip">
              <span>{ticker}</span>
              <button type="button" aria-label={`Retirer ${ticker}`} onClick={() => onChange(tickers.filter((item) => item !== ticker))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="input-row">
        <input
          id={id}
          value={input}
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          placeholder="Ajouter un ticker"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add(input);
            }
          }}
        />
        <Button variant="secondary" disabled={!input.trim()} onClick={() => add(input)}>
          Ajouter
        </Button>
      </div>
      {remaining.length > 0 && tickers.length < max && (
        <div className="suggestions">
          <span className="meta">Tes positions :</span>
          {remaining.slice(0, 8).map((item) => (
            <button key={item.ticker} type="button" className="chip chip-suggest" title={item.name} onClick={() => add(item.ticker)}>
              + {item.ticker}
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}

export default TickerChips;
