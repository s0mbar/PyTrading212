"""Normalised account history, independent of the Trading 212 export format."""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import StrEnum


class TransactionKind(StrEnum):
    buy = "BUY"
    sell = "SELL"
    dividend = "DIVIDEND"
    interest = "INTEREST"
    return_of_capital = "RETURN_OF_CAPITAL"
    split_close = "SPLIT_CLOSE"
    split_open = "SPLIT_OPEN"
    cash_movement = "CASH_MOVEMENT"
    unsupported = "UNSUPPORTED"


@dataclass(frozen=True)
class Transaction:
    """One history row. Amounts in `total` are in the account currency (`total_currency`)."""

    kind: TransactionKind
    action: str
    at: datetime
    isin: str
    ticker: str
    name: str
    quantity: Decimal
    price_per_share: Decimal | None
    price_currency: str
    total: Decimal
    total_currency: str
    withholding_tax: Decimal | None
    withholding_currency: str
    fees: Decimal
    broker_result: Decimal | None
    transaction_id: str
    source: str
    original_currency: str = ""

    @property
    def instrument_key(self) -> str:
        """ISIN identifies a line across ticker renames; the ticker is the fallback."""
        return self.isin or self.ticker

    @property
    def dedup_key(self) -> tuple[object, ...]:
        if self.transaction_id:
            return (self.action, self.transaction_id, self.instrument_key)
        return (
            self.action,
            self.at.replace(microsecond=0),
            self.instrument_key,
            self.quantity,
            self.total,
        )
