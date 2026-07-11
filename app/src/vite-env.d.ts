/// <reference types="vite/client" />

declare module '*.topojson' {
  import type { Topology } from 'topojson-specification';
  const value: Topology<{ [key: string]: import('topojson-specification').GeometryCollection }>;
  export default value;
}
