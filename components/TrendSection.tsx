import { CategorySmallMultiples, CumulativeLines, MonthlyBars, YearBars } from "@/components/TrendCharts";
import { fmtMoney } from "@/lib/money";
import type { Summary } from "@/lib/reports";
import type { Trends } from "@/lib/trends";

function pct(change: number | null): string {
  if (change === null) return "no comparison";
  const v = Math.round(change * 100);
  return `${v > 0 ? "+" : ""}${v}%`;
}

/** Comparison chips and trend charts for the full report. */
export default function TrendSection({ summary: s, trends: t }: { summary: Summary; trends: Trends }) {
  const prev = t.comparisons.previous;
  const ly = t.comparisons.lastYear;
  const yc = t.yearCompare;
  return (
    <>
      <h2 className="section">Compared with</h2>
      <div className="chips">
        <div className="chip accent">
          <span className="label">This period</span>
          <span className="value">{fmtMoney(s.total)}</span>
          <span className="delta">{s.count} receipts</span>
        </div>
        <div className="chip">
          <span className="label">{prev.label}</span>
          <span className="value">{fmtMoney(prev.total)}</span>
          <span className={`delta${prev.change === null ? "" : prev.change >= 0 ? " up" : " down"}`}>{prev.change === null ? "nothing in that period" : `${pct(prev.change)} now vs then`}</span>
        </div>
        <div className="chip">
          <span className="label">{ly.label}</span>
          <span className="value">{fmtMoney(ly.total)}</span>
          <span className={`delta${ly.change === null ? "" : ly.change >= 0 ? " up" : " down"}`}>{ly.change === null ? "nothing in that period" : `${pct(ly.change)} now vs then`}</span>
        </div>
        <div className="chip">
          <span className="label">Average per month</span>
          <span className="value">{fmtMoney(t.averagePerMonth)}</span>
          <span className="delta">
            over {t.monthsInPeriod} month{t.monthsInPeriod === 1 ? "" : "s"} · {fmtMoney(t.averagePerMonth * 12)} a year at this pace
          </span>
        </div>
        {t.largestCategory && (
          <div className="chip">
            <span className="label">Largest category</span>
            <span className="value">{Math.round(t.largestCategory.share * 100)}%</span>
            <span className="delta">
              {t.largestCategory.category} · {fmtMoney(t.largestCategory.total)}
            </span>
          </div>
        )}
        <div className="chip">
          <span className="label">Sales tax recoverable</span>
          <span className="value">{fmtMoney(s.taxes.gst + s.taxes.hst)}</span>
          <span className="delta">GST + HST on Canadian receipts</span>
        </div>
      </div>

      <h2 className="section">Trends</h2>
      <div className="charts">
        <div className="chart-card">
          <h3>Monthly spend, last 12 months</h3>
          <div className="sub">
            CAD · selected period in full colour · {t.trailing[0].longLabel} to {t.trailing[11].longLabel}
          </div>
          <MonthlyBars points={t.trailing} />
        </div>
        <div className="chart-card">
          <h3>
            {yc.year} vs {yc.year - 1}, by month
          </h3>
          <div className="sub">CAD · filled = {yc.year}, outlined = {yc.year - 1}</div>
          <YearBars yc={yc} />
        </div>
        <div className="chart-card">
          <h3>Cumulative spend through the year</h3>
          <div className="sub">
            CAD · {yc.year} year to date against the full {yc.year - 1}
          </div>
          <CumulativeLines yc={yc} />
        </div>
        <div className="chart-card">
          <h3>Top categories, last 12 months</h3>
          <div className="sub">CAD · one panel per category, shared scale</div>
          {t.categories.length === 0 ? <p className="small muted">No expenses yet.</p> : <CategorySmallMultiples cats={t.categories} />}
        </div>
      </div>

      <h2 className="section">Month by month (table view)</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">{yc.year}</th>
              <th className="num">{yc.year - 1}</th>
              <th className="num hide-sm">Change</th>
              <th className="num hide-sm">{yc.year} cumulative</th>
            </tr>
          </thead>
          <tbody>
            {yc.current.map((v, i) => {
              const p = yc.previous[i];
              const elapsed = i < yc.monthsElapsed;
              return (
                <tr key={i} style={{ opacity: elapsed ? 1 : 0.55 }}>
                  <td>{["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][i]}</td>
                  <td className="num">{elapsed ? fmtMoney(v) : "—"}</td>
                  <td className="num">{fmtMoney(p)}</td>
                  <td className="num hide-sm muted">{elapsed && p > 0 ? pct((v - p) / p) : "—"}</td>
                  <td className="num hide-sm">{elapsed ? fmtMoney(yc.currentCumulative[i]) : "—"}</td>
                </tr>
              );
            })}
            <tr className="total">
              <td>Total</td>
              <td className="num">{fmtMoney(yc.currentCumulative[Math.max(0, yc.monthsElapsed - 1)] ?? 0)}</td>
              <td className="num">{fmtMoney(yc.previousCumulative[11])}</td>
              <td className="num hide-sm"></td>
              <td className="num hide-sm"></td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
