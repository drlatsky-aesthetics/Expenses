"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

const PRESETS: [string, string][] = [
  ["month", "This month"],
  ["last-month", "Last month"],
  ["quarter", "This quarter"],
  ["last-quarter", "Last quarter"],
  ["year", "This year"],
  ["last-year", "Last year"],
  ["all", "All time"],
  ["custom", "Custom range"],
];

export default function PeriodPicker({ categories, tags }: { categories?: string[]; tags?: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const hasCustom = Boolean(params.get("from") && params.get("to"));
  const preset = hasCustom ? "custom" : params.get("preset") || "month";
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const category = params.get("category") ?? "";
  const tag = params.get("tag") ?? "";

  function apply(next: Record<string, string>) {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    router.push(`${pathname}?${q.toString()}`);
  }

  return (
    <div className="panel row">
      <span className="label">Period</span>
      <select
        className="select"
        style={{ width: "auto" }}
        value={preset}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "custom") return apply({ preset: "", from: from || "", to: to || "" });
          apply({ preset: v, from: "", to: "" });
        }}
      >
        {PRESETS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {preset === "custom" && (
        <>
          <input className="input" style={{ width: "auto" }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="muted small">to</span>
          <input className="input" style={{ width: "auto" }} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="btn sm" onClick={() => from && to && apply({ preset: "", from, to })}>
            Apply
          </button>
        </>
      )}
      {categories && (
        <>
          <span className="label" style={{ marginLeft: "auto" }}>
            Category
          </span>
          <select className="select" style={{ width: "auto" }} value={category} onChange={(e) => apply({ category: e.target.value })}>
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </>
      )}
      {tags && tags.length > 0 && (
        <>
          <span className="label">Tag</span>
          <select className="select" style={{ width: "auto" }} value={tag} onChange={(e) => apply({ tag: e.target.value })}>
            <option value="">All</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}
