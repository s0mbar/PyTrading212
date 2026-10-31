"""French tax helper endpoints (IFU reconstruction)."""

from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from ..config import settings
from ..errors import trading212_http_error
from ..security import require_access_token
from ..services.trading212 import Trading212Client, Trading212Error
from ..tax.csv_import import CsvFormatError, ParsedHistory, merge_histories, parse_trading212_csv
from ..tax.exports import ReportNotReadyError, export_service
from ..tax.fx import convert_history_to_eur
from ..tax.report import TaxOptions, build_tax_report
from ..tax.schemas import ExportRequest, TaxReportRequest, TaxReportResponse

router = APIRouter(prefix="/api/tax", tags=["tax"], dependencies=[Depends(require_access_token)])


class ExportListResponse(BaseModel):
    reports: list[dict[str, Any]]
    cached: bool
    next_refresh_seconds: int


class ExportCreatedResponse(BaseModel):
    report_id: int


class AccountInfoResponse(BaseModel):
    account_id: int | None
    currency: str | None
    environment: str


@router.post("/report", response_model=TaxReportResponse)
async def compute_tax_report(request: TaxReportRequest) -> TaxReportResponse:
    sources = [(item.name, item.content) for item in request.csv_files]
    if request.report_ids:
        try:
            sources += await export_service.download(request.report_ids)
        except ReportNotReadyError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except Trading212Error as exc:
            raise trading212_http_error(exc) from exc

    try:
        history = await run_in_threadpool(_parse_sources, sources)
    except CsvFormatError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    history = await convert_history_to_eur(history)

    options = TaxOptions(
        year=request.year,
        prior_capital_losses=Decimal(str(request.prior_capital_losses)),
        default_treaty_rate=Decimal(str(request.default_treaty_rate)),
        category_overrides=request.category_overrides,
    )
    return await run_in_threadpool(
        build_tax_report, history, options, source_names=[name for name, _ in sources]
    )


def _parse_sources(sources: list[tuple[str, str]]) -> ParsedHistory:
    return merge_histories(parse_trading212_csv(content, source=name) for name, content in sources)


@router.get("/exports", response_model=ExportListResponse)
async def list_exports() -> ExportListResponse:
    try:
        reports, cached = await export_service.list_reports()
    except Trading212Error as exc:
        raise trading212_http_error(exc) from exc
    return ExportListResponse(
        reports=reports, cached=cached, next_refresh_seconds=export_service.seconds_until_refresh()
    )


@router.post("/exports", response_model=ExportCreatedResponse)
async def request_export(request: ExportRequest) -> ExportCreatedResponse:
    try:
        return ExportCreatedResponse(report_id=await export_service.request(request.year))
    except Trading212Error as exc:
        raise trading212_http_error(exc) from exc


@router.get("/account", response_model=AccountInfoResponse)
async def account_info() -> AccountInfoResponse:
    """Account number and currency, needed for the foreign account declaration (3916)."""
    try:
        async with Trading212Client() as client:
            summary = await client.fetch_account_summary()
    except Trading212Error as exc:
        raise trading212_http_error(exc) from exc
    account_id = summary.get("id")
    return AccountInfoResponse(
        account_id=account_id if isinstance(account_id, int) else None,
        currency=summary.get("currency"),
        environment=settings.environment_label,
    )
