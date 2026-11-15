declare module "*.woff2?url&no-inline" {
  const assetUrl: string;
  export default assetUrl;
}

declare module "virtual:Bridgely-bootstrap-ui" {
  const ui: Record<string, string>;
  export default ui;
}

declare module "*.css?inline" {
  const css: string;
  export default css;
}

declare module "virtual:Bridgely-simulator-locales" {
  const packs: Record<
    string,
    {
      name: string;
      dir: "ltr" | "rtl";
      status: "live" | "beta" | "draft";
      ui: Record<string, string>;
    }
  >;
  export default packs;
}
