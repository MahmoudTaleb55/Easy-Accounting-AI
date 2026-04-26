/**
 * Hand-written ambient type declarations for the `jscanify/client` subpath.
 *
 * jscanify ships a CommonJS UMD bundle with no `.d.ts` and no `@types/*`
 * package. We only consume two methods (`extractPaper` and the
 * default-exported class constructor), so a tiny shape declaration is
 * enough — broader coverage would just be churn the next time upstream
 * tweaks something.
 *
 * Introduced for task #345.
 */
declare module "jscanify/client" {
  interface JscanifyInstance {
    extractPaper(
      image: HTMLCanvasElement | HTMLImageElement,
      resultWidth: number,
      resultHeight: number,
    ): HTMLCanvasElement | null;
  }

  interface JscanifyConstructor {
    new (): JscanifyInstance;
  }

  const Jscanify: JscanifyConstructor;
  export default Jscanify;
}
