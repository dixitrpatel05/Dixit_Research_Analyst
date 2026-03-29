from __future__ import annotations

import io
from datetime import datetime
from html import escape
from typing import Any

try:
  from weasyprint import HTML
except Exception:
  HTML = None

try:
  from reportlab.lib.pagesizes import A4
  from reportlab.lib.utils import simpleSplit
  from reportlab.pdfgen import canvas
except Exception:
  A4 = None
  canvas = None
  simpleSplit = None


def _inr(value: Any) -> str:
    try:
        if value is None:
            return "NA"
        number = float(value)
        is_neg = number < 0
        number = abs(number)
        integer_part, dot, frac = f"{number:.2f}".partition(".")

        if len(integer_part) > 3:
            head = integer_part[:-3]
            tail = integer_part[-3:]
            parts = []
            while len(head) > 2:
                parts.insert(0, head[-2:])
                head = head[:-2]
            if head:
                parts.insert(0, head)
            integer_part = ",".join(parts + [tail])

        sign = "-" if is_neg else ""
        return f"{sign}INR {integer_part}.{frac}"
    except Exception:
        return "NA"


def _num(value: Any, digits: int = 2) -> str:
    try:
        if value is None:
            return "NA"
        return f"{float(value):,.{digits}f}"
    except Exception:
        return "NA"


def _pct(value: Any) -> str:
    try:
        if value is None:
            return "NA"
        v = float(value)
        sign = "+" if v > 0 else ""
        return f"{sign}{v:.2f}%"
    except Exception:
        return "NA"


def _rating_color(rating: str) -> str:
    key = (rating or "").upper()
    if key in {"BUY", "STRONG_BUY"}:
        return "#10B981"
    if key in {"SELL", "STRONG_SELL"}:
        return "#EF4444"
    return "#6B7280"


def _risk_color(severity: str) -> str:
    key = (severity or "").upper()
    if key == "HIGH":
        return "#FEE2E2"
    if key == "MEDIUM":
        return "#FFEDD5"
    return "#FEF9C3"


def _bar(value: float | None, max_value: float) -> float:
    if value is None or max_value <= 0:
        return 0
    return max(0, min(100, (value / max_value) * 100.0))


def _latest_announcements(report: dict, limit: int = 10) -> list[dict]:
    anns = (report.get("inputs") or {}).get("announcements") or []
    if not isinstance(anns, list):
        return []
    return [a for a in anns if isinstance(a, dict)][:limit]


def _latest_deals(report: dict, limit: int = 8) -> list[dict]:
    deals = (report.get("inputs") or {}).get("bulk_deals") or []
    if not isinstance(deals, list):
        return []
    return [d for d in deals if isinstance(d, dict)][:limit]


def _insider(report: dict, limit: int = 5) -> list[dict]:
    insider = (report.get("inputs") or {}).get("insider_trades") or []
    if not isinstance(insider, list):
        return []
    return [d for d in insider if isinstance(d, dict)][:limit]


def _peer_rows(report: dict) -> list[dict]:
    peers = (report.get("inputs") or {}).get("peers") or []
    if not isinstance(peers, list):
        return []
    return [p for p in peers if isinstance(p, dict)][:3]


def generate_report_html(report: dict) -> str:
    symbol = str(report.get("symbol") or "UNKNOWN")
    company_name = str(report.get("company_name") or symbol)
    sector = str(report.get("sector") or "NA")

    fundamentals = report.get("fundamentals") or {}
    catalyst = report.get("catalyst_analysis") or {}
    fundamental_analysis = report.get("fundamental_analysis") or {}
    sector_risk = report.get("sector_risk_analysis") or {}

    cmp_value = fundamentals.get("cmp")
    target_price = fundamental_analysis.get("target_price")
    upside = fundamental_analysis.get("upside_pct")
    rating = str(fundamental_analysis.get("rating") or "HOLD").upper()
    market_cap = fundamentals.get("market_cap")

    conf = catalyst.get("confidence_score")
    catalyst_headline = str(catalyst.get("catalyst_headline") or "No clear catalyst identified")
    catalyst_type = str(catalyst.get("catalyst_type") or "OTHER")
    catalyst_detail = str(catalyst.get("catalyst_detail") or "Insufficient data to produce a catalyst deep dive.")
    catalyst_evidence = catalyst.get("supporting_evidence") or []
    if not isinstance(catalyst_evidence, list):
        catalyst_evidence = []

    impact_timeline = str(catalyst.get("impact_timeline") or "IMMEDIATE")

    sector_tailwinds = sector_risk.get("sector_tailwinds") or []
    if not isinstance(sector_tailwinds, list):
        sector_tailwinds = []
    government_schemes = sector_risk.get("government_schemes") or []
    if not isinstance(government_schemes, list):
        government_schemes = []

    top_risks = sector_risk.get("top_risks") or []
    if not isinstance(top_risks, list):
        top_risks = []

    revenue = fundamentals.get("revenue_ttm")
    pat = fundamentals.get("pat_ttm")

    ann_rows = _latest_announcements(report)
    deals = _latest_deals(report)
    insider = _insider(report)
    peers = _peer_rows(report)

    rev_values = [revenue * 0.72 if revenue else None, revenue * 0.86 if revenue else None, revenue]
    pat_values = [pat * 0.70 if pat else None, pat * 0.83 if pat else None, pat]
    max_chart_value = max([v for v in rev_values + pat_values if isinstance(v, (int, float))] + [1])

    rev_bars = [
        f'<rect x="{20 + (i * 65)}" y="{150 - (_bar(v, max_chart_value) * 1.3):.1f}" width="38" height="{(_bar(v, max_chart_value) * 1.3):.1f}" fill="#3B82F6" />'
        for i, v in enumerate(rev_values)
    ]
    pat_bars = [
        f'<rect x="{45 + (i * 65)}" y="{150 - (_bar(v, max_chart_value) * 1.3):.1f}" width="24" height="{(_bar(v, max_chart_value) * 1.3):.1f}" fill="#10B981" />'
        for i, v in enumerate(pat_values)
    ]

    rating_color = _rating_color(rating)
    conf_num = float(conf) if isinstance(conf, (int, float)) else 0.0

    timeline_marks = {
        "IMMEDIATE": 25,
        "3_MONTHS": 50,
        "6_MONTHS": 75,
        "12_MONTHS": 100,
    }
    timeline_width = timeline_marks.get(impact_timeline, 25)

    today = datetime.utcnow().strftime("%d-%b-%Y")

    html = f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset=\"utf-8\" />
  <style>
    @page {{ size: A4; margin: 16mm; }}
    body {{ font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 11px; margin: 0; }}
    .page {{ page-break-after: always; min-height: 270mm; }}
    .page:last-child {{ page-break-after: auto; }}

    .header {{ background: #1a3a5c; color: #ffffff; padding: 18px 20px; position: relative; }}
    .header h1 {{ margin: 0; font-size: 28px; font-weight: 700; letter-spacing: 0.2px; }}
    .header .sub {{ margin-top: 4px; font-size: 12px; opacity: 0.92; }}
    .coverage {{ position: absolute; top: 18px; right: 20px; font-size: 10px; font-weight: 700; background: #0f2740; border: 1px solid rgba(255,255,255,0.3); padding: 6px 9px; }}

    .metrics {{ display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 12px 0 10px; }}
    .metric {{ border: 1px solid #d1d5db; border-radius: 6px; padding: 8px; }}
    .metric .k {{ color: #6b7280; font-size: 9px; text-transform: uppercase; }}
    .metric .v {{ margin-top: 3px; font-size: 14px; font-weight: 700; }}

    .rating-box {{ border-radius: 6px; color: #fff; padding: 9px; font-weight: 700; text-align: center; background: {rating_color}; }}
    .summary {{ margin-top: 8px; line-height: 1.55; }}
    .footer {{ margin-top: 12px; font-size: 9px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 6px; }}

    .title {{ color: #1e3a8a; margin: 0 0 10px; font-size: 22px; }}
    .badge {{ display: inline-block; border-radius: 999px; border: 1px solid #bfdbfe; background: #eff6ff; color: #1d4ed8; font-size: 9px; font-weight: 700; padding: 4px 9px; margin-right: 8px; }}
    .bar-bg {{ height: 12px; border-radius: 6px; background: #e5e7eb; overflow: hidden; }}
    .bar-fg {{ height: 12px; background: #3b82f6; }}

    .cols-2 {{ columns: 2; column-gap: 20px; line-height: 1.6; margin-top: 8px; }}
    .box {{ border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; margin-top: 10px; }}

    .impact-track {{ margin-top: 12px; position: relative; height: 26px; border: 1px solid #e5e7eb; border-radius: 20px; }}
    .impact-fill {{ position: absolute; left: 0; top: 0; bottom: 0; width: {timeline_width}%; background: linear-gradient(90deg, #3b82f6, #1d4ed8); border-radius: 20px; }}
    .impact-label {{ position: absolute; left: 8px; top: 6px; color: #ffffff; font-size: 9px; font-weight: 700; letter-spacing: 0.4px; }}

    .grid-2x4 {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin-top: 12px; }}
    .ratio {{ border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px; }}
    .ratio .k {{ font-size: 9px; color: #6b7280; }}
    .ratio .v {{ font-size: 13px; margin-top: 3px; font-weight: 700; }}

    table {{ width: 100%; border-collapse: collapse; margin-top: 8px; }}
    th, td {{ border: 1px solid #e5e7eb; padding: 6px; font-size: 10px; vertical-align: top; }}
    th {{ background: #f9fafb; text-align: left; }}

    .flag {{ background: #fff7ed; }}
    .risk {{ border-radius: 8px; border: 1px solid #f3f4f6; padding: 10px; margin-bottom: 8px; }}

    .pill {{ display: inline-block; border-radius: 999px; padding: 4px 9px; font-size: 9px; border: 1px solid #d1d5db; background: #f9fafb; }}

    .kpi {{ margin-top: 10px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }}
    .kpi .item {{ border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; }}

    .final-rating {{ margin-top: 10px; border: 2px solid {rating_color}; color: {rating_color}; border-radius: 10px; font-size: 30px; font-weight: 800; text-align: center; padding: 18px 10px; }}
    .disclaimer {{ margin-top: 18px; color: #9ca3af; font-size: 8px; line-height: 1.45; }}
  </style>
</head>
<body>

  <section class=\"page\">
    <div class=\"header\">
      <div class=\"coverage\">INITIATING COVERAGE</div>
      <h1>{escape(company_name)} ({escape(symbol)})</h1>
      <div class=\"sub\">Equity Research Report | Sector: {escape(sector)} | Date: {escape(today)}</div>
    </div>

    <div class=\"metrics\">
      <div class=\"metric\"><div class=\"k\">CMP</div><div class=\"v\">{_inr(cmp_value)}</div></div>
      <div class=\"metric\"><div class=\"k\">Target</div><div class=\"v\">{_inr(target_price)}</div></div>
      <div class=\"metric\"><div class=\"k\">Upside</div><div class=\"v\">{_pct(upside)}</div></div>
      <div class=\"metric\"><div class=\"k\">Rating</div><div class=\"rating-box\">{escape(rating)}</div></div>
      <div class=\"metric\"><div class=\"k\">Market Cap</div><div class=\"v\">{_num(market_cap, 0)}</div></div>
    </div>

    <div class=\"summary\">
      {escape(str(fundamental_analysis.get("rating_rationale") or "Coverage initiated with a balanced risk-reward view based on catalyst visibility, earnings durability, and relative valuation against listed peers."))}
    </div>

    <div class=\"footer\">AlphaDesk Research | Powered by Public Data</div>
  </section>

  <section class=\"page\">
    <h2 class=\"title\">Catalyst Deep Dive</h2>
    <div style=\"font-size:20px;font-weight:700;color:#1d4ed8;\">{escape(catalyst_headline)}</div>
    <div style=\"margin-top:8px;\">
      <span class=\"badge\">{escape(catalyst_type)}</span>
      <span class=\"pill\">Confidence: {_num(conf_num, 0)}%</span>
    </div>

    <div style=\"margin-top:10px;\" class=\"bar-bg\"><div class=\"bar-fg\" style=\"width:{max(0, min(100, conf_num))}%;\"></div></div>

    <div class=\"cols-2\">{escape(catalyst_detail)}</div>

    <div class=\"box\">
      <div style=\"font-weight:700;margin-bottom:6px;\">Supporting Evidence</div>
      <ul style=\"margin:0;padding-left:16px;\">
        {''.join(f'<li style="margin-bottom:5px;">{escape(str(item))}</li>' for item in catalyst_evidence[:3])}
      </ul>
    </div>

    <div class=\"impact-track\">
      <div class=\"impact-fill\"></div>
      <div class=\"impact-label\">Impact Timeline: {escape(impact_timeline)}</div>
    </div>
  </section>

  <section class=\"page\">
    <h2 class=\"title\">Financial Snapshot</h2>

    <div class=\"box\">
      <div style=\"font-weight:700;margin-bottom:6px;\">3Y Revenue and PAT Trend (Illustrative)</div>
      <svg width=\"260\" height=\"180\" viewBox=\"0 0 260 180\" xmlns=\"http://www.w3.org/2000/svg\">
        <line x1=\"10\" y1=\"150\" x2=\"250\" y2=\"150\" stroke=\"#cbd5e1\" stroke-width=\"1\" />
        {''.join(rev_bars)}
        {''.join(pat_bars)}
        <text x=\"18\" y=\"168\" font-size=\"9\">FY-2</text>
        <text x=\"83\" y=\"168\" font-size=\"9\">FY-1</text>
        <text x=\"148\" y=\"168\" font-size=\"9\">TTM</text>
      </svg>
    </div>

    <div class=\"grid-2x4\">
      <div class=\"ratio\"><div class=\"k\">PE</div><div class=\"v\">{_num(fundamentals.get("pe_ratio"), 2)}</div></div>
      <div class=\"ratio\"><div class=\"k\">Sector PE</div><div class=\"v\">{_num(sum([p.get("pe", 0) for p in peers if isinstance(p.get("pe"), (int, float))]) / max(1, len([p for p in peers if isinstance(p.get("pe"), (int, float))])), 2)}</div></div>
      <div class=\"ratio\"><div class=\"k\">ROE</div><div class=\"v\">{_pct(fundamentals.get("roe"))}</div></div>
      <div class=\"ratio\"><div class=\"k\">ROCE</div><div class=\"v\">{_pct(fundamentals.get("roce"))}</div></div>
      <div class=\"ratio\"><div class=\"k\">D/E</div><div class=\"v\">{_num(fundamentals.get("debt_equity"), 2)}</div></div>
      <div class=\"ratio\"><div class=\"k\">Revenue Growth</div><div class=\"v\">{_pct(fundamentals.get("revenue_growth_yoy"))}</div></div>
      <div class=\"ratio\"><div class=\"k\">PAT Growth</div><div class=\"v\">{_pct(fundamental_analysis.get("profitability_trend_pct"))}</div></div>
      <div class=\"ratio\"><div class=\"k\">EV/EBITDA</div><div class=\"v\">{_num(fundamentals.get("ev_ebitda"), 2)}</div></div>
    </div>

    <table>
      <thead>
        <tr><th>Quarter</th><th>Promoter%</th><th>FII%</th><th>DII%</th><th>Public%</th></tr>
      </thead>
      <tbody>
        <tr><td>Q4</td><td>{_pct(fundamentals.get("promoter_holding"))}</td><td>{_pct(fundamentals.get("fii_holding"))}</td><td>{_pct(fundamentals.get("dii_holding"))}</td><td>{_pct(fundamentals.get("public_holding"))}</td></tr>
        <tr><td>Q3</td><td>{_pct(fundamentals.get("promoter_holding_prev1"))}</td><td>{_pct(fundamentals.get("fii_holding_prev1"))}</td><td>{_pct(fundamentals.get("dii_holding_prev1"))}</td><td>{_pct(fundamentals.get("public_holding_prev1"))}</td></tr>
        <tr><td>Q2</td><td>{_pct(fundamentals.get("promoter_holding_prev2"))}</td><td>{_pct(fundamentals.get("fii_holding_prev2"))}</td><td>{_pct(fundamentals.get("dii_holding_prev2"))}</td><td>{_pct(fundamentals.get("public_holding_prev2"))}</td></tr>
        <tr><td>Q1</td><td>{_pct(fundamentals.get("promoter_holding_prev3"))}</td><td>{_pct(fundamentals.get("fii_holding_prev3"))}</td><td>{_pct(fundamentals.get("dii_holding_prev3"))}</td><td>{_pct(fundamentals.get("public_holding_prev3"))}</td></tr>
      </tbody>
    </table>
  </section>

  <section class=\"page\">
    <h2 class=\"title\">NSE/BSE Filings</h2>

    <table>
      <thead>
        <tr><th style=\"width:16%;\">Date</th><th style=\"width:18%;\">Filing Type</th><th>Summary</th></tr>
      </thead>
      <tbody>
        {''.join(
            f'<tr class="{"flag" if str(r.get("type", "")).upper() in {"INSIDER_TRADE", "QIP"} else ""}"><td>{escape(str(r.get("date") or "NA"))}</td><td>{escape(str(r.get("type") or "NA"))}</td><td>{escape(str(r.get("headline") or "NA"))}</td></tr>'
            for r in ann_rows
        )}
      </tbody>
    </table>

    <div class=\"box\">
      <div style=\"font-weight:700;\">Insider Trading</div>
      <table>
        <thead><tr><th>Date</th><th>Person</th><th>Type</th><th>Qty</th><th>Value (Lakh)</th></tr></thead>
        <tbody>
          {''.join(
              f'<tr><td>{escape(str(i.get("date") or "NA"))}</td><td>{escape(str(i.get("person_name") or "NA"))}</td><td>{escape(str(i.get("transaction_type") or "NA"))}</td><td>{escape(str(i.get("quantity") or "NA"))}</td><td>{escape(_num(i.get("value_lakh"), 2))}</td></tr>'
              for i in insider
          )}
        </tbody>
      </table>
    </div>

    <div class=\"box\">
      <div style=\"font-weight:700;\">Bulk/Block Deals</div>
      <table>
        <thead><tr><th>Date</th><th>Client</th><th>Type</th><th>Qty</th><th>Price</th><th>Value (Cr)</th></tr></thead>
        <tbody>
          {''.join(
              f'<tr><td>{escape(str(d.get("date") or "NA"))}</td><td>{escape(str(d.get("client_name") or "NA"))}</td><td>{escape(str(d.get("deal_type") or "NA"))}</td><td>{escape(str(d.get("quantity") or "NA"))}</td><td>{escape(_num(d.get("price"), 2))}</td><td>{escape(_num(d.get("value_cr"), 2))}</td></tr>'
              for d in deals
          )}
        </tbody>
      </table>
    </div>
  </section>

  <section class=\"page\">
    <h2 class=\"title\">Sector and Technical</h2>
    <div>
      <span class=\"pill\">Sector Outlook: {escape(str(sector_risk.get("sector_outlook") or "NEUTRAL"))}</span>
      <span class=\"pill\">Cycle Stage: {escape(str(sector_risk.get("sector_cycle_stage") or "MID_UPCYCLE"))}</span>
    </div>

    <div class=\"box\">
      <div style=\"font-weight:700; margin-bottom:6px;\">Sector Tailwinds</div>
      <ul style=\"margin:0;padding-left:16px;\">
        {''.join(f'<li style="margin-bottom:5px;">{escape(str(t))}</li>' for t in sector_tailwinds[:3])}
      </ul>
    </div>

    <div class=\"box\">
      <div style=\"font-weight:700; margin-bottom:6px;\">Government Schemes</div>
      <div>{escape('; '.join(str(s) for s in government_schemes[:6]) or 'No specific scheme mapped')}</div>
    </div>

    <div class=\"box\">
      <div style=\"font-weight:700; margin-bottom:6px;\">Global Cues</div>
      <div>{escape(str(sector_risk.get("global_cues") or "Global commodity cycles, US rates, and FX trends remain key monitorables for the sector."))}</div>
    </div>

    <div class=\"kpi\">
      <div class=\"item\"><div class=\"k\">52W Range</div><div class=\"v\">{_inr(fundamentals.get("52w_low"))} to {_inr(fundamentals.get("52w_high"))}</div></div>
      <div class=\"item\"><div class=\"k\">DMA Status</div><div class=\"v\">vs 50DMA {_pct(fundamentals.get("price_vs_50dma"))} | vs 200DMA {_pct(fundamentals.get("price_vs_200dma"))}</div></div>
      <div class=\"item\"><div class=\"k\">Volume</div><div class=\"v\">Current {_num(fundamentals.get("current_volume"), 0)} / Avg20D {_num(fundamentals.get("avg_volume_20d"), 0)}</div></div>
    </div>

    <table>
      <thead><tr><th>Peer</th><th>Symbol</th><th>PE</th><th>ROE</th><th>Revenue Growth</th></tr></thead>
      <tbody>
        {''.join(
            f'<tr><td>{escape(str(p.get("name") or "NA"))}</td><td>{escape(str(p.get("symbol") or "NA"))}</td><td>{escape(_num(p.get("pe"), 2))}</td><td>{escape(_pct(p.get("roe")))}</td><td>{escape(_pct(p.get("revenue_growth")))}</td></tr>'
            for p in peers
        )}
      </tbody>
    </table>
  </section>

  <section class=\"page\">
    <h2 class=\"title\">Valuation and Risks</h2>

    <div class=\"box\">
      <div style=\"font-weight:700;margin-bottom:6px;\">Valuation Methodology</div>
      <div>
        Target price is derived from relative valuation versus sector peers and adjusted for expected earnings visibility, balance sheet risk,
        and catalyst durability over a 12-month horizon.
      </div>
    </div>

    <table>
      <thead><tr><th>Metric</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td>CMP</td><td>{_inr(cmp_value)}</td></tr>
        <tr><td>Target Price (12M)</td><td>{_inr(target_price)}</td></tr>
        <tr><td>Implied Upside</td><td>{_pct(upside)}</td></tr>
        <tr><td>Valuation vs Peers</td><td>{escape(str(fundamental_analysis.get("valuation_vs_peers") or "FAIR"))}</td></tr>
      </tbody>
    </table>

    <div style=\"margin-top:10px;\">
      {''.join(
          f'<div class="risk" style="background:{_risk_color(str(r.get("severity") or "LOW"))};"><div style="font-weight:700;">{escape(str(r.get("risk_title") or "Key Risk"))} ({escape(str(r.get("severity") or "LOW"))})</div><div style="margin-top:4px;">{escape(str(r.get("risk_detail") or "Risk details unavailable"))}</div></div>'
          for r in top_risks[:3]
      )}
    </div>

    <div class=\"final-rating\">{escape(rating)}</div>
    <div style=\"text-align:center; margin-top:8px;\">{escape(str(fundamental_analysis.get("rating_rationale") or "Recommendation reflects blended view on growth, valuation, and risk-adjusted return potential."))}</div>

    <div class=\"disclaimer\">
      Disclaimer: This report is generated by AlphaDesk using publicly available information and model-assisted analysis.
      It is for educational and informational purposes only and does not constitute investment advice, solicitation,
      or an offer to buy or sell securities. Data may contain delays or inaccuracies.
    </div>
  </section>

</body>
</html>
"""
    return html


def generate_pdf_bytes(report: dict) -> bytes:
  if HTML is not None:
    html = generate_report_html(report)
    return HTML(string=html).write_pdf()

  if canvas is None or A4 is None or simpleSplit is None:
    raise RuntimeError("PDF engine unavailable: install WeasyPrint dependencies or include reportlab fallback.")

  # Rich fallback PDF renderer for environments missing WeasyPrint system libs.
  buffer = io.BytesIO()
  c = canvas.Canvas(buffer, pagesize=A4)
  width, height = A4
  y = height - 46

  def ensure_space(min_space: int = 60) -> None:
    nonlocal y
    if y < min_space:
      c.showPage()
      y = height - 46

  def write_line(text: str, size: int = 10, gap: int = 14, x: int = 40) -> None:
    nonlocal y
    ensure_space(70)
    c.setFont("Helvetica", size)
    c.drawString(x, y, text[:190])
    y -= gap

  def write_wrapped(text: str, size: int = 10, gap: int = 13, x: int = 40, max_width: int | None = None) -> None:
    nonlocal y
    if max_width is None:
      max_width = int(width - 80)
    lines = simpleSplit(str(text or ""), "Helvetica", size, max_width)
    if not lines:
      write_line("NA", size=size, gap=gap, x=x)
      return
    for line in lines:
      write_line(line, size=size, gap=gap, x=x)

  def section(title: str) -> None:
    nonlocal y
    ensure_space(90)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(40, y, title)
    y -= 10
    c.setLineWidth(0.7)
    c.line(40, y, width - 40, y)
    y -= 14

  def kv_row(left: str, right: str) -> None:
    nonlocal y
    ensure_space(80)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(40, y, left)
    c.setFont("Helvetica", 9)
    write_wrapped(right, size=9, gap=11, x=170, max_width=int(width - 210))

  def table(headers: list[str], rows: list[list[str]]) -> None:
    nonlocal y
    if not headers:
      return
    col_count = len(headers)
    left = 40
    right = width - 40
    col_w = (right - left) / col_count

    ensure_space(90)
    c.setFont("Helvetica-Bold", 8)
    for i, h in enumerate(headers):
      c.drawString(left + i * col_w + 2, y, str(h)[:28])
    y -= 10
    c.setLineWidth(0.5)
    c.line(left, y, right, y)
    y -= 8

    c.setFont("Helvetica", 8)
    for row in rows:
      ensure_space(70)
      max_lines = 1
      wrapped_cells: list[list[str]] = []
      for i in range(col_count):
        txt = str(row[i] if i < len(row) else "")
        lines = simpleSplit(txt, "Helvetica", 8, col_w - 6)
        if not lines:
          lines = [""]
        wrapped_cells.append(lines)
        max_lines = max(max_lines, len(lines))

      for line_idx in range(max_lines):
        for i, lines in enumerate(wrapped_cells):
          line = lines[line_idx] if line_idx < len(lines) else ""
          c.drawString(left + i * col_w + 2, y, line[:36])
        y -= 10
      c.line(left, y + 4, right, y + 4)
      y -= 2

  symbol = str(report.get("symbol") or "UNKNOWN")
  company = str(report.get("company_name") or symbol)
  sector = str(report.get("sector") or "Unknown")
  fundamentals = report.get("fundamentals") or {}
  catalyst = report.get("catalyst_analysis") or {}
  fa = report.get("fundamental_analysis") or {}
  sr = report.get("sector_risk_analysis") or {}
  ann_rows = _latest_announcements(report, limit=12)
  deals = _latest_deals(report, limit=10)
  insider = _insider(report, limit=10)
  peers = _peer_rows(report)
  risks = sr.get("top_risks") if isinstance(sr.get("top_risks"), list) else []

  # Cover and summary section
  c.setFont("Helvetica-Bold", 22)
  c.drawString(40, y, "AlphaDesk Equity Research Report")
  y -= 26
  c.setFont("Helvetica", 10)
  c.drawString(40, y, f"Company: {company} ({symbol})")
  y -= 14
  c.drawString(40, y, f"Sector: {sector}")
  y -= 14
  c.drawString(40, y, f"Generated: {datetime.utcnow().strftime('%d-%b-%Y %H:%M UTC')}")
  y -= 20

  section("Executive Summary")
  write_wrapped(str(fa.get("rating_rationale") or "Research summary unavailable."), size=10, gap=13)
  y -= 4
  kv_row("Rating", str(fa.get("rating") or "HOLD"))
  kv_row("Confidence", f"{_num(catalyst.get('confidence_score'), 0)}%")
  kv_row("CMP", _inr(fundamentals.get("cmp")))
  kv_row("Target", _inr(fa.get("target_price")))
  kv_row("Upside", _pct(fa.get("upside_pct")))

  section("Catalyst Deep Dive")
  write_line(str(catalyst.get("catalyst_headline") or "No primary catalyst identified"), size=12, gap=16)
  write_wrapped(str(catalyst.get("catalyst_detail") or "No catalyst narrative available."), size=10, gap=13)
  evidence = catalyst.get("supporting_evidence") if isinstance(catalyst.get("supporting_evidence"), list) else []
  if evidence:
    write_line("Supporting Evidence", size=10, gap=13)
    for item in evidence[:5]:
      write_wrapped(f"- {item}", size=9, gap=11)

  section("Fundamental Analysis")
  kv_row("Business", str(fa.get("business_description") or "NA"))
  kv_row("Balance Sheet", str(fa.get("balance_sheet_health") or "NA"))
  kv_row("Valuation vs Peers", str(fa.get("valuation_vs_peers") or "NA"))
  kv_row("Fundamental Score", str(fa.get("fundamental_score") or "NA"))
  table(
    ["Metric", "Value", "Metric", "Value"],
    [
      ["PE", _num(fundamentals.get("pe_ratio"), 2), "ROE", _pct(fundamentals.get("roe"))],
      ["ROCE", _pct(fundamentals.get("roce")), "Debt/Equity", _num(fundamentals.get("debt_equity"), 2)],
      ["Revenue Growth", _pct(fundamentals.get("revenue_growth_yoy")), "Promoter", _pct(fundamentals.get("promoter_holding"))],
      ["FII", _pct(fundamentals.get("fii_holding")), "CMP", _inr(fundamentals.get("cmp"))],
    ],
  )

  section("NSE / BSE Filings")
  if ann_rows:
    table(
      ["Date", "Type", "Headline"],
      [[str(r.get("date") or "NA"), str(r.get("type") or "NA"), str(r.get("headline") or "NA")] for r in ann_rows[:10]],
    )
  else:
    write_line("No recent filing records available.", size=9, gap=12)

  section("Bulk / Block Deals")
  if deals:
    table(
      ["Date", "Client", "Type", "Value (Cr)"],
      [
        [
          str(d.get("date") or "NA"),
          str(d.get("client_name") or "NA"),
          str(d.get("deal_type") or "NA"),
          _num(d.get("value_cr"), 2),
        ]
        for d in deals[:10]
      ],
    )
  else:
    write_line("No bulk/block deal records available.", size=9, gap=12)

  section("Insider Trading")
  if insider:
    table(
      ["Date", "Person", "Action", "Value (Lakh)"],
      [
        [
          str(i.get("date") or "NA"),
          str(i.get("person_name") or "NA"),
          str(i.get("transaction_type") or "NA"),
          _num(i.get("value_lakh"), 2),
        ]
        for i in insider[:10]
      ],
    )
  else:
    write_line("No insider transaction records available.", size=9, gap=12)

  section("Sector and Risk Review")
  kv_row("Sector Outlook", str(sr.get("sector_outlook") or "NEUTRAL"))
  kv_row("Cycle Stage", str(sr.get("sector_cycle_stage") or "MID_UPCYCLE"))
  tailwinds = sr.get("sector_tailwinds") if isinstance(sr.get("sector_tailwinds"), list) else []
  if tailwinds:
    write_line("Sector Tailwinds", size=10, gap=12)
    for item in tailwinds[:4]:
      write_wrapped(f"- {item}", size=9, gap=11)
  if risks:
    write_line("Top Risks", size=10, gap=12)
    for r in risks[:4]:
      title = str(r.get("risk_title") or "Risk")
      sev = str(r.get("severity") or "LOW")
      write_wrapped(f"- {title} ({sev}): {str(r.get('risk_detail') or 'NA')}", size=9, gap=11)

  section("Peer Snapshot")
  if peers:
    table(
      ["Peer", "Symbol", "PE", "ROE", "Rev Growth"],
      [
        [
          str(p.get("name") or "NA"),
          str(p.get("symbol") or "NA"),
          _num(p.get("pe"), 2),
          _pct(p.get("roe")),
          _pct(p.get("revenue_growth")),
        ]
        for p in peers[:5]
      ],
    )
  else:
    write_line("Peer set unavailable.", size=9, gap=12)

  section("Final Recommendation")
  write_line(f"Final Rating: {str(fa.get('rating') or 'HOLD')}", size=12, gap=15)
  write_wrapped(str(fa.get("rating_rationale") or "Recommendation rationale unavailable."), size=10, gap=13)
  write_line("Disclaimer: For informational purposes only. Not investment advice.", size=8, gap=12)

  c.save()
  return buffer.getvalue()


def generate_pdf_file(report: dict, output_path: str) -> str:
  if HTML is not None:
    html = generate_report_html(report)
    HTML(string=html).write_pdf(target=output_path)
    return output_path

  pdf_bytes = generate_pdf_bytes(report)
  with open(output_path, "wb") as f:
    f.write(pdf_bytes)
  return output_path
