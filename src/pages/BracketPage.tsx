import { useMatches } from "@/hooks/useMatches";
import { useTeamMap } from "@/hooks/useTeams";
import { BracketView } from "@/components/schedule/BracketView";
import { Loading, ErrorMessage } from "@/components/common/AsyncState";

export function BracketPage() {
  const matchesRes = useMatches();
  const teamsRes = useTeamMap();

  if (matchesRes.status === "loading" || teamsRes.status === "loading") {
    return <Loading />;
  }
  if (matchesRes.status === "error")
    return <ErrorMessage message={matchesRes.error} />;
  if (teamsRes.status === "error")
    return <ErrorMessage message={teamsRes.error} />;

  return (
    <div>
      <h1>トーナメント表</h1>
      <BracketView matches={matchesRes.data} teamMap={teamsRes.map} />
    </div>
  );
}
