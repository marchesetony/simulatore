export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { bootstrapProductionRuntime } = await import("./app/lib/production/bootstrap");
  bootstrapProductionRuntime();
}
