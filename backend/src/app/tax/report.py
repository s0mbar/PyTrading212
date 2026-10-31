"""Rebuild the figures of a French IFU from a Trading 212 history.

Rules applied (to be checked against the yearly notices 2042, 2042-C, 2047, 2074 and 3916):
- capital gains use the weighted average acquisition price (PMP, art. 150-0 D CGI), in euros,
  fees included in the cost and deducted from the proceeds;
- dividends are declared gross (net received + foreign withholding tax);
- the foreign tax credit (2AB) is the withholding tax capped at the treaty rate.
"""

import re
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal

from .csv_import import ParsedHistory
from .schemas import (
    CapitalGainsSummary,
    CountryIncome,
    DeclarationBox,
    DisposalLine,
    DividendBox,
    DividendLine,
    ForeignAccount,
    InterestLine,
    SourceSummary,
    TaxEstimate,
    TaxReportResponse,
)
from .transactions import Transaction, TransactionKind

ZERO = Decimal(0)
CENT = Decimal("0.01")
QUANTITY_TOLERANCE = Decimal("0.000001")
SPLIT_PAIR_MAX_SECONDS = 60
PFU_INCOME_TAX_RATE = Decimal("0.128")
SOCIAL_CONTRIBUTIONS_RATE = Decimal("0.172")
DOMESTIC_COUNTRY = "FR"
ACCOUNT_CURRENCY = "EUR"

# Trading 212 Markets Ltd (Cyprus) holds the accounts of EU residents and pays the cash interest.
BROKER_ENTITY = "Trading 212 Markets Ltd"
BROKER_COUNTRY = "CY"
BROKER_COUNTRY_LABEL = "Chypre"
BROKER_REGULATOR = "CySEC, licence n° 398/21"
BROKER_INTEREST_ACTIONS = {
    "interest on cash": "Intérêts sur liquidités",
    "lending interest": "Intérêts de prêt de titres",
}

# Distributions of funds are not eligible to the 40 % allowance (2TS instead of 2DC).
FUND_NAME_PATTERN = re.compile(r"\b(ETF|ETC|ETN|UCITS|FUND|FONDS|SICAV|OPCVM)\b", re.IGNORECASE)


@dataclass(frozen=True)
class TaxOptions:
    year: int
    prior_capital_losses: Decimal = ZERO
    default_treaty_rate: Decimal = Decimal("0.15")
    category_overrides: Mapping[str, DividendBox] = field(default_factory=dict)


@dataclass
class _Holding:
    quantity: Decimal = ZERO
    cost: Decimal = ZERO


@dataclass(frozen=True)
class _Disposal:
    transaction: Transaction
    proceeds: Decimal
    cost: Decimal
    average_cost: Decimal
    missing_quantity: Decimal

    @property
    def gain(self) -> Decimal:
        return self.proceeds - self.cost


@dataclass(frozen=True)
class _Dividend:
    transaction: Transaction
    country: str
    box: DividendBox
    box_overridden: bool
    withholding: Decimal | None
    gross: Decimal
    tax_credit: Decimal


@dataclass(frozen=True)
class _Interest:
    transaction: Transaction
    label: str
    country: str


@dataclass(frozen=True)
class _CapitalGains:
    gains: Decimal
    losses: Decimal
    prior_losses: Decimal
    disposals: list[_Disposal]

    @property
    def net(self) -> Decimal:
        return self.gains - self.losses

    @property
    def prior_losses_used(self) -> Decimal:
        return min(self.prior_losses, self.net) if self.net > 0 else ZERO

    @property
    def taxable_gain(self) -> Decimal:
        return max(self.net - self.prior_losses_used, ZERO)

    @property
    def net_loss(self) -> Decimal:
        return -self.net if self.net < 0 else ZERO

    def to_schema(self) -> CapitalGainsSummary:
        return CapitalGainsSummary(
            gains=_money(self.gains),
            losses=_money(self.losses),
            net=_money(self.net),
            prior_losses_used=_money(self.prior_losses_used),
            prior_losses_remaining=_money(self.prior_losses - self.prior_losses_used),
            disposals_count=len(self.disposals),
            total_proceeds=_money(_sum(d.proceeds for d in self.disposals)),
        )


@dataclass(frozen=True)
class _IncomeTotals:
    eligible_dividends: Decimal
    other_distributions: Decimal
    interest: Decimal
    tax_credit: Decimal

    @property
    def distributions(self) -> Decimal:
        return self.eligible_dividends + self.other_distributions


def build_tax_report(
    history: ParsedHistory, options: TaxOptions, *, source_names: list[str]
) -> TaxReportResponse:
    warnings = list(history.warnings)
    transactions = history.transactions

    disposals = _compute_disposals(transactions, options.year, warnings)
    dividends = _compute_dividends(transactions, options, warnings)
    interests = _compute_interests(transactions, options.year)
    _warn_unhandled_events(transactions, options.year, warnings)
    _warn_currency(transactions, warnings)
    if not (disposals or dividends or interests):
        warnings.append(f"Aucune cession, dividende ni intérêt trouvé pour {options.year}.")

    capital_gains = _CapitalGains(
        gains=_sum(d.gain for d in disposals if d.gain > 0),
        losses=_sum(-d.gain for d in disposals if d.gain < 0),
        prior_losses=options.prior_capital_losses,
        disposals=disposals,
    )
    totals = _IncomeTotals(
        eligible_dividends=_sum(d.gross for d in dividends if d.box == DividendBox.eligible),
        other_distributions=_sum(d.gross for d in dividends if d.box == DividendBox.non_eligible),
        interest=_sum(i.transaction.total for i in interests),
        tax_credit=_sum(d.tax_credit for d in dividends),
    )

    return TaxReportResponse(
        year=options.year,
        generated_at=datetime.now(UTC),
        boxes=_declaration_boxes(totals, capital_gains),
        capital_gains=capital_gains.to_schema(),
        disposals=[_disposal_line(item) for item in disposals],
        dividends=[_dividend_line(item) for item in dividends],
        interests=[_interest_line(item) for item in interests],
        by_country=_income_by_country(dividends, interests),
        estimate=_estimate_flat_tax(totals, capital_gains.taxable_gain),
        foreign_account=_foreign_account(transactions),
        sources=_source_summary(transactions, source_names),
        warnings=warnings,
    )


# --- Capital gains (PMP) -------------------------------------------------------------------


def _compute_disposals(
    transactions: list[Transaction], year: int, warnings: list[str]
) -> list[_Disposal]:
    holdings: dict[str, _Holding] = defaultdict(_Holding)
    disposals: list[_Disposal] = []
    split_targets, unpaired = _pair_split_rows(transactions)
    split_anomalies = {t.ticker or t.isin for t in unpaired if t.at.year <= year}

    for index, transaction in enumerate(transactions):
        if transaction.at.year > year:
            break
        holding = holdings[transaction.instrument_key]
        if transaction.kind == TransactionKind.buy:
            holding.quantity += transaction.quantity
            holding.cost += abs(transaction.total)
        elif transaction.kind == TransactionKind.split_close:
            if transaction.quantity > holding.quantity + QUANTITY_TOLERANCE:
                split_anomalies.add(transaction.ticker or transaction.isin)
            target_key = split_targets.get(index, transaction.instrument_key)
            _close_split_half(holding, holdings[target_key], transaction.quantity)
        elif transaction.kind == TransactionKind.split_open:
            holding.quantity += transaction.quantity
        elif transaction.kind == TransactionKind.sell:
            disposal = _sell(holding, transaction)
            if transaction.at.year == year:
                disposals.append(disposal)

    incomplete = sorted(
        {d.transaction.ticker or d.transaction.isin for d in disposals if d.missing_quantity}
    )
    if incomplete:
        warnings.append(
            "Historique d'achat incomplet pour : "
            + ", ".join(incomplete)
            + ". Le prix d'acquisition "
            "des titres manquants est compté à 0 € (plus-value surestimée). Ajoutez les exports "
            "de toutes les années depuis l'ouverture du compte."
        )
    if split_anomalies:
        warnings.append(
            "Division de titres (split) sans achat antérieur connu pour : "
            + ", ".join(sorted(split_anomalies))
            + ". Vérifiez le prix de revient de ces lignes."
        )
    return disposals


def _pair_split_rows(
    transactions: list[Transaction],
) -> tuple[dict[int, str], list[Transaction]]:
    """Match each "Stock split close" row with its "Stock split open" row (same instant).

    Returns the instrument key receiving the cost of each close row (it differs when the ISIN
    changes), and the rows left without a partner.
    """
    closes = [i for i, t in enumerate(transactions) if t.kind == TransactionKind.split_close]
    opens = [i for i, t in enumerate(transactions) if t.kind == TransactionKind.split_open]
    targets: dict[int, str] = {}
    for close_index in closes:
        close = transactions[close_index]
        candidates = [
            i
            for i in opens
            if abs((transactions[i].at - close.at).total_seconds()) <= SPLIT_PAIR_MAX_SECONDS
        ]
        if not candidates:
            continue
        open_index = min(
            candidates,
            key=lambda i: (
                transactions[i].ticker != close.ticker,
                abs((transactions[i].at - close.at).total_seconds()),
            ),
        )
        opens.remove(open_index)
        targets[close_index] = transactions[open_index].instrument_key
    unpaired = [transactions[i] for i in closes if i not in targets] + [
        transactions[i] for i in opens
    ]
    return targets, unpaired


def _close_split_half(source: _Holding, target: _Holding, quantity: Decimal) -> None:
    """Remove the pre-split quantity; its cost moves to the post-split line (same or new ISIN)."""
    moved_cost = (
        source.cost if quantity >= source.quantity else source.cost * quantity / source.quantity
    )
    source.quantity = max(ZERO, source.quantity - quantity)
    source.cost -= moved_cost
    target.cost += moved_cost


def _sell(holding: _Holding, transaction: Transaction) -> _Disposal:
    held = holding.quantity
    sold = transaction.quantity
    covered = min(sold, held)
    average_cost = holding.cost / held if held > 0 else ZERO
    cost = average_cost * covered

    holding.quantity = held - sold
    holding.cost -= cost
    if holding.quantity <= QUANTITY_TOLERANCE:
        holding.quantity = ZERO
        holding.cost = ZERO

    missing = sold - held
    return _Disposal(
        transaction=transaction,
        proceeds=abs(transaction.total),
        cost=cost,
        average_cost=average_cost,
        missing_quantity=missing if missing > QUANTITY_TOLERANCE else ZERO,
    )


# --- Dividends and interest ----------------------------------------------------------------


def _compute_dividends(
    transactions: list[Transaction], options: TaxOptions, warnings: list[str]
) -> list[_Dividend]:
    dividends: list[_Dividend] = []
    unconverted: set[str] = set()
    above_treaty: set[str] = set()

    for transaction in _in_year(transactions, options.year, TransactionKind.dividend):
        withholding = _withholding_in_account_currency(transaction)
        if withholding is None:
            unconverted.add(transaction.ticker or transaction.isin)
        withheld = withholding or ZERO
        gross = transaction.total + withheld
        country = transaction.isin[:2] or "??"
        box, overridden = _dividend_box(transaction, options.category_overrides)
        credit = _tax_credit(gross, withheld, country, options.default_treaty_rate)
        if abs(withheld) > abs(credit) + CENT and country != DOMESTIC_COUNTRY:
            above_treaty.add(country)
        dividends.append(
            _Dividend(transaction, country, box, overridden, withholding, gross, credit)
        )

    if unconverted:
        warnings.append(
            "Retenue à la source non convertible en euros pour : "
            + ", ".join(sorted(unconverted))
            + ". Le brut de ces dividendes est sous-estimé : complétez-le à partir de vos relevés."
        )
    if above_treaty:
        warnings.append(
            "Retenue à la source supérieure au taux conventionnel retenu ("
            + ", ".join(sorted(above_treaty))
            + ") : seul ce taux est imputable en 2AB, "
            "l'excédent se réclame auprès du fisc étranger."
        )
    if any(d.country == DOMESTIC_COUNTRY for d in dividends):
        warnings.append(
            "Dividendes de source française (ISIN FR) : ils ne relèvent ni de la 2047 ni du crédit "
            "2AB. Une éventuelle retenue française correspond à un acompte (case 2CK) : vérifiez."
        )
    return dividends


def _withholding_in_account_currency(transaction: Transaction) -> Decimal | None:
    """Convert the withholding tax with the rate implied by the row itself.

    "Price / share" is net of foreign tax, so net received in account currency divided by
    shares x net price gives the conversion rate actually applied to the payment.
    """
    tax = transaction.withholding_tax
    if not tax:
        return ZERO
    sign = Decimal(-1) if transaction.total < 0 else Decimal(1)
    tax = abs(tax)
    currency = transaction.withholding_currency
    if not currency or currency == transaction.total_currency:
        return sign * tax
    if currency == transaction.price_currency and transaction.price_per_share:
        received_foreign = transaction.quantity * abs(transaction.price_per_share)
        if received_foreign > 0 and transaction.total:
            return sign * tax * abs(transaction.total) / received_foreign
    return None


def _dividend_box(
    transaction: Transaction, overrides: Mapping[str, DividendBox]
) -> tuple[DividendBox, bool]:
    override = overrides.get(transaction.instrument_key)
    if override is not None:
        return override, True
    if FUND_NAME_PATTERN.search(transaction.name):
        return DividendBox.non_eligible, False
    return DividendBox.eligible, False


def _tax_credit(gross: Decimal, withheld: Decimal, country: str, treaty_rate: Decimal) -> Decimal:
    if country == DOMESTIC_COUNTRY or not withheld or not gross:
        return ZERO
    sign = Decimal(-1) if gross < 0 else Decimal(1)
    return sign * min(abs(withheld), abs(gross) * treaty_rate)


def _compute_interests(transactions: list[Transaction], year: int) -> list[_Interest]:
    interests: list[_Interest] = []
    for transaction in _in_year(transactions, year, TransactionKind.interest):
        action = transaction.action.strip().lower()
        if action in BROKER_INTEREST_ACTIONS:
            label, country = BROKER_INTEREST_ACTIONS[action], BROKER_COUNTRY
        else:
            label = f"Distribution d'intérêts — {transaction.name or transaction.ticker}"
            country = transaction.isin[:2] or "??"
        interests.append(_Interest(transaction, label, country))
    return interests


def _warn_unhandled_events(transactions: list[Transaction], year: int, warnings: list[str]) -> None:
    returns = list(_in_year(transactions, year, TransactionKind.return_of_capital))
    if returns:
        names = ", ".join(sorted({t.ticker or t.isin for t in returns}))
        amount = _money(_sum(t.total for t in returns))
        warnings.append(
            f"Remboursements de capital ({names}, {amount} €) exclus "
            "des revenus : ils réduisent en principe le prix de revient des titres, à vérifier."
        )


def _warn_currency(transactions: list[Transaction], warnings: list[str]) -> None:
    foreign = sorted({t.total_currency for t in transactions} - {ACCOUNT_CURRENCY, ""})
    if foreign:
        warnings.append(
            "Montants en "
            + ", ".join(foreign)
            + " non convertis en euros (cours BCE indisponible) : ils sont comptés tels quels, "
            "corrigez-les manuellement."
        )


# --- Declaration figures -------------------------------------------------------------------


def _declaration_boxes(totals: _IncomeTotals, capital_gains: _CapitalGains) -> list[DeclarationBox]:
    via_2047 = "À saisir d'abord sur la déclaration 2047 (revenus encaissés à l'étranger)."
    return [
        _box(
            "2DC",
            "2042",
            "Revenus des actions et parts ouvrant droit à l'abattement de 40 %",
            totals.eligible_dividends,
            f"Dividendes bruts d'actions (avant retenue à la source). {via_2047}",
        ),
        _box(
            "2TS",
            "2042",
            "Revenus de valeurs mobilières n'ouvrant pas droit à abattement",
            totals.other_distributions,
            f"Distributions d'ETF / fonds et revenus non éligibles, montant brut. {via_2047}",
        ),
        _box(
            "2TR",
            "2042",
            "Produits de placement à revenu fixe (intérêts)",
            totals.interest,
            f"Intérêts sur liquidités, prêt de titres, distributions d'intérêts. {via_2047}",
        ),
        _box(
            "2AB",
            "2042",
            "Crédits d'impôt sur valeurs étrangères",
            totals.tax_credit,
            "Retenues à la source étrangères dans la limite du taux conventionnel.",
        ),
        _box(
            "2CK",
            "2042",
            "Prélèvement forfaitaire non libératoire déjà versé",
            ZERO,
            "Trading 212 ne prélève pas l'acompte de 12,8 %. Indiquez ici ce que vous auriez "
            "payé vous-même (formulaire 2778-DIV), sinon laissez vide.",
        ),
        _box(
            "3VG",
            "2042-C",
            "Plus-value de cession de valeurs mobilières",
            capital_gains.taxable_gain,
            "Plus-value nette de l'année (méthode PMP), après imputation des moins-values "
            "antérieures saisies. Détail des cessions : formulaire 2074.",
        ),
        _box(
            "3VH",
            "2042-C",
            "Moins-value de cession de valeurs mobilières",
            capital_gains.net_loss,
            "Moins-value nette de l'année, reportable sur les plus-values des 10 années suivantes.",
        ),
    ]


def _box(code: str, form: str, label: str, amount: Decimal, help_text: str) -> DeclarationBox:
    return DeclarationBox(
        code=code,
        form=form,
        label=label,
        amount=_money(amount),
        declared_amount=int(amount.quantize(Decimal(1), rounding=ROUND_HALF_UP)),
        help=help_text,
    )


def _estimate_flat_tax(totals: _IncomeTotals, taxable_gain: Decimal) -> TaxEstimate:
    """Indicative PFU (12.8 % income tax + 17.2 % social contributions)."""
    base = max(totals.distributions + totals.interest, ZERO) + taxable_gain
    income_tax = base * PFU_INCOME_TAX_RATE
    credit_cap = max(totals.distributions, ZERO) * PFU_INCOME_TAX_RATE
    credit_used = min(max(totals.tax_credit, ZERO), credit_cap)
    social = base * SOCIAL_CONTRIBUTIONS_RATE
    return TaxEstimate(
        taxable_base=_money(base),
        income_tax=_money(income_tax),
        tax_credit_used=_money(credit_used),
        social_contributions=_money(social),
        total=_money(income_tax - credit_used + social),
    )


def _income_by_country(
    dividends: list[_Dividend], interests: list[_Interest]
) -> list[CountryIncome]:
    rows: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    for dividend in dividends:
        row = rows[dividend.country]
        row["dividends_gross"] += dividend.gross
        row["withholding_tax"] += dividend.withholding or ZERO
        row["tax_credit"] += dividend.tax_credit
    for interest in interests:
        rows[interest.country]["interest"] += interest.transaction.total
    return [
        CountryIncome(
            country=country,
            dividends_gross=_money(values["dividends_gross"]),
            interest=_money(values["interest"]),
            withholding_tax=_money(values["withholding_tax"]),
            tax_credit=_money(values["tax_credit"]),
        )
        for country, values in sorted(rows.items())
    ]


def _foreign_account(transactions: list[Transaction]) -> ForeignAccount:
    currencies = sorted({t.original_currency or t.total_currency for t in transactions} - {""})
    return ForeignAccount(
        entity=BROKER_ENTITY,
        entity_country=BROKER_COUNTRY_LABEL,
        regulator=BROKER_REGULATOR,
        account_type="Compte-titres / compte d'investissement (Invest)",
        account_currencies=currencies,
        first_activity=transactions[0].at.date() if transactions else None,
        last_activity=transactions[-1].at.date() if transactions else None,
    )


def _source_summary(transactions: list[Transaction], source_names: list[str]) -> SourceSummary:
    return SourceSummary(
        files=source_names,
        transactions=len(transactions),
        period_start=transactions[0].at.date() if transactions else None,
        period_end=transactions[-1].at.date() if transactions else None,
    )


# --- Line mapping and helpers --------------------------------------------------------------


def _disposal_line(disposal: _Disposal) -> DisposalLine:
    transaction = disposal.transaction
    return DisposalLine(
        date=transaction.at,
        isin=transaction.isin,
        ticker=transaction.ticker,
        name=transaction.name,
        quantity=float(transaction.quantity),
        proceeds=_money(disposal.proceeds),
        acquisition_cost=_money(disposal.cost),
        average_cost_per_share=float(disposal.average_cost.quantize(Decimal("0.0001"))),
        gain=_money(disposal.gain),
        fees=_money(transaction.fees),
        broker_result=_money(transaction.broker_result)
        if transaction.broker_result is not None
        else None,
        missing_quantity=float(disposal.missing_quantity),
    )


def _dividend_line(dividend: _Dividend) -> DividendLine:
    transaction = dividend.transaction
    return DividendLine(
        date=transaction.at,
        isin=transaction.isin,
        ticker=transaction.ticker,
        name=transaction.name,
        instrument_key=transaction.instrument_key,
        country=dividend.country,
        box=dividend.box,
        box_overridden=dividend.box_overridden,
        net=_money(transaction.total),
        withholding_tax=_money(dividend.withholding) if dividend.withholding is not None else None,
        withholding_original=float(transaction.withholding_tax)
        if transaction.withholding_tax
        else None,
        withholding_original_currency=transaction.withholding_currency,
        gross=_money(dividend.gross),
        tax_credit=_money(dividend.tax_credit),
        action=transaction.action,
    )


def _interest_line(interest: _Interest) -> InterestLine:
    return InterestLine(
        date=interest.transaction.at,
        label=interest.label,
        country=interest.country,
        amount=_money(interest.transaction.total),
    )


def _in_year(
    transactions: list[Transaction], year: int, kind: TransactionKind
) -> Iterable[Transaction]:
    return (t for t in transactions if t.kind == kind and t.at.year == year)


def _sum(values: Iterable[Decimal]) -> Decimal:
    return sum(values, ZERO)


def _money(value: Decimal) -> float:
    return float(value.quantize(CENT, rounding=ROUND_HALF_UP))
