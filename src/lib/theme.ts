export type Theme = "system" | "light" | "dark";

export const THEME_KEY = "cjk-studio.theme";

/** Runs before first paint (see layout) so the theme never flashes. */
export const THEME_SCRIPT = `try{var t=JSON.parse(localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)})||'"system"');var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}`;
