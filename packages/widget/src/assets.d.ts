declare module "*.woff2?url&no-inline" {
  const assetUrl: string;
  export default assetUrl;
}

declare module "virtual:dimts-bootstrap-ui" {
  const ui: Record<string, string>;
  export default ui;
}
