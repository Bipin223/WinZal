import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { content } from "../../design/motion";
import { navigate } from "../../notch/nav";
import { refreshVault, vault, vaultError, vaultStatus } from "../../platform/vault";
import { updateSettings } from "../../settings/store";
import { Button, Group, Row, Switch } from "../../ui/controls";
import { PinEntry, unlockResult } from "./PinEntry";
import { HelloPrompt } from "./HelloPrompt";
import { errorText } from "./errors";
import { t } from "../../i18n";

type Flow = null | { step: "unlock"; then: () => Promise<void> } | { step: "new" } | { step: "confirm"; first: string };

/**
 * Settings → Tools → Vault. Weakening the protection (PIN off, new PIN) asks for
 * the current PIN; Rust enforces that, this only drives the dialog.
 */
export function VaultSettings() {
  const status = vaultStatus.use();
  const [flow, setFlow] = useState<Flow>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [helloSupported, setHelloSupported] = useState(false);

  useEffect(() => {
    void refreshVault();
    void vault.helloSupported().then(setHelloSupported, () => setHelloSupported(false));
    return () => void vault.lock();
  }, []);

  useEffect(() => {
    if (!confirmReset) return;
    const id = window.setTimeout(() => setConfirmReset(false), 3000);
    return () => window.clearTimeout(id);
  }, [confirmReset]);

  const run = async (action: () => Promise<void>) => {
    setNotice(null);
    try {
      await action();
    } catch (e) {
      if (vaultError(e) === "locked") setFlow({ step: "unlock", then: action });
      else setNotice(errorText(vaultError(e)));
    }
  };

  if (!status) return null;
  if (!status.hasPin) {
    return (
      <Group title={t("Vault")} id="settings-vault">
        <Row label={t("Passwords & 2FA")}>
          <Button
            onClick={() => {
              updateSettings((s) => ({ tools: s.tools.map((x) => (x.id === "vault" ? { ...x, enabled: true } : x)) }));
              navigate("vault");
            }}
          >
            {t("Set up")}
          </Button>
        </Row>
      </Group>
    );
  }

  const pinFlow =
    flow?.step === "unlock" && status.hello ? (
      <HelloPrompt
        key="hello"
        compact
        onCancel={() => setFlow(null)}
        onUnlocked={async () => {
          const then = flow.then;
          setFlow(null);
          await run(then);
        }}
      />
    ) : flow?.step === "unlock" ? (
      <PinEntry
        key="unlock"
        compact
        title={t("Enter current PIN")}
        lockedFor={status.lockedFor}
        onCancel={() => setFlow(null)}
        onSubmit={async (pin) => {
          try {
            await vault.unlock(pin);
          } catch (e) {
            return unlockResult(vaultError(e));
          }
          const then = flow.then;
          setFlow(null);
          await run(then);
          return null;
        }}
      />
    ) : flow?.step === "new" ? (
      <PinEntry key="new" compact title={t("New PIN")} onCancel={() => setFlow(null)} onSubmit={async (pin) => (setFlow({ step: "confirm", first: pin }), null)} />
    ) : flow?.step === "confirm" ? (
      <PinEntry
        key="confirm"
        compact
        title={t("Confirm new PIN")}
        onCancel={() => setFlow(null)}
        onSubmit={async (pin) => {
          if (pin !== flow.first) return t("PINs don't match");
          setFlow(null);
          await run(async () => {
            await vault.changePin(pin);
            setNotice(t("PIN changed"));
          });
          return null;
        }}
      />
    ) : null;

  return (
    <Group title={t("Vault")} id="settings-vault">
      {helloSupported && (
        <Row
          label={t("Windows Hello")}
        >
          <Switch label={t("Windows Hello")} checked={status.hello} onChange={(on) => void run(() => (on ? vault.helloEnable() : vault.helloDisable()))} />
        </Row>
      )}
      {!status.hello && (
        <>
          <Row label={t("PIN for passwords")}>
            <Switch label={t("PIN for passwords")} checked={status.pinPasswords} onChange={(on) => void run(() => vault.options(on, status.pinTotp))} />
          </Row>
          <Row label={t("PIN for 2FA codes")}>
            <Switch label={t("PIN for 2FA codes")} checked={status.pinTotp} onChange={(on) => void run(() => vault.options(status.pinPasswords, on))} />
          </Row>
          <Row label={t("Change PIN")} status={notice ?? undefined}>
            <Button onClick={() => setFlow({ step: "unlock", then: async () => setFlow({ step: "new" }) })}>{t("Change")}</Button>
          </Row>
        </>
      )}
      <Row label={t("Reset vault")}>
        <Button onClick={() => (confirmReset ? void vault.reset().then(refreshVault) : setConfirmReset(true))}>
          <span className={confirmReset ? "text-red" : undefined}>{confirmReset ? t("Really delete everything?") : t("Reset")}</span>
        </Button>
      </Row>
      <AnimatePresence initial={false}>
        {pinFlow && (
          <motion.div
            key="pin"
            className="overflow-hidden"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto", transition: content.enter }}
            exit={{ opacity: 0, height: 0, transition: content.exit }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {pinFlow}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </Group>
  );
}
