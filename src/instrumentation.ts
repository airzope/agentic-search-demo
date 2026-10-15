export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Resume watching mapped directories without delaying server start.
    void import("@/lib/kb/watch").then(({ startWatchers }) => startWatchers());
  }
}
