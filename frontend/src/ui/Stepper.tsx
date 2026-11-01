export type Step = { id: string; label: string; done: boolean };

/** Numbered progress for multi-step flows; completed steps stay clickable. */
export function Stepper({
  steps,
  current,
  onSelect,
}: {
  steps: Step[];
  current: number;
  onSelect: (index: number) => void;
}) {
  return (
    <ol className="stepper" aria-label="Étapes">
      {steps.map((step, index) => {
        const reachable = index <= current || steps.slice(0, index).every((item) => item.done);
        const state = index === current ? "current" : step.done ? "done" : "todo";
        return (
          <li key={step.id} className={`step step-${state}`}>
            <button
              type="button"
              disabled={!reachable}
              aria-current={index === current ? "step" : undefined}
              onClick={() => onSelect(index)}
            >
              <span className="step-index">{step.done && index !== current ? "✓" : index + 1}</span>
              <span className="step-label">{step.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
