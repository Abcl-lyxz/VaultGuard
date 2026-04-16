/// Lightweight fuzzy matcher: subsequence with bonus for contiguous matches + prefix.
/// Returns null if the query isn't a subsequence of the target.
export function fuzzyScore(target: string, query: string): number | null {
  if (!query) return 0;
  const t = target.toLowerCase();
  const q = query.toLowerCase();

  let ti = 0;
  let qi = 0;
  let score = 0;
  let streak = 0;
  let prevIdx = -1;
  while (ti < t.length && qi < q.length) {
    if (t[ti] === q[qi]) {
      score += 10;
      if (prevIdx === ti - 1) {
        streak++;
        score += 5 * streak;
      } else {
        streak = 0;
      }
      if (ti === 0) score += 8; // prefix bonus
      prevIdx = ti;
      qi++;
    }
    ti++;
  }
  if (qi < q.length) return null;
  // Penalize longer targets slightly.
  score -= Math.floor((t.length - q.length) / 4);
  return score;
}
