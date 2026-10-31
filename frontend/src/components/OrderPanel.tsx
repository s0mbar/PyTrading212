import { useState } from "react";

import { placeOrder, type OrderType, type PlaceOrderRequest, type TimeValidity } from "../api/client";
import { errorMessage } from "../api/http";

type OrderFormState = {
  ticker: string;
  quantity: number;
  orderType: OrderType;
  limitPrice: number;
  stopPrice: number;
  timeValidity: TimeValidity;
  extendedHours: boolean;
  confirmLive: boolean;
};

type OrderPanelProps = {
  onOrderPlaced: () => Promise<void>;
};

function OrderPanel({ onOrderPlaced }: OrderPanelProps) {
  const [orderForm, setOrderForm] = useState<OrderFormState>({
    ticker: "",
    quantity: 1,
    orderType: "MARKET",
    limitPrice: 0,
    stopPrice: 0,
    timeValidity: "DAY",
    extendedHours: false,
    confirmLive: false,
  });
  const [orderMessage, setOrderMessage] = useState<string>("");
  const [orderError, setOrderError] = useState<string>("");
  const [orderLoading, setOrderLoading] = useState<boolean>(false);

  const onSubmitOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    setOrderLoading(true);
    setOrderError("");
    setOrderMessage("");

    // Trading 212 tickers are case-sensitive (e.g. "SIGTl_EQ"): never upper-case them.
    const payload: PlaceOrderRequest = {
      ticker: orderForm.ticker.trim(),
      quantity: Number(orderForm.quantity),
      order_type: orderForm.orderType,
      time_validity: orderForm.timeValidity,
      extended_hours: orderForm.extendedHours,
      confirm_live: orderForm.confirmLive,
    };

    if (orderForm.orderType === "LIMIT" || orderForm.orderType === "STOP_LIMIT") {
      payload.limit_price = Number(orderForm.limitPrice);
    }

    if (orderForm.orderType === "STOP" || orderForm.orderType === "STOP_LIMIT") {
      payload.stop_price = Number(orderForm.stopPrice);
    }

    try {
      const result = await placeOrder(payload);
      const orderId = String(result.order.id ?? "N/A");
      const side = String(result.order.side ?? "N/A");
      const statusLabel = String(result.order.status ?? "N/A");
      setOrderMessage(
        `${result.order_type} sent (${result.environment}) • id=${orderId} • side=${side} • status=${statusLabel}`
      );
      setOrderForm((prev) => ({ ...prev, confirmLive: false }));
      await onOrderPlaced();
    } catch (err) {
      setOrderError(errorMessage(err, "Order execution error"));
    } finally {
      setOrderLoading(false);
    }
  };

  return (
    <article className="card">
      <h2>Advanced order execution</h2>
      <form className="form-grid" onSubmit={onSubmitOrder}>
        <label>
          Ticker
          <input
            type="text"
            value={orderForm.ticker}
            onChange={(event) => setOrderForm((prev) => ({ ...prev, ticker: event.target.value }))}
            placeholder="AAPL_US_EQ"
            pattern="[A-Za-z0-9._\-]+"
            maxLength={40}
            required
          />
        </label>

        <label>
          Quantity (+ buy / - sell)
          <input
            type="number"
            step="0.0001"
            value={orderForm.quantity}
            onChange={(event) => setOrderForm((prev) => ({ ...prev, quantity: Number(event.target.value) }))}
            required
          />
        </label>

        <label>
          Order type
          <select
            value={orderForm.orderType}
            onChange={(event) => setOrderForm((prev) => ({ ...prev, orderType: event.target.value as OrderType }))}
          >
            <option value="MARKET">MARKET</option>
            <option value="LIMIT">LIMIT</option>
            <option value="STOP">STOP</option>
            <option value="STOP_LIMIT">STOP_LIMIT</option>
          </select>
        </label>

        <label>
          Time validity
          <select
            value={orderForm.timeValidity}
            onChange={(event) =>
              setOrderForm((prev) => ({ ...prev, timeValidity: event.target.value as TimeValidity }))
            }
          >
            <option value="DAY">DAY</option>
            <option value="GOOD_TILL_CANCEL">GOOD_TILL_CANCEL</option>
          </select>
        </label>

        {(orderForm.orderType === "LIMIT" || orderForm.orderType === "STOP_LIMIT") && (
          <label>
            Limit price
            <input
              type="number"
              step="0.0001"
              min="0"
              value={orderForm.limitPrice}
              onChange={(event) => setOrderForm((prev) => ({ ...prev, limitPrice: Number(event.target.value) }))}
              required
            />
          </label>
        )}

        {(orderForm.orderType === "STOP" || orderForm.orderType === "STOP_LIMIT") && (
          <label>
            Stop price
            <input
              type="number"
              step="0.0001"
              min="0"
              value={orderForm.stopPrice}
              onChange={(event) => setOrderForm((prev) => ({ ...prev, stopPrice: Number(event.target.value) }))}
              required
            />
          </label>
        )}

        <label className="inline-check">
          <input
            type="checkbox"
            checked={orderForm.extendedHours}
            onChange={(event) => setOrderForm((prev) => ({ ...prev, extendedHours: event.target.checked }))}
          />
          Allow extended hours
        </label>

        <label className="inline-check">
          <input
            type="checkbox"
            checked={orderForm.confirmLive}
            onChange={(event) => setOrderForm((prev) => ({ ...prev, confirmLive: event.target.checked }))}
          />
          Confirm real LIVE execution
        </label>

        <button type="submit" disabled={orderLoading}>
          {orderLoading ? "Sending..." : "Place order"}
        </button>
      </form>

      {orderMessage && <p className="success-text">{orderMessage}</p>}
      {orderError && <p className="error">{orderError}</p>}
    </article>
  );
}

export default OrderPanel;
