import { t } from "../../i18n";

/** Rust error code → short sentence. */
export function errorText(code: string): string {
  switch (code) {
    case "missing":
      return t("Name and password are missing");
    case "secret":
      return t("Invalid key");
    case "not-otp":
      return t("Not a 2FA QR code");
    case "no-image":
      return t("No image in the clipboard");
    case "no-qr":
      return t("No QR code found");
    case "no-scan":
      return t("Paste a QR code or enter the key first");
    case "clipboard":
      return t("Clipboard busy, try again");
    case "hello-cancel":
      return t("Cancelled");
    case "hello-failed":
      return t("Windows Hello didn't work");
    case "hello-missing":
      return t("Windows Hello key is missing");
    case "unreadable":
      return t("Vault can't be read");
    default:
      return code;
  }
}
