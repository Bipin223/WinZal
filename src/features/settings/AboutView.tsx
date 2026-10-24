import { GithubLogo, Globe, type Icon } from "@phosphor-icons/react";
import avatar from "../../assets/bipin.png";
import { update } from "../../lib/update";
import { systemControls } from "../../platform/services";
import { t } from "../../i18n";

/**
 * The personal card behind WinZal: author, a short GitHub bio and the links
 * that are useful when someone wants to follow the project.
 */
export function AboutView() {
  const version = update.use().current ?? "1.6.6";
  const open = (url: string) => void systemControls.openUri(url);

  return (
    <div className="flex flex-col gap-2.5 pb-2">
      <div className="relative overflow-hidden rounded-[18px] bg-fill-1">
        <div aria-hidden className="absolute -top-24 -right-16 size-56 rounded-full bg-accent/20 blur-3xl" />
        <div aria-hidden className="absolute -bottom-24 -left-20 size-52 rounded-full bg-label/[0.04] blur-3xl" />
        <div className="relative flex flex-col items-center px-6 py-7 text-center">
          <div className="absolute top-4 right-4 rounded-full bg-fill-2 px-2.5 py-1 text-[10px] font-medium tabular text-label-3">
            {version}
          </div>
          <div className="mb-3 text-[10px] font-medium tracking-[0.12em] text-label-3">{t("Developed By")}</div>
          <img
            src={avatar}
            alt="Bipin Rizal"
            draggable={false}
            className="size-[92px] rounded-[26px] object-cover shadow-[0_10px_30px_rgb(0_0_0/0.45)] ring-1 ring-white/15"
          />
          <div className="mt-3 text-[22px] leading-7 font-semibold tracking-[-0.02em] text-label">Bipin Rizal</div>
          <p className="mt-3 max-w-[380px] text-caption leading-[17px] text-label-2">
            {t("Enthusiast, neugieriger Lerner, Designer & Entwickler.")}
          </p>
          <div className="mt-4 flex items-center gap-2">
            <LinkButton icon={GithubLogo} label="GitHub" onClick={() => open("https://github.com/Bipin223")} />
            <LinkButton icon={Globe} label={t("Webseite")} onClick={() => open("https://bipin-rijal.vercel.app")} />
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkButton({ icon: Icon, label, onClick }: { icon: Icon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pressable flex h-7 items-center gap-1.5 rounded-full bg-fill-2 px-3 text-caption font-medium text-label-2 hover:bg-fill-3 hover:text-label"
    >
      <Icon size={13} weight="fill" />
      {label}
    </button>
  );
}
