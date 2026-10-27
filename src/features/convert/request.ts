import { createStore } from "../../lib/store";

/**
 * Hand-off from another tool (Shelf) to the Converter. The files are already
 * on disk, so only their paths need to travel; the Converter mounts and probes
 * them exactly like a drag/drop.
 */
export const convertRequest = createStore<string[] | null>(null);

export function takeConvertRequest(): string[] | null {
  const paths = convertRequest.get();
  if (paths) convertRequest.set(null);
  return paths;
}
