import { createStore } from "../lib/store";

/**
 * The floating Recent switcher beside the closed notch. While its panel is
 * open the transparent window has to grow downwards, exactly like an attached
 * flyout; Notch reads this store to pick the window height.
 */
export const recentHub = createStore<{ active: boolean; height: number }>({
  active: false,
  height: 0,
});
