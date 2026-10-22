export function defaultBuildSettings(slate) {
  const twoGames = slate?.games?.length === 2;
  return { minMinutes: twoGames ? 16 : 24, startersOnly: !twoGames, maxNewPlayers: 2 };
}
