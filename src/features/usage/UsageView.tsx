import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowClockwise, Gauge, SlidersHorizontal, WarningCircle } from "@phosphor-icons/react";
import { content, spin, springs } from "../../design/motion";
import { formatAgo, formatIn } from "../../lib/format";
import { HeaderActions, HeaderButton } from "../../notch/header";
import { navigate } from "../../notch/nav";
import { fetchUsage, type UsageProvider, type UsageWindow } from "../../platform/services";
import { settings } from "../../settings/store";
import { Button, Empty, Skeleton } from "../../ui/controls";
import { t } from "../../i18n";

/** Rust caches for 2 minutes, so polling more often costs nothing. */
const POLL_MS = 60_000;

const windowLabel: Record<string, string> = {
  session: "Session",
  weekly: "Woche",
  daily: "Heute",
  monthly: "Monat",
};

export const usageError: Record<string, string> = {
  "not-configured": "Endpoint or value path missing",
  "invalid-url": "Use an https URL (or localhost)",
  "no-key": "Header value is missing",
  "invalid-path": "The JSON path did not return a number",
  "rate-limited": "Rate limited – try again in a few minutes",
  offline: "No connection",
  failed: "Request failed",
};

/*
 * One card for the custom endpoint: name, plan, one limit bar.
 */
export function UsageView() {
  const usage = settings.use().usage;
  const cfg = usage.config;
  const ready = usage.custom && cfg.url.trim().length > 0 && cfg.valuePath.trim().length > 0;
  const [providers, setProviders] = useState<UsageProvider[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now);

  const load = useCallback(() => {
    if (!ready) {
      setProviders([]);
      return;
    }
    setLoading(true);
    void fetchUsage(["custom"], cfg).then((p) => {
      setProviders(p);
      setNow(Date.now());
      setLoading(false);
    });
  }, [ready, cfg]);

  useEffect(() => {
    load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const actions = (
    <HeaderActions>
      <HeaderButton label={t("Aktualisieren")} onClick={load}>
        <motion.span className="flex" animate={{ rotate: loading ? 360 : 0 }} transition={loading ? spin : { duration: 0 }}>
          <ArrowClockwise size={14} weight="bold" />
        </motion.span>
      </HeaderButton>
      <HeaderButton label={t("Anbieter verwalten")} onClick={() => navigate("settings", "usage")}>
        <SlidersHorizontal size={14} weight="bold" />
      </HeaderButton>
    </HeaderActions>
  );

  if (!ready) {
    return (
      <Empty
        icon={Gauge}
        title={t("Kein Anbieter aktiv")}
        text={t("Trage in den Einstellungen deinen eigenen Usage-Endpunkt ein.")}
        action={<Button onClick={() => navigate("settings", "usage")}>{t("Anbieter wählen")}</Button>}
      />
    );
  }

  const list: (Partial<UsageProvider> & { id: "custom" })[] = providers ?? [{ id: "custom" }];
  return (
    <div className="flex h-full gap-2 overflow-x-auto px-4 pt-1 pb-2 [scrollbar-width:none]">
      {actions}
      {list.map((p, i) => (
        <motion.div
          key={p.id}
          className="flex min-w-[168px] flex-1 flex-col rounded-[14px] bg-fill-1 px-3 py-2.5"
          initial={{ opacity: 0, transform: "translateY(4px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ ...content.enter, delay: 0.05 * i }}
        >
          <div className="mb-2 flex items-center gap-1.5">
            <Gauge size={14} weight="bold" className="shrink-0 text-label" />
            <span className="truncate text-footnote font-semibold text-label">{p.name ?? cfg.name ?? "Custom"}</span>
            {p.plan && <span className="truncate rounded-full bg-fill-2 px-1.5 text-caption text-label-2">{p.plan}</span>}
          </div>
          {!p.windows ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ) : p.windows.length === 0 ? (
            <div className="flex flex-1 flex-col items-start justify-center gap-1 pb-2 text-caption text-label-3">
              <WarningCircle size={14} weight="bold" />
              {t(usageError[p.error ?? "failed"] ?? p.error ?? "")}
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {p.windows.map((w) => (
                  <WindowRow key={w.kind} w={w} now={now} />
                ))}
              </div>
              <div className="mt-auto pt-2 text-caption text-label-4" title={p.error ? t(usageError[p.error] ?? "") : undefined}>
                {p.error ? t("Stand {ago}", { ago: formatAgo(now - p.updatedAt!) }) : formatAgo(now - p.updatedAt!)}
              </div>
            </>
          )}
        </motion.div>
      ))}
    </div>
  );
}

function WindowRow({ w, now }: { w: UsageWindow; now: number }) {
  const used = Math.max(0, Math.min(100, w.usedPercent));
  const label = w.kind.startsWith("model:") ? w.kind.slice(6) : t(windowLabel[w.kind] ?? w.kind);
  const fill = used >= 95 ? "var(--color-red)" : used >= 80 ? "var(--color-orange)" : "var(--color-label)";

  return (
    <div className="text-caption">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="truncate text-label-2">{label}</span>
        <span className="tabular font-semibold text-label">{Math.round(used)} %</span>
      </div>
      <div className="relative h-[5px] overflow-hidden rounded-full bg-fill-2">
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{ backgroundColor: fill }}
          initial={{ transform: "translateX(-100%)" }}
          animate={{ transform: `translateX(${used - 100}%)` }}
          transition={springs.morph}
        />
      </div>
      <div className="tabular mt-1 flex justify-between gap-2 text-label-3">
        <span className="truncate" title={t("Setzt sich zurück")}>{w.resetsAt ? formatIn(w.resetsAt - now) : ""}</span>
        <span className={`shrink-0 whitespace-nowrap ${used >= 95 ? "text-red" : ""}`}>{t("{n} % übrig", { n: Math.round(100 - used) })}</span>
      </div>
    </div>
  );
}
