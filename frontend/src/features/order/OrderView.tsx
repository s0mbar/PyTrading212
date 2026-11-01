import { useId, useMemo, useState } from "react";

import {
  placeOrder,
  type OrderType,
  type PlaceOrderRequest,
  type Position,
  type TimeValidity,
} from "../../api/client";
import { useAction } from "../../hooks/useAction";
import { formatMoney, formatNumber, toNumber } from "../../lib/format";
import { Button, Field, NumberField, Segmented, Toggle } from "../../ui/controls";
import { Dialog } from "../../ui/Dialog";
import { ActionFeedback, Card, Notice } from "../../ui/feedback";

const TICKER_PATTERN = /^[A-Za-z0-9._-]+$/;

const ORDER_TYPES: { value: OrderType; label: string; help: string }[] = [
  { value: "MARKET", label: "Au marché", help: "Exécuté tout de suite au meilleur prix disponible." },
  { value: "LIMIT", label: "Limite", help: "Exécuté seulement à ton prix limite ou mieux." },
  { value: "STOP", label: "Stop", help: "Devient un ordre au marché quand le cours atteint le prix stop." },
  { value: "STOP_LIMIT", label: "Stop limite", help: "Au prix stop, place un ordre limite à ton prix limite." },
];

type Side = "BUY" | "SELL";

type OrderViewProps = {
  positions: Position[];
  environment: "LIVE" | "DEMO" | undefined;
  initialTicker: string;
  onOrderPlaced: () => Promise<void>;
};

function OrderView({ positions, environment, initialTicker, onOrderPlaced }: OrderViewProps) {
  const tickerId = useId();
  const listId = useId();
  const [side, setSide] = useState<Side>("BUY");
  const [ticker, setTicker] = useState(initialTicker);
  const [quantity, setQuantity] = useState(1);
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [limitPrice, setLimitPrice] = useState(0);
  const [stopPrice, setStopPrice] = useState(0);
  const [validity, setValidity] = useState<TimeValidity>("DAY");
  const [extendedHours, setExtendedHours] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const action = useAction();

  const isLive = environment === "LIVE";
  const held = useMemo(
    () => positions.find((position) => position.instrument?.ticker === ticker.trim()),
    [positions, ticker]
  );
  const available = toNumber(held?.quantityAvailableForTrading ?? held?.quantity);
  const needsLimit = orderType === "LIMIT" || orderType === "STOP_LIMIT";
  const needsStop = orderType === "STOP" || orderType === "STOP_LIMIT";

  const errors = {
    ticker: !ticker.trim()
      ? "Indique le ticker Trading 212 (ex. AAPL_US_EQ)."
      : !TICKER_PATTERN.test(ticker.trim())
        ? "Lettres, chiffres, point, tiret ou souligné uniquement."
        : "",
    quantity:
      quantity <= 0
        ? "La quantité doit être positive."
        : side === "SELL" && held && quantity > available
          ? `Tu n'as que ${formatNumber(available)} titre(s) disponibles.`
          : "",
    limit: needsLimit && limitPrice <= 0 ? "Prix limite requis." : "",
    stop: needsStop && stopPrice <= 0 ? "Prix stop requis." : "",
  };
  const valid = Object.values(errors).every((message) => !message);

  const referencePrice = needsLimit ? limitPrice : needsStop ? stopPrice : toNumber(held?.currentPrice);
  const priceCurrency = held?.instrument?.currency ?? "";
  const estimate = referencePrice > 0 ? referencePrice * quantity : 0;
  const typeInfo = ORDER_TYPES.find((item) => item.value === orderType);

  const submit = async () => {
    const payload: PlaceOrderRequest = {
      ticker: ticker.trim(), // Trading 212 tickers are case-sensitive: never upper-case them.
      quantity: side === "SELL" ? -Math.abs(quantity) : Math.abs(quantity),
      order_type: orderType,
      time_validity: validity,
      extended_hours: extendedHours,
      confirm_live: isLive && confirmed,
    };
    if (needsLimit) {
      payload.limit_price = limitPrice;
    }
    if (needsStop) {
      payload.stop_price = stopPrice;
    }
    const result = await action.run(async () => {
      const response = await placeOrder(payload);
      await onOrderPlaced();
      return response;
    });
    setReviewing(false);
    setConfirmed(false);
    if (result) {
      action.succeed(`Ordre transmis à Trading 212 (statut : ${String(result.order.status ?? "envoyé")}).`);
    }
  };

  return (
    <div className="stack">
      {isLive && (
        <Notice tone="warning" title="Compte réel">
          Les ordres passés ici sont exécutés avec ton argent. Un récapitulatif est toujours demandé avant l'envoi.
        </Notice>
      )}

      <Card title="Nouvel ordre">
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) {
              action.reset();
              setReviewing(true);
            }
          }}
        >
          <Segmented<Side>
            label="Sens"
            value={side}
            onChange={setSide}
            options={[
              { value: "BUY", label: "Acheter", tone: "buy" },
              { value: "SELL", label: "Vendre", tone: "sell" },
            ]}
          />

          <Field
            label="Titre (ticker Trading 212)"
            htmlFor={tickerId}
            error={ticker ? errors.ticker : ""}
            hint={held ? `${held.instrument?.name ?? ""} — tu en détiens ${formatNumber(toNumber(held.quantity))}.` : "Choisis dans tes positions ou saisis un ticker (ex. AAPL_US_EQ, VUSAl_EQ)."}
          >
            <input
              id={tickerId}
              list={listId}
              value={ticker}
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
              onChange={(event) => setTicker(event.target.value)}
              placeholder="AAPL_US_EQ"
            />
            <datalist id={listId}>
              {positions.map((position) => (
                <option key={position.instrument?.ticker} value={position.instrument?.ticker}>
                  {position.instrument?.name}
                </option>
              ))}
            </datalist>
          </Field>

          <div className="row-2">
            <NumberField
              label="Quantité"
              value={quantity}
              onChange={setQuantity}
              min={0}
              step={0.0001}
              error={errors.quantity}
              hint={side === "SELL" && held ? `Disponible : ${formatNumber(available)}` : "Fractions acceptées."}
            />
            {side === "SELL" && held && available > 0 && (
              <div className="field field-action">
                <Button variant="ghost" onClick={() => setQuantity(available)}>
                  Tout vendre
                </Button>
              </div>
            )}
          </div>

          <Field label="Type d'ordre" hint={typeInfo?.help}>
            <Segmented<OrderType>
              label="Type d'ordre"
              value={orderType}
              onChange={setOrderType}
              options={ORDER_TYPES.map(({ value, label }) => ({ value, label }))}
            />
          </Field>

          {(needsLimit || needsStop) && (
            <div className="row-2">
              {needsStop && (
                <NumberField label="Prix stop" value={stopPrice} onChange={setStopPrice} min={0} step={0.0001} unit={priceCurrency} error={errors.stop} hint="Cours qui déclenche l'ordre." />
              )}
              {needsLimit && (
                <NumberField label="Prix limite" value={limitPrice} onChange={setLimitPrice} min={0} step={0.0001} unit={priceCurrency} error={errors.limit} hint={side === "BUY" ? "Prix maximum payé." : "Prix minimum accepté."} />
              )}
            </div>
          )}

          {orderType !== "MARKET" && (
            <Field label="Durée de validité">
              <Segmented<TimeValidity>
                label="Durée de validité"
                value={validity}
                onChange={setValidity}
                options={[
                  { value: "DAY", label: "Aujourd'hui" },
                  { value: "GOOD_TILL_CANCEL", label: "Jusqu'à annulation" },
                ]}
              />
            </Field>
          )}

          <Toggle
            checked={extendedHours}
            onChange={setExtendedHours}
            label="Autoriser les heures étendues"
            hint="Pré-ouverture et après-clôture (titres américains) : liquidité plus faible."
          />

          <ActionFeedback error={action.error} success={action.success} />

          <Button type="submit" block disabled={!valid} variant={side === "SELL" ? "danger" : "primary"}>
            Vérifier l'ordre
          </Button>
        </form>
      </Card>

      <Dialog
        open={reviewing}
        tone={isLive ? "danger" : "default"}
        title={`${side === "BUY" ? "Acheter" : "Vendre"} ${formatNumber(quantity)} × ${ticker.trim()}`}
        onClose={() => {
          setReviewing(false);
          setConfirmed(false);
        }}
        actions={
          <>
            <Button variant="secondary" onClick={() => setReviewing(false)} disabled={action.pending}>
              Annuler
            </Button>
            <Button
              variant={side === "SELL" ? "danger" : "primary"}
              pending={action.pending}
              pendingLabel="Envoi…"
              disabled={isLive && !confirmed}
              onClick={() => void submit()}
            >
              Envoyer l'ordre
            </Button>
          </>
        }
      >
        <dl className="facts">
          <dt>Compte</dt>
          <dd>{isLive ? "RÉEL (argent réel)" : "Démo"}</dd>
          <dt>Type</dt>
          <dd>{typeInfo?.label}</dd>
          {needsStop && (
            <>
              <dt>Prix stop</dt>
              <dd>{formatMoney(stopPrice, priceCurrency || "EUR")}</dd>
            </>
          )}
          {needsLimit && (
            <>
              <dt>Prix limite</dt>
              <dd>{formatMoney(limitPrice, priceCurrency || "EUR")}</dd>
            </>
          )}
          {orderType !== "MARKET" && (
            <>
              <dt>Validité</dt>
              <dd>{validity === "DAY" ? "Aujourd'hui" : "Jusqu'à annulation"}</dd>
            </>
          )}
          <dt>Montant estimé</dt>
          <dd>{estimate > 0 ? `≈ ${formatMoney(estimate, priceCurrency || "EUR")}` : "Selon le cours d'exécution"}</dd>
        </dl>
        {isLive && (
          <Toggle checked={confirmed} onChange={setConfirmed} label="Je confirme passer cet ordre avec de l'argent réel" />
        )}
      </Dialog>
    </div>
  );
}

export default OrderView;
