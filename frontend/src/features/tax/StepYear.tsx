import { useId } from "react";

import { Button, Field } from "../../ui/controls";
import { Card, Notice } from "../../ui/feedback";
import type { TaxInputs } from "./TaxView";
import { FIRST_YEAR } from "./taxSources";

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: currentYear - FIRST_YEAR + 1 }, (_, index) => currentYear - index);

function StepYear({
  inputs,
  onChange,
  onNext,
}: {
  inputs: TaxInputs;
  onChange: (inputs: TaxInputs) => void;
  onNext: () => void;
}) {
  const yearId = useId();
  const firstId = useId();

  return (
    <Card title="Quelle déclaration prépares-tu ?">
      <p className="meta">
        Trading 212 est un courtier étranger : il ne t'envoie pas d'IFU. Cet assistant le reconstitue à partir de ton
        historique et te donne, case par case, les montants à reporter sur impots.gouv.fr (2042, 2042-C, 2047, 2074,
        3916).
      </p>
      <div className="form">
        <Field label="Année des revenus" htmlFor={yearId} hint={`En ${currentYear}, tu déclares les revenus de ${currentYear - 1}.`}>
          <select
            id={yearId}
            value={inputs.year}
            onChange={(event) => {
              const year = Number(event.target.value);
              onChange({ ...inputs, year, firstYear: Math.min(inputs.firstYear, year) });
            }}
          >
            {YEARS.map((year) => (
              <option key={year} value={year}>
                Revenus {year} — déclaration {year + 1}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Année de ton tout premier achat sur Trading 212"
          htmlFor={firstId}
          hint="Le prix de revient (PMP) d'une vente dépend de TOUS tes achats passés : il faut l'historique depuis le début."
        >
          <select
            id={firstId}
            value={inputs.firstYear}
            onChange={(event) => onChange({ ...inputs, firstYear: Number(event.target.value) })}
          >
            {YEARS.filter((year) => year <= inputs.year).map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </Field>

        <Notice tone="info">
          Il faudra donc les données de <strong>{inputs.firstYear === inputs.year ? inputs.year : `${inputs.firstYear} à ${inputs.year}`}</strong>{" "}
          ({inputs.year - inputs.firstYear + 1} année{inputs.year > inputs.firstYear ? "s" : ""}). L'étape suivante te
          les fait récupérer.
        </Notice>

        <Button block onClick={onNext}>
          Continuer
        </Button>
      </div>
    </Card>
  );
}

export default StepYear;
