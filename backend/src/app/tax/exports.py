"""Trading 212 CSV reports requested through the API (asynchronous, strongly rate-limited)."""

from collections import OrderedDict
from datetime import UTC, datetime
from time import monotonic
from typing import Any

from ..services.trading212 import Trading212Client, Trading212Error

# GET /history/exports allows 1 request per minute.
LIST_MIN_INTERVAL_SECONDS = 61.0
MAX_CACHED_REPORTS = 20


class ReportNotReadyError(Exception):
    """A requested report is unknown, still generating or failed."""


class ExportService:
    def __init__(self) -> None:
        self._reports: list[dict[str, Any]] = []
        self._listed_at: float | None = None
        self._contents: OrderedDict[int, str] = OrderedDict()

    def seconds_until_refresh(self) -> int:
        if self._listed_at is None:
            return 0
        return max(0, int(LIST_MIN_INTERVAL_SECONDS - (monotonic() - self._listed_at)) + 1)

    async def request(self, year: int) -> int:
        time_from = datetime(year, 1, 1, tzinfo=UTC)
        time_to = min(datetime(year + 1, 1, 1, tzinfo=UTC), datetime.now(UTC))
        async with Trading212Client() as client:
            payload = await client.request_history_export(time_from=time_from, time_to=time_to)
        report_id = payload.get("reportId")
        if not isinstance(report_id, int):
            raise Trading212Error("Trading 212 did not return a report id")
        return report_id

    async def list_reports(self) -> tuple[list[dict[str, Any]], bool]:
        """Return (reports, served_from_cache)."""
        if self.seconds_until_refresh() > 0:
            return self._reports, True
        async with Trading212Client() as client:
            reports = await client.list_history_exports()
        self._reports = sorted(reports, key=lambda item: item.get("reportId", 0), reverse=True)
        self._listed_at = monotonic()
        return self._reports, False

    async def download(self, report_ids: list[int]) -> list[tuple[str, str]]:
        """Return (source name, CSV content) for each finished report."""
        missing = [report_id for report_id in report_ids if report_id not in self._contents]
        if missing:
            links = await self._download_links(missing)
            async with Trading212Client() as client:
                for report_id in missing:
                    self._remember(report_id, await client.download_export(links[report_id]))
        return [
            (f"Rapport Trading 212 n°{report_id}", self._contents[report_id])
            for report_id in report_ids
        ]

    async def _download_links(self, report_ids: list[int]) -> dict[int, str]:
        reports, _ = await self.list_reports()
        by_id = {item.get("reportId"): item for item in reports}
        links: dict[int, str] = {}
        for report_id in report_ids:
            report = by_id.get(report_id)
            if (
                report is None
                or report.get("status") != "Finished"
                or not report.get("downloadLink")
            ):
                status = report.get("status") if report else "inconnu"
                raise ReportNotReadyError(
                    f"Rapport n°{report_id} non disponible (statut : {status}). "
                    f"Réessayez dans {self.seconds_until_refresh()} s."
                )
            links[report_id] = str(report["downloadLink"])
        return links

    def _remember(self, report_id: int, content: str) -> None:
        self._contents[report_id] = content
        while len(self._contents) > MAX_CACHED_REPORTS:
            self._contents.popitem(last=False)


export_service = ExportService()
