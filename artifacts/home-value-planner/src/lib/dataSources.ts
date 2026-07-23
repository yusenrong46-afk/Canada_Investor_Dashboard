export const dataSourceLabels: Record<string, string> = {
  seattlePermits: "Seattle building permits",
  kingCountySales: "King County sales",
  kingCountyResidentialBuildings: "King County residential buildings",
};

export function shortDataPath(path: string): string {
  const marker = "/data/raw/";
  const markerIndex = path.indexOf(marker);
  return markerIndex >= 0 ? `data/raw/${path.slice(markerIndex + marker.length)}` : path;
}
