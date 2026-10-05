declare module "bidi-js" {
  interface BidiInstance {
    getEmbeddingLevels(text: string, direction: "ltr" | "rtl"): unknown;
    getReorderedString(text: string, embedding: unknown): string;
  }

  const bidiFactory: (...args: unknown[]) => BidiInstance;
  export default bidiFactory;
}
