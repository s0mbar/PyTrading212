import { Button, Collapsible, NumberField } from "../../ui/controls";
import { Card } from "../../ui/feedback";
import type { TaxInputs } from "./TaxView";

function StepOptions({
  inputs,
  onChange,
  onBack,
  onNext,
}: {
  inputs: TaxInputs;
  onChange: (inputs: TaxInputs) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const lossesInvalid = inputs.priorLosses < 0;
  const rateInvalid = inputs.treatyRatePct < 0 || inputs.treatyRatePct > 50;

  return (
    <div className="stack">
      <Card title="Deux précisions" subtitle="Dans le doute, garde les valeurs proposées : elles conviennent à la plupart des cas.">
        <div className="form">
          <NumberField
            label="Moins-values des années précédentes encore reportables"
            unit="€"
            min={0}
            step={0.01}
            value={inputs.priorLosses}
            onChange={(priorLosses) => onChange({ ...inputs, priorLosses })}
            error={lossesInvalid ? "Le montant ne peut pas être négatif." : ""}
            hint="Pertes sur ventes d'actions non encore imputées (10 ans maximum). 0 si tu n'en as pas."
          />
          <Collapsible title="Où trouver ce montant ?">
            <p>
              Sur ta <strong>déclaration de l'an dernier</strong> (formulaire 2042-C, rubrique des plus-values) ou sur
              ton <strong>avis d'impôt</strong> : le solde des moins-values reportables y figure. Si tu n'as jamais vendu à
              perte, laisse <strong>0</strong>.
            </p>
          </Collapsible>

          <NumberField
            label="Taux de retenue à la source « conventionnel » par défaut"
            unit="%"
            min={0}
            max={50}
            step={0.5}
            value={inputs.treatyRatePct}
            onChange={(treatyRatePct) => onChange({ ...inputs, treatyRatePct })}
            error={rateInvalid ? "Entre 0 et 50 %." : ""}
            hint="Plafond du crédit d'impôt (case 2AB). 15 % convient aux dividendes américains."
          />
          <Collapsible title="Pourquoi 15 % ?">
            <p>
              Les dividendes étrangers subissent un impôt prélevé à la source dans leur pays. La France rembourse cet
              impôt sous forme de crédit, <strong>dans la limite du taux prévu par la convention fiscale</strong> : 15 %
              pour les États-Unis (formulaire W-8BEN, signé automatiquement à l'ouverture chez Trading 212) et la plupart
              des pays européens.
            </p>
          </Collapsible>
        </div>
      </Card>

      <div className="step-nav">
        <Button variant="secondary" onClick={onBack}>
          Retour
        </Button>
        <Button onClick={onNext} disabled={lossesInvalid || rateInvalid}>
          Calculer mon IFU
        </Button>
      </div>
    </div>
  );
}

export default StepOptions;
