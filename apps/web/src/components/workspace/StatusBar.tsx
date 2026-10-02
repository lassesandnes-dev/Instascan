"use client";

import type { Vec3 } from "@massefelt/shared";
import { fmtCoord, fmtCount } from "@/lib/format";

interface Props {
  hover: Vec3 | null;
  crsLabel: string;
  datumLabel: string;
  units: string;
  visiblePoints: number;
  hint: string;
  message: string | null;
}

export function StatusBar({ hover, crsLabel, datumLabel, units, visiblePoints, hint, message }: Props) {
  return (
    <div className="flex h-7 items-center gap-4 border-t border-slate-800 bg-slate-950 px-3 font-mono text-[11px] text-slate-400" data-testid="status-bar">
      <span className="w-[26rem] truncate" data-testid="status-coords">
        {hover ? `X ${fmtCoord(hover.x)}  Y ${fmtCoord(hover.y)}  Z ${fmtCoord(hover.z)}` : "X —  Y —  Z —"}
      </span>
      <span title="Coordinate reference system">{crsLabel}</span>
      <span title="Vertical datum">{datumLabel}</span>
      <span>Units: {units}</span>
      <span>{fmtCount(visiblePoints)} pts</span>
      <span className="flex-1 truncate text-right font-sans text-slate-500">{message ?? hint}</span>
    </div>
  );
}
